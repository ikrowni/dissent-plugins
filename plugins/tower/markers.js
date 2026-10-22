import { WL, WR } from "./tuning.js";

/**
 * Players off screen show as pills at the top or bottom edge: name, an arrow, how many floors away (§3.3).
 * Pills that would overlap are pushed apart, then the row is pulled back inside the walls.
 */

export function layoutMarkers(items) {
  const out = [];
  for (const up of [true, false]) {
    const row = items.filter((m) => m.up === up).map((m) => ({ ...m })).sort((a, b) => a.x - b.x);
    let prev = -Infinity;
    for (const m of row) {
      m.x = Math.max(Math.min(Math.max(m.x, WL + m.w / 2), WR - m.w / 2), prev + m.w / 2 + 6);
      prev = m.x + m.w / 2;
    }
    const last = row[row.length - 1];
    const over = last ? last.x + last.w / 2 - WR : 0;
    if (over > 0) for (const m of row) m.x -= over;
    out.push(...row);
  }
  return out;
}
