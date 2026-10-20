// ul-backdrop.js — what's behind the room, at parallax: a far fire glow, cold light from cracks above, the buried
// town's houses with amber windows (houses are nodes, from the brand), arches, and hanging roots.
import { between } from './ul-rng.js';

export function buildBackdrop(room, r) {
  const B = { houses: [], arches: [], roots: [], motes: [] };
  for (let x = -200; x < room.w * 0.3 + 1400;) {
    const w = between(r, 50, 110);
    B.houses.push({ x, w, h: between(r, 60, 150), roof: between(r, 18, 40), win: r() < 0.55, wx: between(r, 0.25, 0.6), chim: r() < 0.4 });
    x += w + between(r, 6, 40);
  }
  for (let x = -100; x < room.w * 0.55 + 1400; x += between(r, 180, 300)) B.arches.push({ x, w: between(r, 120, 220), h: between(r, 200, 320) });
  for (let i = 0; i < 40; i++) B.roots.push({ x: between(r, -200, room.w * 0.8 + 1200), len: between(r, 40, 160), sway: r() * 6, w: between(r, 1, 3) });
  for (let i = 0; i < 90; i++) B.motes.push({ x: r() * room.w, y: r() * room.h, s: between(r, 0.4, 1.4), a: r() * 6 });
  return B;
}

/** v: the view ({ W, H, S, camL, camT }); screen pixels. */
export function drawBackdrop(g, B, room, v, t, VIEW_H) {
  const { W, H, S, camL, camT } = v;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0a1118'); sky.addColorStop(0.55, '#16222b'); sky.addColorStop(1, '#2c1c12');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const fx = (room.w * 0.62 - camL * 0.15) * S, glow = g.createRadialGradient(fx, H * 0.95, 10, fx, H * 0.95, H * 0.9);
  glow.addColorStop(0, 'rgba(255,150,70,0.45)'); glow.addColorStop(0.4, 'rgba(200,90,40,0.12)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const bx = (i * 520 + 180 - camL * 0.25) * S, sway = Math.sin(t * 0.3 + i) * 10 * S;
    const beam = g.createLinearGradient(bx, 0, bx + 120 * S, H);
    beam.addColorStop(0, 'rgba(160,210,230,0.10)'); beam.addColorStop(1, 'rgba(160,210,230,0)');
    g.fillStyle = beam; g.beginPath(); g.moveTo(bx, 0); g.lineTo(bx + 46 * S, 0); g.lineTo(bx + 230 * S + sway, H); g.lineTo(bx + 120 * S + sway, H); g.fill();
  }
  g.restore();
  const lift = camT - (room.h - VIEW_H);
  g.fillStyle = '#1d2830';
  for (const a of B.arches) {
    const ax = (a.x - camL * 0.55) * S, aw = a.w * S, ah = a.h * S, ay = H * 0.98 - lift * 0.55 * S;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax, ay - ah); g.lineTo(ax + aw, ay - ah); g.lineTo(ax + aw, ay);
    g.lineTo(ax + aw - 22 * S, ay); g.lineTo(ax + aw - 22 * S, ay - ah * 0.55);
    g.quadraticCurveTo(ax + aw / 2, ay - ah * 0.95, ax + 22 * S, ay - ah * 0.55); g.lineTo(ax + 22 * S, ay); g.fill();
  }
  const base = H * 0.86 - lift * 0.3 * S;
  for (const hs of B.houses) {
    const hx = (hs.x - camL * 0.3) * S, w = hs.w * S, h = hs.h * S, rf = hs.roof * S;
    g.fillStyle = '#26313a';
    g.beginPath(); g.moveTo(hx, base); g.lineTo(hx, base - h); g.lineTo(hx + w / 2, base - h - rf); g.lineTo(hx + w, base - h); g.lineTo(hx + w, base); g.fill();
    if (hs.chim) g.fillRect(hx + w * 0.7, base - h - rf * 0.8, 8 * S, rf * 0.7);
    if (hs.win) { g.fillStyle = 'rgba(255,170,80,0.55)'; g.fillRect(hx + w * hs.wx, base - h * 0.62, 7 * S, 9 * S); }
  }
  g.fillStyle = '#26313a'; g.fillRect(0, base, W, H - base);
  g.strokeStyle = '#0f151a';
  for (const r of B.roots) {
    const rx = (r.x - camL * 0.6) * S, top = (-camT * 0.6 + 30) * S, sw = Math.sin(t * 0.6 + r.sway) * 6 * S;
    g.lineWidth = r.w * S; g.beginPath(); g.moveTo(rx, top); g.quadraticCurveTo(rx + sw, top + r.len * S * 0.5, rx + sw * 1.6, top + r.len * S); g.stroke();
  }
}
