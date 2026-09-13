// core/wilson.js — a proportion with an honest range. Used for every rate the plugin shows.
//
// Wilson rather than "k/n ± 1.96·√(p(1−p)/n)": that one collapses to [0, 0] at 0 of 3 and runs past
// 1 near the top, which is exactly where a player with few runs lives.

/** `{ rate, low, high }` for k successes in n, or null when n is not positive. */
export function wilson(k, n, z = 1.96) {
  if (!(n > 0)) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}
