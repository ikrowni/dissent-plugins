/**
 * When does a fantasy week lock? (spec 2026-10-01-nfl-week-finality-design.md)
 *
 * Owner decisions: lock at 09:00 ET on the day after the week's last kickoff once every game is
 * complete; a backstop locks 3 days after the last kickoff no matter what (a postponed or
 * cancelled game, ESPN unreachable) so a season can never stall. `reason` is always populated —
 * "nothing happened" must be explainable from the tick result.
 */
import { etDateOf, etWallTimeToUtc, nextEtDate } from './eastern-time.js';

export const LOCK_HOUR_ET = 9;
export const BACKSTOP_MS = 3 * 24 * 3_600_000;

/**
 * @param {{ games: {kickoff:number, completed:boolean}[], now: number, lastKickoffEstimate?: number }} args
 */
export function finalityVerdict({ games, now, lastKickoffEstimate }) {
  const known = (games ?? []).filter((g) => Number.isFinite(g.kickoff));
  const last = known.length ? Math.max(...known.map((g) => g.kickoff)) : lastKickoffEstimate;
  if (!Number.isFinite(last)) return { lock: false, reason: 'no games known for this week' };

  const backstopAt = last + BACKSTOP_MS;
  if (now >= backstopAt) return { lock: true, reason: 'backstop', backstopAt };
  if (known.length === 0) return { lock: false, reason: 'no games known yet', backstopAt };

  const lockAt = etWallTimeToUtc(nextEtDate(etDateOf(last)), LOCK_HOUR_ET);
  const pending = known.filter((g) => !g.completed).length;
  if (pending > 0) return { lock: false, reason: `${pending} game(s) not complete`, lockAt, backstopAt };
  if (now < lockAt) return { lock: false, reason: 'waiting for 09:00 ET', lockAt, backstopAt };
  return { lock: true, reason: 'all-games-complete', lockAt, backstopAt };
}

/**
 * Last-kickoff estimate for the BACKSTOP ONLY, when ESPN never answered for the week: the first
 * Monday on or after `seasonStart + (week-1)*7 days`. Sleeper's season_start_date is a
 * Wednesday, so a fixed day offset is wrong. A Saturday week-18 finale makes this late, never
 * early — the safe direction for a backstop.
 */
export function backstopKickoffEstimate(seasonStartDate, week) {
  const [y, m, d] = String(seasonStartDate).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + (week - 1) * 7));
  const toMonday = (1 - t.getUTCDay() + 7) % 7;
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + toMonday, 23, 59);
}
