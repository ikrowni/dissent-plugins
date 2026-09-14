// core/runFilter.js — which finished runs count toward any statistic.
//
// Owner decision 2026-09-14: runs that never got past the first floor are games started and left, not
// losses; and custom games play by other rules. Neither counts — in Insights, in Run History's default
// list, or in what is shared with community stats. The saves themselves are untouched.

export const MIN_FLOORS = 2;

/** A run summary (`floors`, `game_mode`) or an Insights digest (`floors`, `gameMode`). */
export function countsForStats(r) {
  const mode = r?.game_mode ?? r?.gameMode;
  return (Number(r?.floors) || 0) >= MIN_FLOORS && mode !== 'custom';
}
