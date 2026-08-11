// core/draft-intel.js — what the board already knows, said out loud.
//
// PURE. No fetch, no new data, no new state. Everything here is derived from the
// picks and the ranked pool the draft board is already holding, which is the whole
// reason the ticker costs nothing: it is a read of what is on screen.
//
// ⚠️ THE TICKER IS NOT A FEED OF FACTS, IT IS A FEED OF MOMENTS. A strip that
// always has something to say is noise, and people stop reading it after about four
// picks. Everything here can return null, and null is the common case.

/** How many recent picks a run is measured over. */
export const RUN_WINDOW = 6;
/** How many of that window must share a position before it is a run. */
export const RUN_THRESHOLD = 4;
/** "Top N" — the tier scarcity is counted against. */
export const SCARCITY_TIER = 12;

/**
 * The last `n` picks, most recent first.
 *
 * ⚠️ SORTED NUMERICALLY. `picks` is an object keyed by overall pick number, and
 * Object.keys returns '10' before '9' as strings. Past the ninth pick a string sort
 * reports the wrong "most recent" pick, and every window built on it is junk —
 * silently, because the board itself looks perfectly correct.
 */
export function recentPicks(picks = {}, n = RUN_WINDOW) {
  return Object.entries(picks ?? {})
    .map(([overall, p]) => ({ ...p, overall: Number(overall) }))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, Math.max(0, n));
}

/**
 * Is a position running?
 *
 * Returns `{ pos, count, window }` or null. The window is reported back so the
 * rendered sentence and the arithmetic can never disagree about "the last 6".
 *
 * ⚠️ UNKNOWN POSITIONS ARE DROPPED, not grouped. The player index resolves ~95% of
 * ids; without this the unresolved remainder collect under '' and a board of
 * six unknowns announces a run on nothing.
 */
export function detectRun(picks = {}, {
  positionOf = () => null, window = RUN_WINDOW, threshold = RUN_THRESHOLD,
} = {}) {
  const counts = new Map();
  for (const pick of recentPicks(picks, window)) {
    const pos = String(positionOf(pick.playerId) ?? '').toUpperCase();
    if (!pos) continue;
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }

  let best = null;
  for (const [pos, count] of counts) {
    if (count < threshold) continue;
    if (best === null || count > best.count) best = { pos, count, window };
  }
  return best;
}
