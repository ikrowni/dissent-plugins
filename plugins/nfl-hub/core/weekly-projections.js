// core/weekly-projections.js — what a player is projected to score THIS WEEK.
//
// ⚠️ WEEKLY, NOT SEASONAL, and the distinction is the whole reason this module
// exists. A season total shipped in the ranking asset answers "how good is he",
// which is the draft and trade question. On a lineup screen the question is
// "should I start him on Sunday", and a season number cannot answer it — it does
// not move when a player is hurt, benched, on bye, or facing the best defence in
// the league. Reported 2026-08-31: "we need the project scores for the week not
// for the season."
//
// ⚠️ NOT A BUILD-TIME ASSET, unlike the ranking. Weekly projections change every
// week and within a week; anything baked at build time is wrong by Sunday. This
// is a runtime fetch, cached per (season, week) for the session.
//
// ⚠️ 542 KB PER WEEK, AGAINST A 1 MB PROXY CEILING (plugins_fetch.go reads with
// `io.LimitReader(resp.Body, 1<<20)`). It fits, with room — but only just, and
// only per week. The SEASON projections payload is 2.6 MB and would be truncated
// into invalid JSON, which is why this is never fetched whole.

import { getJson } from './http.js';
import { scoreStatLine } from './league/scoring.js';

const cache = new Map();   // "season:week" -> { [playerId]: rawStatLine }
const inflight = new Map();

const keyFor = (season, week) => `${season}:${week}`;

/** Inject a week's raw projections directly. For tests. */
export function setWeekProjections(season, week, byPlayer) {
  cache.set(keyFor(season, week), byPlayer);
}

/** Forget everything. For tests, and for an account switch. */
export function resetProjections() {
  cache.clear();
  inflight.clear();
}

/**
 * Load one week of raw projected stat lines.
 *
 * ⚠️ RESOLVES TO NULL ON FAILURE RATHER THAN THROWING. This feeds one COLUMN of
 * a lineup; a dead upstream must cost that column and nothing else. Every caller
 * already renders "—" for a player it has no number for, so a total failure is a
 * state the table can already draw.
 *
 * Concurrent callers share one request — the roster and a matchup lineup mount
 * together and would otherwise pull half a megabyte twice.
 */
export async function loadWeekProjections(season, week) {
  const s = Number(season);
  const w = Number(week);
  if (!Number.isFinite(s) || !Number.isInteger(w) || w < 1) return null;
  const k = keyFor(s, w);
  if (cache.has(k)) return cache.get(k);
  if (inflight.has(k)) return inflight.get(k);

  const p = (async () => {
    try {
      const data = await getJson(`https://api.sleeper.app/v1/projections/nfl/regular/${s}/${w}`);
      const byPlayer = data && typeof data === 'object' ? data : {};
      cache.set(k, byPlayer);
      return byPlayer;
    } catch {
      // ⚠️ A FAILURE IS NOT CACHED. Caching it would make one blip permanent for
      // the session, and this is a column somebody will look at again in a
      // minute — the next mount should get a fresh attempt.
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

/**
 * A player's projected points for one week, under a league's own scoring.
 *
 * 🔴 SCORED FROM RAW STATS, NEVER FROM `pts_ppr`. Sleeper's own point fields are
 * ITS default scoring and know nothing about a league's settings — the same rule
 * the actual-scoring path follows, and for the same reason: a half-PPR league
 * reading `pts_ppr` sees numbers that do not match the ones it plays for. The
 * projection is run through `scoreStatLine` with the league's weight map, which
 * is the identical function that scores the real week.
 *
 * Returns null when the week is not loaded or the player has no projection —
 * rendered "—", never 0, because 0 is a real projection for someone not playing.
 */
export function projectedThisWeek(playerId, { season, week, scoring }) {
  const line = cache.get(keyFor(Number(season), Number(week)))?.[String(playerId)];
  if (!line || typeof line !== 'object') return null;
  if (!scoring || typeof scoring !== 'object') return null;
  return scoreStatLine(line, scoring);
}
