/**
 * How long ago a round started, for catching up when the game opens late (owner report 2026-10-21: players whose
 * PC clock ran a few seconds ahead read as "opened late", jumped their clock forward and moved before GO).
 *
 * 🔴 Never compare this machine's clock with the node's `started_at`. The node says how long ago the round
 * started by its own clock (`elapsed_ms`, when it sent the lobby); add only the time since this machine received
 * it, which is measured on one clock. An older node without `elapsed_ms` falls back to the old comparison.
 */
export function lateMs(l, receivedAt, now) {
  if (typeof l.elapsed_ms === "number") return l.elapsed_ms + Math.max(0, now - receivedAt);
  return l.started_at ? now - Date.parse(l.started_at) : 0;
}
