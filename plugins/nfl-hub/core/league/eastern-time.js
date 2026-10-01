/**
 * Eastern time without a timezone database.
 *
 * The plugin's server runtime (WASM) may have no Intl timezone data, and fantasy weeks lock at
 * 09:00 ET — across the November DST change, which the season always crosses. US rule: EDT
 * (UTC-4) from 02:00 local on the second Sunday of March to 02:00 local on the first Sunday of
 * November; EST (UTC-5) otherwise. Months here are 1-12.
 */

function nthSundayUtcDay(year, month1, n) {
  const first = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay(); // 0 = Sunday
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

/** UTC instants at which DST starts and ends in a given year. */
function dstBounds(year) {
  const start = Date.UTC(year, 2, nthSundayUtcDay(year, 3, 2), 2 + 5); // 02:00 EST = 07:00 UTC
  const end = Date.UTC(year, 10, nthSundayUtcDay(year, 11, 1), 2 + 4); // 02:00 EDT = 06:00 UTC
  return { start, end };
}

/** -4 during EDT, -5 during EST. */
export function etOffsetHours(utcMs) {
  const y = new Date(utcMs).getUTCFullYear();
  const { start, end } = dstBounds(y);
  return utcMs >= start && utcMs < end ? -4 : -5;
}

/** The ET calendar date an instant falls on. */
export function etDateOf(utcMs) {
  const local = new Date(utcMs + etOffsetHours(utcMs) * 3_600_000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}

/** The UTC instant of `hour`:00 ET on a given ET calendar date. */
export function etWallTimeToUtc({ y, m, d }, hour) {
  // Guess with EST, then correct with the offset actually in force at that instant.
  const guess = Date.UTC(y, m - 1, d, hour + 5);
  return Date.UTC(y, m - 1, d, hour - etOffsetHours(guess));
}

/** The ET calendar date one day after the given one. */
export function nextEtDate({ y, m, d }) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
