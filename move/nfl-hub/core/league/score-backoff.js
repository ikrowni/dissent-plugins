// core/league/score-backoff.js — how often a week gets re-scored.
//
// PURE, so the rule that decides whether scores refresh is testable. The server
// half is a thin adapter over it; server/*.js has no unit tests, and this is not
// logic to leave uncovered — get it wrong in one direction and the node burns
// half a megabyte every five minutes recomputing a frozen number, get it wrong
// in the other and a live game silently stops updating.
//
// ⚠️ ADAPTIVE, BECAUSE THE CALENDAR IS NOT KNOWABLE HERE. NFL games occupy about
// 16 of the 168 hours in a week, so roughly nine in ten scoring passes re-fetch
// half a megabyte to recompute a number that cannot have changed. Deciding that
// from a schedule would mean shipping kickoff times and a timezone, and being
// wrong every time a game moves. Watching its own output costs nothing and is
// never out of date.

/** Every tick, when something is happening. */
export const BASE_MS = 5 * 60 * 1000;

/**
 * ⚠️ THE CAP IS DELIBERATELY LOW. It bounds how long after kickoff a dormant
 * league can take to notice play has resumed. At twenty minutes the first pass
 * that sees a score reset it to BASE, so a live game is never more than one
 * interval behind — and the saving from 20 minutes to an hour is small next to
 * the saving already made from five.
 */
export const CAP_MS = 20 * 60 * 1000;

/** Bounded so the doubling cannot overflow into nonsense on a long quiet week. */
const MAX_STREAK = 8;

/**
 * A cheap signature of a week's result: changes if and only if somebody's total
 * moved.
 *
 * ⚠️ TOTALS ONLY, and sorted. Hashing the whole record would change whenever a
 * lineup row was reordered or a player was benched between identical scores,
 * which would reset the backoff constantly and defeat the entire mechanism.
 */
export function fingerprintOf(results = {}) {
  return Object.keys(results)
    .sort()
    .map((t) => `${t}:${results[t]?.total ?? 0}`)
    .join('|');
}

/**
 * Is this week due to be scored again?
 *
 * A week that has never been scored is always due — the backoff can only ever
 * delay a REFRESH, never the first pass.
 */
export function isDue(prev, now = Date.now()) {
  if (!prev || typeof prev.nextScoreAt !== 'number') return true;
  return now >= prev.nextScoreAt;
}

/**
 * The next interval, given what the pass just produced.
 *
 * Unchanged doubles the wait; any change drops straight back to BASE.
 */
export function nextBackoff(prev, fingerprint, now = Date.now()) {
  const unchanged = Boolean(prev) && prev.fingerprint === fingerprint;
  const quietRuns = unchanged ? Math.min((prev.quietRuns ?? 0) + 1, MAX_STREAK) : 0;
  const wait = Math.min(BASE_MS * 2 ** quietRuns, CAP_MS);
  return { quietRuns, wait, nextScoreAt: now + wait };
}
