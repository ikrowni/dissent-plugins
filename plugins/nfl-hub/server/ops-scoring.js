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
import { resolveAutoSubs } from "../core/league/autosubs.js";
import { buildStandings, seedTeams } from "../core/league/schedule.js";
import { shouldAdvance } from "../core/league/season-clock.js";
// ⚠️ The refresh rule lives in core/league so it can be unit-tested — server/*.js
// has no unit tests, and this decides whether scores update at all.
import { fingerprintOf, isDue, nextBackoff } from "../core/league/score-backoff.js";

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
  // ⚠️ Injuries ride along on the SAME fetch. IR eligibility needs a designation
  // per player, and the alternative — a second feed — would be another 300 KB
  // against the install's daily allowance for data already in this response.
  // Only the designated are stored; ~95% of players carry nothing.
  const injuries = {};
  for (const [id, rec] of Object.entries(index ?? {})) {
    if (rec?.p) map[id] = rec.p;
    if (rec?.i) injuries[id] = String(rec.i);
  }
  if (Object.keys(map).length === 0) refuse("player index returned no positions");

  writeUncontended(POSITIONS_KEY, {
    map, injuries, refreshedAt: Date.now(), count: Object.keys(map).length,
  });
  return { positions: Object.keys(map).length, injuries: Object.keys(injuries).length };
}

/** The cached map, or an empty one. Never fetches — scoring must not block on it. */
export function positionMap() {
  return read(POSITIONS_KEY, { map: {} }).map ?? {};
}

/**
 * Injury designations, or NULL when this install has never cached any.
 *
 * ⚠️ NULL AND `{}` MEAN DIFFERENT THINGS, and conflating them breaks IR either
 * way. A record written before injuries were cached has no `injuries` key at
 * all — reading that as "nobody is injured" would refuse EVERY IR move until the
 * next weekly refresh. An empty object written BY a refresh genuinely means
 * nobody in the league is designated. So: null disables the check, `{}` enforces
 * it.
 */
export function injuryMap() {
  const rec = read(POSITIONS_KEY, null);
  if (!rec || !rec.injuries) return null;
  return rec.injuries;
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
  // An explicit scheduled request was asked for; it is not the routine tick.
  return runScoring(String(payload?.leagueId ?? ""), payload?.season, payload?.week, { force: true });
}

/**
 * ⚠️ ONE FETCH PER (season, week) PER INVOCATION. The tick loops every league on
 * the install and each one asked for the same ~520 KB payload, so ten leagues
 * meant ten identical downloads every five minutes — the single largest cost the
 * node incurs, and entirely avoidable.
 *
 * ⚠️ SAFE BECAUSE THE INSTANCE IS FRESH PER INVOCATION. The runtime builds a new
 * `Instance()` for every call, so this map is discarded when the tick ends and
 * can never serve a stale week to a later one. It is a within-tick memo, NOT a
 * cache — do not try to make it persist.
 */
const statsMemo = new Map();

function weeklyStats(season, week) {
  const key = `${season}:${week}`;
  if (!statsMemo.has(key)) {
    statsMemo.set(key, fetchJSON({ url: STATS_URL(season, week) }));
  }
  return statsMemo.get(key);
}

/**
 * The scoring pass itself, callable from the tick without re-checking auth.
 *
 * ⚠️ `force` SKIPS THE BACKOFF and must be passed by anything that is not the
 * routine tick: the final pass when a week rolls over gets one last chance to
 * record that week correctly, and an explicit scheduled request was asked for.
 * Throttling either would lose data rather than save bandwidth.
 */
export function runScoring(lg, seasonIn, weekIn, { force = false } = {}) {
  if (!lg) refuse("leagueId required");
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const season = Number(seasonIn ?? meta.season);
  const week = Number(weekIn ?? meta.currentWeek);
  if (!Number.isInteger(week) || week < 1) return { skipped: "no current week" };

  // Not due yet, and nothing has been changing — leave the stored score alone.
  const prev = read(KEY.scores(lg, season, week), null);
  if (!force && !isDue(prev)) {
    return { season, week, skipped: "not due", dueIn: prev.nextScoreAt - Date.now() };
  }

  const stats = weeklyStats(season, week);
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

    // ⚠️ AUTOSUBS ARE APPLIED BEFORE SCORING, NEVER AFTER. They change WHICH
    // players count, so resolving them after the fact would score the lineup as
    // submitted and then disagree with itself.
    //
    // ⚠️ NOT IN BEST BALL. Best ball already scores the optimal lineup from the
    // whole roster, so a substitution cannot improve it and would only make the
    // result harder to explain.
    //
    // ⚠️ `applied` IS PERSISTED. An automatic change nobody can see is
    // indistinguishable from a bug — the UI has to be able to say why a bench
    // player scored.
    let lineup = stored.lineup ?? [];
    let applied = [];
    if (!meta.settings?.bestBall && Number(meta.settings?.autoSubsPerWeek ?? 0) > 0) {
      const designations = read(KEY.autosubs(lg, season, week, teamId), { subs: {} }).subs ?? {};
      const resolved = resolveAutoSubs({
        lineup,
        starterSlots: starters,
        subs: designations,
        statsOf: (id) => stats?.[String(id)] ?? null,
      });
      lineup = resolved.lineup;
      applied = resolved.applied;
    }

    const out = weeklyPoints({
      players: roster.players ?? [],
      lineup,
      starterSlots: starters,
      pointsOf,
      positionOf,
      bestBall: Boolean(meta.settings?.bestBall),
    });
    results[teamId] = {
      total: out.total,
      bestBall: out.bestBall,
      rows: out.rows.map((r) => ({ slot: r.slot, playerId: r.playerId, points: r.points })),
      ...(applied.length > 0 ? { autoSubs: applied } : {}),
    };
  }

  // Back off while nothing moves, snap back the moment it does.
  const fingerprint = fingerprintOf(results);
  const { quietRuns, nextScoreAt } = nextBackoff(prev, fingerprint);

  writeUncontended(KEY.scores(lg, season, week), {
    season, week, scoredAt: Date.now(), teams: results,
    fingerprint, quietRuns, nextScoreAt,
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

const STATE_URL = "https://api.sleeper.app/v1/state/nfl";

/** The NFL's own idea of where the season is. ~200 bytes. */
export function nflState() {
  return fetchJSON({ url: STATE_URL });
}

/**
 * Advance a league to the NFL's current week, if that is due.
 *
 * ⚠️ WITHOUT THIS NOTHING ADVANCES. `currentWeek` was set only by a commissioner,
 * so a league whose commissioner went quiet simply stopped scoring — silently,
 * because a tick with no current week skips scoring rather than failing.
 *
 * ⚠️ SCORE THE OUTGOING WEEK ONE LAST TIME BEFORE MOVING ON. Scoring runs on a
 * 5-minute tick, so the last score written for a week is whatever the games
 * looked like at that moment. Advancing without a final pass freezes a week
 * mid-Sunday and that becomes the permanent result.
 *
 * Guards, all of which have bitten something similar before:
 *   - the league's season must MATCH the live one, or a league replaying 2025
 *     would be dragged to whatever week 2026 is in
 *   - only during the regular season or postseason; preseason week 1 is not
 *     week 1
 *   - forward only
 *   - a commissioner can switch it off to hold or replay a week
 */
export function advanceWeekIfDue(lg, state) {
  const meta = read(KEY.meta(lg), null);
  // ⚠️ THE DECISION LIVES IN core/league/season-clock.js, not here. It is pure
  // logic with five silent failure modes, and this file cannot be unit-tested —
  // duplicating the rules here is how the two would drift.
  const verdict = shouldAdvance(meta, state);
  if (!verdict.advance) return { skipped: verdict.reason };

  const live = verdict.to;
  const current = Number(meta.currentWeek ?? 0);

  // Final pass on the week being left behind, so its result is not frozen
  // mid-game by whichever tick happened to run last.
  let finalized = null;
  if (current >= 1) {
    try {
      // ⚠️ The last chance to record the week being left behind.
      finalized = runScoring(lg, meta.season, current, { force: true });
    } catch (err) {
      // A failed final score must not block the season from moving on — the week
      // keeps whatever score it had, and that is visible, whereas a stuck league
      // is not.
      finalized = { error: String(err.message ?? err) };
    }
  }

  mutate(KEY.meta(lg), (m) => ({ ...m, currentWeek: live }), meta);
  return { advanced: { from: current || null, to: live }, finalized };
}

/**
 * Score the OLDEST past week that never got scored, if there is one.
 *
 * ⚠️ A MISSING WEEK IS PERMANENT WITHOUT THIS. Scoring only ever writes the
 * current week, and the week advances on its own — so a node that was down for a
 * fortnight leaves a hole that never fills, and standings, seeding and the whole
 * playoff picture are quietly wrong for the rest of the season. Nothing errors:
 * the table just adds up to less than it should.
 *
 * ⚠️ ONE WEEK PER CALL, DELIBERATELY. Each week costs a 570 KB stats fetch, and
 * the scheduled budget is 5 seconds for everything the tick does across every
 * league. Repairing a fortnight in one pass would blow the deadline and get the
 * whole invocation killed — including the writes it had already made. One per
 * tick repairs twelve weeks in an hour, which is fast enough for a thing that
 * only happens after an outage.
 */
export function backfillOneWeek(lg) {
  const meta = read(KEY.meta(lg), null);
  if (!meta) return null;

  const season = Number(meta.season);
  const current = Number(meta.currentWeek ?? 0);
  if (current < 2) return null; // nothing is in the past yet

  const schedule = read(KEY.schedule(lg, season), null);
  const start = Number(schedule?.startWeek ?? meta.settings?.startWeek ?? 1);

  // ⚠️ STRICTLY BEFORE the current week. The current one is being scored live on
  // every tick; treating it as a gap would refetch the same stats twice a tick.
  for (let week = start; week < current; week++) {
    if (read(KEY.scores(lg, season, week), null)) continue;
    try {
      const result = runScoring(lg, season, week, { force: true });
      return { week, result };
    } catch (err) {
      // Report and move on rather than retrying the same week forever — a week
      // whose stats will never load must not block the ones after it.
      return { week, error: String(err.message ?? err) };
    }
  }
  return null;
}
