// Week finality — spec docs/superpowers/specs/2026-10-01-nfl-week-finality-design.md (monorepo).
// A week's score record carries `final`; standings and the bracket count only final weeks.
import { fetchJSON } from "./sdk/server-sdk.js";
import { KEY, read, mutate, loadLeague } from "./store.js";
import { requireCommissioner } from "./auth.js";
import { runScoring } from "./ops-scoring.js";
import { finalityVerdict, backstopKickoffEstimate } from "../core/league/week-finality.js";
import { scoreboardUrl, gamesFromScoreboard } from "../core/league/espn-week.js";

const refuse = (msg) => { throw new Error(msg); };

/** Oldest scored, non-final week of the season, or null. */
function oldestOpenWeek(lg, season, upTo) {
  for (let w = 1; w <= upTo; w++) {
    const s = read(KEY.scores(lg, season, w), null);
    if (s && !s.final) return w;
  }
  return null;
}

function stamp(lg, season, week, fields) {
  return mutate(KEY.scores(lg, season, week), (cur) => {
    if (!cur) return cur;
    const { reopenedAt: _a, reopenedBy: _b, ...rest } = cur;
    return { ...rest, final: true, finalAt: Date.now(), ...fields };
  }, null);
}

/**
 * Tick step: lock the oldest non-final week if it is due. ONE week per tick (5 s budget; each
 * check is a ~160 KB fetch). `now` is injectable for tests.
 *
 * ⚠️ NO FETCH BEFORE THE STORED lockAt. The current week is open all week, so without this the
 * tick would download the scoreboard every 5 minutes for nothing. Skipping is safe: a postponed
 * game only moves lockAt later, and the check at the old lockAt sees it and stores the new one.
 */
export function finalizeOldestIfDue(lg, nflState, now = Date.now()) {
  const meta = read(KEY.meta(lg), null);
  if (!meta) return { skipped: "no league" };
  const season = Number(meta.season);
  const week = oldestOpenWeek(lg, season, Number(meta.currentWeek ?? 0));
  if (!week) return { skipped: "nothing open" };

  const stored = read(KEY.scores(lg, season, week), null);
  if (Number.isFinite(stored?.lockAt) && now < stored.lockAt) {
    return { week, locked: false, reason: "waiting for 09:00 ET", lockAt: stored.lockAt };
  }

  let games = null;
  try { games = gamesFromScoreboard(fetchJSON({ url: scoreboardUrl(season, week) })); } catch { games = null; }
  const estimate = nflState?.season_start_date ? backstopKickoffEstimate(nflState.season_start_date, week) : undefined;
  const v = finalityVerdict({ games: games ?? [], now, lastKickoffEstimate: games ? undefined : estimate });
  if (!v.lock) {
    if (Number.isFinite(v.lockAt) && v.lockAt !== stored?.lockAt) {
      mutate(KEY.scores(lg, season, week), (cur) => (cur && !cur.final ? { ...cur, lockAt: v.lockAt } : cur), null);
    }
    return { week, locked: false, reason: v.reason, lockAt: v.lockAt ?? null };
  }

  runScoring(lg, season, week, { force: true }); // the last pass before the lock
  stamp(lg, season, week, { finalReason: v.reason });
  return { week, locked: true, reason: v.reason };
}

/** The league, season and week a commissioner action names — refused unless a commissioner. */
function commissionerWeek(p, payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  const { meta } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  if (!Number.isInteger(week) || week < 1) refuse("week must be a positive integer");
  return { lg, season, week };
}

/** Commissioner: lock a week now. */
export function finalizeWeek({ p, payload }) {
  const { lg, season, week } = commissionerWeek(p, payload);
  if (!read(KEY.scores(lg, season, week), null)) refuse(`week ${week} has not been scored yet`);
  runScoring(lg, season, week, { force: true });
  stamp(lg, season, week, { finalReason: "commissioner", finalBy: p.userId });
  return { week, final: true };
}

/** Commissioner: unlock a week so it re-scores; it locks again under the normal rules. */
export function reopenWeek({ p, payload }) {
  const { lg, season, week } = commissionerWeek(p, payload);
  mutate(KEY.scores(lg, season, week), (cur) => {
    if (!cur) return cur;
    const { final: _f, finalAt: _a, finalReason: _r, finalBy: _b, ...rest } = cur;
    return { ...rest, reopenedAt: Date.now(), reopenedBy: p.userId };
  }, null);
  return {
    week, final: false,
    note: "Reopened. It re-scores on the next run and locks again. A playoff round already decided from this week is NOT undone.",
  };
}
