// server/ops-scoring.js — the position index and the weekly scoring run.
//
// ⚠️ POSITIONS MUST NOT COME FROM THE PAYLOAD. The invocation payload is the
// caller's browser talking, so a manager could declare their QB an RB and start
// him in an RB slot. They come from the plugin's own published asset, reduced to
// an id -> position map and cached in storage.
//
// ⚠️ Sleeper's /v1/players/nfl is ~14.3 MB and can never be fetched at runtime —
// the host caps a response at 1 MiB. The committed asset is 308 KB precisely
// because of that cap, and the map it reduces to is 64 KiB, inside the 256 KiB
// per-value storage limit.

import { fetchJSON } from "./sdk/server-sdk.js";
import { KEY, read, mutate, writeUncontended, loadLeague, leagueIndex } from "./store.js";
import { requireScheduled, requireCommissioner } from "./auth.js";
import { scoreStatLine } from "../core/league/scoring.js";
import { splitRosterPositions } from "../core/league/slots.js";
import { weeklyPoints } from "../core/league/lineup.js";
import { buildStandings, seedTeams } from "../core/league/schedule.js";

const refuse = (msg) => { throw new Error(msg); };

const POSITIONS_KEY = "fl:positions";
const INDEX_URL = "https://plugins.dissent.chat/plugins/nfl-hub/assets/players.index.json";
const STATS_URL = (season, week) =>
  `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`;

/**
 * Refresh the id -> position map from the plugin's own published asset.
 *
 * Shared across every league on the install: positions are a property of the
 * NFL, not of a league.
 */
export function refreshPositions({ p, payload }) {
  // A commissioner may force it; the scheduler does it routinely. Both are fine,
  // and neither is an ordinary member.
  if (!p.scheduled) {
    const lg = String(payload?.leagueId ?? "");
    const meta = lg ? read(KEY.meta(lg), null) : null;
    const err = requireCommissioner(p, meta);
    if (err) refuse(err);
  }

  const index = fetchJSON({ url: INDEX_URL });
  const map = {};
  for (const [id, rec] of Object.entries(index ?? {})) {
    if (rec?.p) map[id] = rec.p;
  }
  if (Object.keys(map).length === 0) refuse("player index returned no positions");

  writeUncontended(POSITIONS_KEY, { map, refreshedAt: Date.now(), count: Object.keys(map).length });
  return { positions: Object.keys(map).length };
}

/** The cached map, or an empty one. Never fetches — scoring must not block on it. */
export function positionMap() {
  return read(POSITIONS_KEY, { map: {} }).map ?? {};
}

/**
 * Score one week for one league.
 *
 * SCHEDULED ONLY. A user triggering it would let a manager re-run scoring after
 * seeing the result, and would put a whole league's scoring on the 2 s invoke
 * budget rather than the 5 s scheduled one.
 *
 * ⚠️ Scores are written to their own key, not merged into `assets`. They are
 * derived data with exactly one writer, so they must never contend with the
 * roster operations happening at the same time.
 */
export function scoreWeekForLeague({ p, payload }) {
  const err = requireScheduled(p);
  if (err) refuse(err);
  return runScoring(String(payload?.leagueId ?? ""), payload?.season, payload?.week);
}

/** The scoring pass itself, callable from the tick without re-checking auth. */
export function runScoring(lg, seasonIn, weekIn) {
  if (!lg) refuse("leagueId required");
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const season = Number(seasonIn ?? meta.season);
  const week = Number(weekIn ?? meta.currentWeek);
  if (!Number.isInteger(week) || week < 1) return { skipped: "no current week" };

  const stats = fetchJSON({ url: STATS_URL(season, week) });
  const positions = positionMap();
  const { starters } = splitRosterPositions(meta.settings?.rosterPositions);
  const scoring = meta.settings?.scoring ?? {};

  // Every player's points for the week, computed ONCE from raw stats.
  //
  // ⚠️ NOT from the payload's pts_ppr fields — those are Sleeper's DEFAULT
  // scoring and know nothing about this league's settings. Under a custom
  // setting they are wrong for exactly the handful of players it touches, which
  // is the hardest kind of scoring bug to notice.
  const pointsOf = (id) => scoreStatLine(stats?.[String(id)] ?? null, scoring);
  const positionOf = (id) => positions[String(id)] ?? null;

  const results = {};
  for (const teamId of Object.keys(teams)) {
    const roster = assets.rosters?.[teamId] ?? { players: [], ir: [], taxi: [] };
    const stored = read(KEY.lineup(lg, season, week, teamId), { lineup: [] });
    const out = weeklyPoints({
      players: roster.players ?? [],
      lineup: stored.lineup ?? [],
      starterSlots: starters,
      pointsOf,
      positionOf,
      bestBall: Boolean(meta.settings?.bestBall),
    });
    results[teamId] = {
      total: out.total,
      bestBall: out.bestBall,
      rows: out.rows.map((r) => ({ slot: r.slot, playerId: r.playerId, points: r.points })),
    };
  }

  writeUncontended(KEY.scores(lg, season, week), {
    season, week, scoredAt: Date.now(), teams: results,
  });

  return {
    season, week,
    teams: Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.total])),
  };
}

/** Read a scored week back. Any member may see it — scores are public. */
export function getScores({ payload }) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week ?? meta.currentWeek);
  return read(KEY.scores(lg, season, week), { season, week, scoredAt: null, teams: {} });
}

/**
 * Commissioner: advance the league to a week.
 *
 * The week is league state rather than something derived from the date, because
 * a commissioner legitimately needs to hold or replay one.
 */
export function setCurrentWeek({ p, payload }) {
  const lg = String(payload?.leagueId ?? "");
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  const week = Number(payload?.week);
  if (!Number.isInteger(week) || week < 1) refuse("week must be a positive integer");
  mutate(KEY.meta(lg), (m) => ({ ...m, currentWeek: week }), meta);
  return { currentWeek: week };
}

/**
 * How stale the position map is, so the tick can decide to refresh.
 *
 * A week is deliberate: positions change on signings and practice-squad moves,
 * which matter within a season but not within an hour — and every refresh costs
 * a 308 KB fetch against the install's daily allowance.
 */
export function positionsAreStale() {
  const rec = read(POSITIONS_KEY, null);
  if (!rec) return true;
  return Date.now() - (rec.refreshedAt ?? 0) > 7 * 24 * 60 * 60 * 1000;
}

/** Every league id on the install, for the tick. */
export function allLeagues() {
  return leagueIndex();
}

/**
 * The league table, computed from the STORED schedule and the STORED scores.
 *
 * ⚠️ COMPUTED HERE, NOT IN THE BROWSER, and for a stronger reason than the
 * schedule was. Standings decide playoff seeding, so two answers to "what is my
 * record" is worse than two answers to "who do I play" — and a client would have
 * to fetch every week separately to work it out, which is a dozen invocations
 * against the install's daily allowance for a number the node already holds.
 *
 * ⚠️ ONLY WEEKS THAT HAVE ACTUALLY BEEN SCORED COUNT. A future week has no
 * result, and treating its absent scores as 0–0 would hand everybody a loss for
 * games nobody has played.
 */
export function getStandings({ payload }) {
  const lg = String(payload?.leagueId ?? '');
  if (!lg) refuse('leagueId required');
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const season = Number(payload?.season ?? meta.season);
  const schedule = read(KEY.schedule(lg, season), null);
  const teamIds = Object.keys(teams);

  if (!schedule) {
    // No schedule means no games, which is a real state early in a season —
    // an empty table, not an error.
    return { season, weeks: 0, standings: buildStandings(teamIds, []), scheduled: false };
  }

  const results = [];
  let scoredWeeks = 0;
  for (const week of schedule.weeks ?? []) {
    const scores = read(KEY.scores(lg, season, week.week), null);
    if (!scores) continue; // not played yet
    scoredWeeks++;
    for (const m of week.matchups ?? []) {
      const home = scores.teams?.[m.home];
      // A bye still records points for, but no opponent and no result.
      if (m.bye || !m.away) {
        if (home) results.push({ week: week.week, home: m.home, away: null, homePoints: home.total, awayPoints: 0 });
        continue;
      }
      const away = scores.teams?.[m.away];
      // A matchup where one side was never scored is not half a result.
      if (!home || !away) continue;
      results.push({
        week: week.week,
        home: m.home, away: m.away,
        homePoints: home.total, awayPoints: away.total,
      });
    }
  }

  const table = buildStandings(teamIds, results, {
    medianMatchup: Boolean(meta.settings?.medianMatchup),
  });

  return {
    season,
    weeks: scoredWeeks,
    scheduled: true,
    // Seeded here too, so a client rendering a playoff line does not re-rank and
    // risk disagreeing about the cut.
    standings: seedTeams(table),
  };
}
