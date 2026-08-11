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
import { buildBracket, consolationSeeds } from "../core/league/schedule.js";
import { resolveBracket, weekForRound as weekOf } from "../core/league/bracket-resolve.js";
import { getStandings } from "./ops-scoring.js";

const refuse = (msg) => { throw new Error(msg); };

/** The week a given round is played in. */
export function weekForRound(settings, roundIndex) {
  return weekOf(settings?.playoffWeekStart, roundIndex);
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

  // ⚠️ THE CONSOLATION SIDE IS SEEDED HERE OR NEVER, from the SAME standings
  // read as the championship side. Adding one later would seed it from a table
  // that already includes playoff weeks — the also-rans' order would come from
  // games the bracket is not about. A bracket built before this existed simply
  // has no consolation side, which is the honest outcome.
  const alsoRans = meta.settings?.playoffConsolation === false
    ? []
    : consolationSeeds(table.standings ?? [], cut);
  const consBuilt = alsoRans.length >= 2 ? buildBracket(alsoRans) : null;

  const record = {
    season,
    startedAt: Date.now(),
    startedBy: p.userId,
    playoffWeekStart: meta.settings?.playoffWeekStart ?? 15,
    reseed: meta.settings?.playoffReseed !== false,
    // ⚠️ Recorded ON THE BRACKET, like reseed and the seeds themselves. A
    // league that changed this mid-playoffs would otherwise re-interpret which
    // weeks a round already occupied and move a finished game.
    roundFormat: meta.settings?.playoffRoundFormat ?? "one",
    // The seeds AS THEY WERE when the bracket was built. Standings keep moving if
    // a week is rescored, and a bracket must not silently reseed itself.
    seeds,
    rounds: built.rounds,
    byes: built.byes,
    champion: null,
    consolation: consBuilt
      ? { seeds: alsoRans, rounds: consBuilt.rounds, byes: consBuilt.byes, champion: null }
      : null,
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
 *
 * ⚠️ THE RULES LIVE IN `core/league/bracket-resolve.js`, not here. This is the
 * adapter that hands them the module's storage: the whole of "who won, who
 * advances, who is champion" is pure and unit-tested, and the two-sided
 * behaviour it guards — neither bracket may gate the other — cannot be tested
 * through a store at all.
 */
export function resolve(lg, season, bracket) {
  return resolveBracket(bracket, (week) => read(KEY.scores(lg, season, week), null));
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
  const withWeeks = (rounds) => (rounds ?? []).map((games, i) => ({
    round: i + 1,
    week: weekForRound({ playoffWeekStart: b.playoffWeekStart }, i),
    games,
  }));

  return {
    season: b.season,
    playoffWeekStart: b.playoffWeekStart,
    reseed: b.reseed,
    seeds: b.seeds,
    byes: b.byes,
    champion: b.champion,
    isCommissioner: isCommissioner(meta, p?.userId),
    rounds: withWeeks(b.rounds),
    // ⚠️ `null` when the league has no consolation side, NOT an empty object.
    // The UI has to tell "this league does not run one" apart from "it does and
    // nothing has happened yet" — the second gets a panel, the first must not.
    consolation: b.consolation
      ? {
        seeds: b.consolation.seeds,
        byes: b.consolation.byes,
        champion: b.consolation.champion ?? null,
        rounds: withWeeks(b.consolation.rounds),
      }
      : null,
  };
}

function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  return lg;
}
