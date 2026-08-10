// core/league/bracket-resolve.js — advancing a postseason from its scores.
//
// PURE. Scores arrive through a `scoresFor(week)` callback rather than a store,
// so the whole of "who won, who advances, who is champion" is testable without a
// runtime. The server half is then a two-line adapter over the module's storage.
//
// ⚠️ A ROUND IS PINNED TO A WEEK: round 0 plays `playoffWeekStart`, round 1 the
// week after. Both sides of the postseason use the SAME mapping — a consolation
// game in a week the league is not playing has nothing to score against.

import { advanceBracket, bracketChampion } from './schedule.js';

/**
 * Advance both sides of a postseason as far as the scores allow.
 *
 * `bracket` carries the championship side flat (`rounds`, `byes`, `champion`)
 * and the consolation side, when there is one, under `consolation`.
 *
 * ⚠️ THE TWO SIDES FINISH IN EITHER ORDER, so neither may gate the other. Six
 * playoff teams out of ten gives a three-round championship and a two-round
 * consolation; four out of ten reverses it. Returning early once a champion
 * exists — correct when there was only one side — would freeze whichever bracket
 * was still playing at the moment the trophy was handed out.
 */
export function resolveBracket(bracket, scoresFor) {
  if (!bracket) return bracket;

  const opts = {
    playoffWeekStart: bracket.playoffWeekStart ?? 15,
    reseed: bracket.reseed,
    scoresFor,
  };

  const main = advanceSide({
    rounds: bracket.rounds ?? [],
    byes: bracket.byes ?? [],
    champion: bracket.champion ?? null,
  }, opts);

  const cons = bracket.consolation ? advanceSide(bracket.consolation, opts) : null;

  return {
    ...bracket,
    rounds: main.rounds,
    byes: main.byes,
    champion: main.champion ?? null,
    // ⚠️ Preserve `null`, never write the key back as undefined. JSON.stringify
    // drops undefined, so the tick's change-detection would see a difference on
    // every single pass and rewrite an unchanged bracket forever.
    consolation: cons ? { ...bracket.consolation, ...cons } : bracket.consolation ?? null,
  };
}

/** The week a given round is played in. */
export function weekForRound(playoffWeekStart, roundIndex) {
  return (playoffWeekStart ?? 15) + roundIndex;
}

/**
 * One side — `{ rounds, byes, champion }` — advanced as far as the scores allow.
 */
export function advanceSide(side, { playoffWeekStart, reseed, scoresFor }) {
  if (!side || side.champion) return side;

  let state = side;
  // A bracket cannot have more rounds than it has, so this is bounded.
  let guard = 8;

  while (guard-- > 0) {
    const roundIndex = (state.rounds?.length ?? 0) - 1;
    const round = state.rounds?.[roundIndex] ?? [];
    if (round.length === 0) break;

    if (round.every((g) => g.winner)) {
      const advanced = advanceBracket(state, { reseed: reseed !== false });
      if (advanced.rounds.length === state.rounds.length) break; // final round
      state = { ...state, rounds: advanced.rounds, byes: advanced.byes };
      continue;
    }

    const scores = scoresFor(weekForRound(playoffWeekStart, roundIndex));
    if (!scores) break; // not played yet — nothing to decide

    const decided = round.map((g) => decide(g, scores));
    if (decided.some((g) => !g.winner)) break; // still waiting on a score
    state = { ...state, rounds: [...state.rounds.slice(0, roundIndex), decided] };
  }

  const champ = bracketChampion(state);
  return champ ? { ...state, champion: champ } : state;
}

function decide(g, scores) {
  if (g.winner) return g;
  const home = scores.teams?.[g.home?.teamId]?.total;
  const away = scores.teams?.[g.away?.teamId]?.total;
  if (home === undefined || away === undefined) return g;
  // ⚠️ A TIE GOES TO THE BETTER SEED. Leaving it undecided stalls the whole
  // bracket forever, and a fantasy week genuinely can tie.
  if (home === away) {
    return { ...g, winner: g.home.seed <= g.away.seed ? g.home : g.away, tie: true };
  }
  return { ...g, winner: home > away ? g.home : g.away };
}
