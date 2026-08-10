// server/ops-playoffs.js — the postseason bracket.
//
// ⚠️ ADVANCING IS RESOLVED ON READ, the same shape as the draft clock and for
// the same reason: a round finishes when its week is SCORED, and scoring happens
// on the 5-minute tick. Whoever next opens the bracket resolves whatever has
// come due, with the tick as a backstop for when nobody is looking.
//
// ⚠️ A ROUND IS PINNED TO A WEEK. round 0 plays `playoffWeekStart`, round 1 the
// week after, and so on. Without that mapping there is nothing to score a round
// against, and "who won" becomes a judgement call.

import { KEY, read, mutate, loadLeague } from "./store.js";
import { requireCommissioner, isCommissioner } from "./auth.js";
import { buildBracket, advanceBracket, bracketChampion } from "../core/league/schedule.js";
import { getStandings } from "./ops-scoring.js";

const refuse = (msg) => { throw new Error(msg); };

/** The week a given round is played in. */
export function weekForRound(settings, roundIndex) {
  return (settings?.playoffWeekStart ?? 15) + roundIndex;
}

/**
 * Seed the bracket from the final standings and start the postseason.
 *
 * ⚠️ SEEDS ARE TAKEN FROM `standings:get`, not recomputed here. One definition of
 * who finished where — a second one would eventually disagree with the table
 * everybody has been looking at all season, and only at the moment it matters
 * most.
 */
export function startPlayoffs({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  const season = Number(payload?.season ?? meta.season);
  const existing = read(KEY.bracket(lg, season), null);
  if (existing && !payload?.force) {
    refuse("this season already has a bracket — pass force to rebuild it, which discards every result in it");
  }

  const table = getStandings({ payload: { leagueId: lg, season } });
  if ((table.weeks ?? 0) === 0) {
    refuse("no weeks have been scored — seeding a bracket now would rank everybody on nothing");
  }

  const cut = Number(meta.settings?.playoffTeams ?? 0);
  if (cut < 2) refuse("this league's playoffTeams is below 2");
  const seeds = (table.standings ?? []).slice(0, cut);
  if (seeds.length < 2) refuse("not enough teams to seed a bracket");

  const built = buildBracket(seeds);
  const record = {
    season,
    startedAt: Date.now(),
    startedBy: p.userId,
    playoffWeekStart: meta.settings?.playoffWeekStart ?? 15,
    reseed: meta.settings?.playoffReseed !== false,
    // The seeds AS THEY WERE when the bracket was built. Standings keep moving if
    // a week is rescored, and a bracket must not silently reseed itself.
    seeds,
    rounds: built.rounds,
    byes: built.byes,
    champion: null,
  };
  mutate(KEY.bracket(lg, season), () => record, null);
  return summary(record, meta, p);
}

/**
 * The bracket, advancing any round whose week has been scored.
 *
 * ⚠️ RESOLUTION HAPPENS INSIDE THE SWAP. Two people opening the bracket at once
 * would otherwise both advance the same round and one write would vanish.
 */
export function getPlayoffs({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);

  let view = null;
  mutate(KEY.bracket(lg, season), (b) => {
    if (!b) { view = null; return b; }
    const next = resolve(lg, season, b);
    view = summary(next, meta, p);
    return next;
  }, null);

  return view;
}

/**
 * Advance every round whose week has a score, until one does not.
 *
 * Callable from the tick without an auth check — it takes no user action, it
 * only reads scores that already exist.
 */
export function resolve(lg, season, bracket) {
  if (!bracket || bracket.champion) return bracket;

  let state = bracket;
  // A bracket cannot have more rounds than it has, so this is bounded.
  let guard = 8;

  while (guard-- > 0) {
    const roundIndex = state.rounds.length - 1;
    const round = state.rounds[roundIndex] ?? [];
    if (round.length === 0) break;
    if (round.every((g) => g.winner)) {
      // Already decided; try to advance.
      const advanced = advanceBracket(state, { reseed: state.reseed !== false });
      if (advanced.rounds.length === state.rounds.length) break; // final round
      state = { ...state, rounds: advanced.rounds, byes: advanced.byes };
      continue;
    }

    const week = weekForRound({ playoffWeekStart: state.playoffWeekStart }, roundIndex);
    const scores = read(KEY.scores(lg, season, week), null);
    if (!scores) break; // not played yet — nothing to decide

    const decided = round.map((g) => {
      if (g.winner) return g;
      const home = scores.teams?.[g.home?.teamId]?.total;
      const away = scores.teams?.[g.away?.teamId]?.total;
      if (home === undefined || away === undefined) return g;
      // ⚠️ A TIE GOES TO THE BETTER SEED. Leaving it undecided stalls the whole
      // bracket forever, and a fantasy week genuinely can tie.
      if (home === away) return { ...g, winner: g.home.seed <= g.away.seed ? g.home : g.away, tie: true };
      return { ...g, winner: home > away ? g.home : g.away };
    });

    if (decided.some((g) => !g.winner)) break; // still waiting on a score
    state = { ...state, rounds: [...state.rounds.slice(0, roundIndex), decided] };
  }

  const champ = bracketChampion(state);
  return champ ? { ...state, champion: champ } : state;
}

/** Advance every league's bracket on the tick. */
export function resolveBracketsFor(lg, season) {
  let changed = false;
  mutate(KEY.bracket(lg, season), (b) => {
    if (!b) return b;
    const next = resolve(lg, season, b);
    changed = JSON.stringify(next) !== JSON.stringify(b);
    return next;
  }, null);
  return { advanced: changed };
}

/** The shape the UI renders. */
function summary(b, meta, p) {
  if (!b) return null;
  return {
    season: b.season,
    playoffWeekStart: b.playoffWeekStart,
    reseed: b.reseed,
    seeds: b.seeds,
    byes: b.byes,
    champion: b.champion,
    isCommissioner: isCommissioner(meta, p?.userId),
    rounds: b.rounds.map((games, i) => ({
      round: i + 1,
      week: weekForRound({ playoffWeekStart: b.playoffWeekStart }, i),
      games,
    })),
  };
}

function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  return lg;
}
