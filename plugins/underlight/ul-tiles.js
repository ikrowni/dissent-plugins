// ul-tiles.js — the room's stone, spikes and thin ledges in black, with a rim of lantern colour on edges near light.
import { TS, VIEW_H } from './ul-const.js';
import { solid } from './ul-room.js';

export function drawTiles(g, room, L, v) {
  const c0 = Math.max(0, Math.floor(v.camL / TS) - 1), c1 = Math.min(room.cols - 1, Math.ceil((v.camL + v.VW) / TS) + 1);
  const r0 = Math.max(0, Math.floor(v.camT / TS) - 1), r1 = Math.min(room.rows - 1, Math.ceil((v.camT + VIEW_H) / TS) + 1);
  const lightAt = (x, y) => {
    let best = 0, rgb = null;
    for (const l of L) { const d = Math.hypot(x - l.x, y - l.y); if (d < l.r) { const k = 1 - d / l.r; if (k > best) { best = k; rgb = l.rgb; } } }
    return [best, rgb];
  };
  const rim = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const t = room.tiles[r][c], x = c * TS, y = r * TS;
    if (t === '#') {
      g.fillStyle = '#040506'; g.fillRect(x, y, TS + 0.6, TS + 0.6);
      if (!solid(room, c, r - 1)) { const [k, rgb] = lightAt(x + TS / 2, y); if (k > 0.02) { g.fillStyle = rim(rgb, Math.min(0.85, k * 1.4)); g.fillRect(x, y, TS + 0.6, 1.6); } }
      const openL = !solid(room, c - 1, r), openR = !solid(room, c + 1, r);
      if (openL || openR) {
        const side = openL ? x : x + TS - 1.2, [k, rgb] = lightAt(side, y + TS / 2);
        if (k > 0.05) { g.fillStyle = rim(rgb, Math.min(0.5, k)); g.fillRect(side, y, 1.2, TS); }
      }
    } else if (t === '^') {
      g.fillStyle = '#040506'; g.fillRect(x, y + 10, TS, TS - 10);
      g.beginPath(); for (let i = 0; i < 4; i++) { g.moveTo(x + i * 6, y + 12); g.lineTo(x + i * 6 + 3, y + 1); g.lineTo(x + i * 6 + 6, y + 12); } g.fill();
      const [k] = lightAt(x + TS / 2, y);
      if (k > 0.05) { g.fillStyle = `rgba(200,80,60,${k * 0.8})`; for (let i = 0; i < 4; i++) g.fillRect(x + i * 6 + 2.4, y + 1, 1.2, 3); }
    } else if (t === '-') {
      g.fillStyle = '#07080a'; g.fillRect(x - 0.3, y, TS + 0.6, 5);
      if (room.tiles[r][c - 1] !== '-' || c % 4 === 0) g.fillRect(x + 3, y + 5, 2, 7);
      const [k, rgb] = lightAt(x + TS / 2, y);
      if (k > 0.03) { g.fillStyle = rim(rgb, Math.min(0.8, k * 1.3)); g.fillRect(x, y, TS + 0.6, 1.2); }
    }
  }
}

/** Spikes, drawn again over the darkness (owner, 2026-10-21: "very hard to see even in the light"): a pale steel
 *  edge on each point and a red tip. Strong where there is light, faint but never gone in the dark, so a spike
 *  never hurts you unseen. The same 4 points as drawTiles. */
export function drawSpikeGlints(g, room, L, v, t, reduced) {
  const c0 = Math.max(0, Math.floor(v.camL / TS) - 1), c1 = Math.min(room.cols - 1, Math.ceil((v.camL + v.VW) / TS) + 1);
  const r0 = Math.max(0, Math.floor(v.camT / TS) - 1), r1 = Math.min(room.rows - 1, Math.ceil((v.camT + VIEW_H) / TS) + 1);
  g.save(); g.lineWidth = 1.1;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (room.tiles[r][c] !== '^') continue;
    const x = c * TS, y = r * TS;
    let k = 0;
    for (const l of L) { const d = Math.hypot(x + TS / 2 - l.x, y - l.y); if (d < l.r) k = Math.max(k, 1 - d / l.r); }
    const a = Math.min(1, 0.28 + k * 1.2) * (reduced ? 1 : 0.9 + Math.sin(t * 2 + c) * 0.1);
    g.strokeStyle = `rgba(215,205,195,${a * 0.85})`; g.beginPath();
    for (let i = 0; i < 4; i++) { g.moveTo(x + i * 6, y + 12); g.lineTo(x + i * 6 + 3, y + 1); g.lineTo(x + i * 6 + 6, y + 12); }
    g.stroke();
    g.fillStyle = `rgba(230,70,50,${a})`;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + i * 6 + 1.6, y + 4.5); g.lineTo(x + i * 6 + 3, y + 1); g.lineTo(x + i * 6 + 4.4, y + 4.5); g.fill(); }
  }
  g.restore();
}
