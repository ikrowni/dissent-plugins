// dnd-hub-pack-map.js — draws a content-pack map (cells) to a PNG, so the picture and the walls/doors/lights
// compileMap produces come from the same numbers. Code-drawn (owner, 2026-10-03): no art to license.

const FLOOR = { stone: ['#3b3530', '#2f2a26'], sand: ['#6b5a3e', '#5e4f36'], water: ['#1f3a44', '#1a323b'], wood: ['#4a3626', '#3f2e20'] };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Render `m` (pack map) to a PNG Blob. */
export async function drawPackMap(m) {
  const gs = m.gridSize || 50;
  const W = m.cols * gs, H = m.rows * gs;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const r = rng(7);
  g.fillStyle = '#0d0c0b'; g.fillRect(0, 0, W, H);                        // rock

  for (const room of m.rooms) {                                           // floors, a tile per cell
    const [a, b] = FLOOR[room.floor] || FLOOR.stone;
    for (let x = room.x; x < room.x + room.w; x++) for (let y = room.y; y < room.y + room.h; y++) {
      g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * gs, y * gs, gs, gs);
      g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.12})`;
      g.fillRect(x * gs + 2, y * gs + 2, gs - 4, gs - 4);
      if (room.floor === 'water') { g.strokeStyle = 'rgba(160,210,230,.18)'; g.beginPath(); g.arc(x * gs + r() * gs, y * gs + r() * gs, 6 + r() * 8, 0, Math.PI); g.stroke(); }
    }
  }
  for (const d of m.decor || []) {                                        // stairs, crates, tables, lanterns
    if (d.type === 'stairs') { g.fillStyle = '#2a2622'; g.fillRect(d.x * gs, d.y * gs, d.w * gs, d.h * gs);
      g.strokeStyle = '#6d6052'; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(d.x * gs, d.y * gs + i * d.h * gs / 6); g.lineTo((d.x + d.w) * gs, d.y * gs + i * d.h * gs / 6); g.stroke(); } }
    if (d.type === 'crates' || d.type === 'table') { g.fillStyle = d.type === 'table' ? '#5a4129' : '#6b4f2e';
      g.fillRect(d.x * gs + 6, d.y * gs + 6, d.w * gs - 12, d.h * gs - 12); g.strokeStyle = '#2b1e12'; g.strokeRect(d.x * gs + 6, d.y * gs + 6, d.w * gs - 12, d.h * gs - 12); }
    if (d.type === 'lantern') { const x = (d.cx + 0.5) * gs, y = (d.cy + 0.5) * gs;
      g.fillStyle = '#d4af37'; g.fillRect(x - 6, y - 9, 12, 18); g.fillStyle = '#1b1712'; g.fillRect(x - 3, y - 5, 6, 10); }
  }
  for (const l of m.lights || []) {                                       // torch glow
    const x = (l.cx + 0.5) * gs, y = (l.cy + 0.5) * gs, rad = (l.feet / 5) * gs * 0.6;
    const grd = g.createRadialGradient(x, y, 2, x, y, rad);
    grd.addColorStop(0, 'rgba(255,200,110,.35)'); grd.addColorStop(1, 'rgba(255,200,110,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  // Walls: the same compileMap walls the Hub uses, so picture and collision agree.
  const { compileMap } = await import('./lk-content-pack.js');
  const c = compileMap(m);
  g.lineCap = 'square';
  for (const w of c.walls) { g.strokeStyle = '#151210'; g.lineWidth = 10; g.beginPath(); g.moveTo(w.x1, w.y1); g.lineTo(w.x2, w.y2); g.stroke();
    g.strokeStyle = '#7a6a55'; g.lineWidth = 3; g.beginPath(); g.moveTo(w.x1, w.y1); g.lineTo(w.x2, w.y2); g.stroke(); }
  for (const d of Object.values(c.doors)) { g.strokeStyle = d.state === 'locked' ? '#8a2b1f' : '#7b5530'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(d.x1, d.y1); g.lineTo(d.x2, d.y2); g.stroke(); }
  return await new Promise(res => cv.toBlob(res, 'image/png'));
}
