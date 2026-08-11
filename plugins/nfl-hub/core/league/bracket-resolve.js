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
    // ⚠️ READ FROM THE BRACKET, not from live settings. A commissioner who
    // changed the format mid-playoffs would otherwise re-interpret which weeks
    // an already-finished round occupied and move a decided game.
    format: bracket.roundFormat,
    // The MAIN side's round count decides where the championship is. A
    // consolation bracket is shorter and must not double its own last round.
    totalRounds: (bracket.rounds ?? []).length,
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
/**
 * How long each playoff round runs.
 *
 * Sleeper offers exactly these three, captured from the live settings screen:
 * "One week per round · Two week championship round · Two weeks per round".
 */
export const PLAYOFF_ROUND_FORMAT = Object.freeze({
  ONE: 'one',
  TWO_WEEK_CHAMPIONSHIP: 'two_week_championship',
  TWO: 'two',
});

/**
 * How many weeks round `roundIndex` spans.
 *
 * ⚠️ AN UNKNOWN FORMAT IS ONE WEEK. Guessing "two" for a typo would silently
 * double the length of somebody's playoffs.
 */
export function weeksInRound(roundIndex, { format, totalRounds } = {}) {
  if (format === PLAYOFF_ROUND_FORMAT.TWO) return 2;
  if (format === PLAYOFF_ROUND_FORMAT.TWO_WEEK_CHAMPIONSHIP
    && Number.isInteger(totalRounds) && roundIndex === totalRounds - 1) return 2;
  return 1;
}

/**
 * The week a round STARTS in.
 *
 * ⚠️ Rounds no longer sit one week apart, so this accumulates the lengths of
 * the rounds before it rather than adding the index. The two-argument form is
 * preserved exactly — every existing caller means one week per round.
 */
export function weekForRound(playoffWeekStart, roundIndex, opts = {}) {
  let week = playoffWeekStart ?? 15;
  for (let i = 0; i < roundIndex; i++) week += weeksInRound(i, opts);
  return week;
}

/** Every week a round occupies, in order. */
export function roundWeeks(playoffWeekStart, roundIndex, opts = {}) {
  const start = weekForRound(playoffWeekStart, roundIndex, opts);
  const n = weeksInRound(roundIndex, opts);
  return Array.from({ length: n }, (_, i) => start + i);
}

/**
 * Add up a multi-week round into one score record.
 *
 * ⚠️ RETURNS NULL IF ANY WEEK IS MISSING. A two-week round decided on week one
 * alone would hand the title to whoever led at half-time — the round is not a
 * result until every week of it is in.
 */
function aggregateWeeks(weeks, scoresFor) {
  const totals = {};
  for (const w of weeks) {
    const s = scoresFor(w);
    if (!s) return null;
    for (const [teamId, rec] of Object.entries(s.teams ?? {})) {
      const t = Number(rec?.total);
      if (!Number.isFinite(t)) continue;
      totals[teamId] = (totals[teamId] ?? 0) + t;
    }
  }
  return { teams: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, { total: v }])) };
}

/**
 * One side — `{ rounds, byes, champion }` — advanced as far as the scores allow.
 */
export function advanceSide(side, { playoffWeekStart, reseed, scoresFor, format, totalRounds }) {
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

    const scores = aggregateWeeks(
      roundWeeks(playoffWeekStart, roundIndex, { format, totalRounds }),
      scoresFor,
    );
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
