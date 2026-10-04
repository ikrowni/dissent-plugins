// dnd-player-zones.js — how loud a sound zone is where my token stands. A zone is stored in squares (centre x, y and
// a radius); my Hub sends my token's place in squares too (dnd-hub-zone-pos.js). Full volume at the centre, fading
// in a straight line to silence at the edge, silent outside.

/** The volume (0..1) of `zone` for a token at square `cell` ({ x, y }); 0 when either is unknown. */
export function zoneVolume(zone, cell) {
  if (!zone || !cell || !(zone.radius > 0)) return 0;
  const dist = Math.hypot(cell.x - zone.x, cell.y - zone.y);
  if (dist >= zone.radius) return 0;
  const max = Math.min(1, Math.max(0, zone.maxVolume ?? 1));
  return Math.round(max * (1 - dist / zone.radius) * 1000) / 1000;
}
