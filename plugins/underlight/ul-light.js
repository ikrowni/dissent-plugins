// ul-light.js — what lights there are, how far each reaches, and what each one actually lights (walls cast shadows).
import { TS } from './ul-const.js';
import { solid, solidPt } from './ul-room.js';

/** Your light's reach from your oil (spec §4.1). At zero it is a spark. */
export const oilRadius = (oil) => (oil <= 0 ? 34 : 70 + oil * 2.3);
export const SNUFFED_RADIUS = 30, HAND_RADIUS = 46, SCONCE_RADIUS = 175, EMBER_RADIUS = 22;
export const LANTERN_RGB = [255, 182, 100], SCONCE_RGB = [255, 170, 90];

/** Every boundary between stone and air, merged into long runs: the edges that cast shadows. [x0, y0, x1, y1]. */
export function buildSegs(room) {
  const segs = [];
  for (let r = 0; r <= room.rows; r++) {
    let start = 0, side = 0;
    for (let c = 0; c <= room.cols; c++) {
      const a = c < room.cols && r > 0 && solid(room, c, r - 1), b = c < room.cols && r < room.rows && solid(room, c, r);
      const e = c < room.cols && a !== b ? (a ? 1 : 2) : 0;
      if (e !== side) { if (side) segs.push([start * TS, r * TS, c * TS, r * TS]); start = c; side = e; }
    }
  }
  for (let c = 0; c <= room.cols; c++) {
    let start = 0, side = 0;
    for (let r = 0; r <= room.rows; r++) {
      const a = r < room.rows && c > 0 && solid(room, c - 1, r), b = r < room.rows && c < room.cols && solid(room, c, r);
      const e = r < room.rows && a !== b ? (a ? 1 : 2) : 0;
      if (e !== side) { if (side) segs.push([c * TS, start * TS, c * TS, r * TS]); start = r; side = e; }
    }
  }
  return segs;
}

/** Distance along a ray (unit dx, dy) from px, py to segment s, or null if it misses. */
export function raySeg(px, py, dx, dy, s) {
  const sx = s[2] - s[0], sy = s[3] - s[1], den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-9) return null;
  const ax = s[0] - px, ay = s[1] - py;
  const t = (ax * sy - ay * sx) / den, u = (ax * dy - ay * dx) / den;
  return t >= 0 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null;
}

/** The lit area of one light as a polygon (flat [x, y, x, y…]): rays to every wall corner in reach, plus a circle. */
export function visPoly(segs, lx, ly, R) {
  const near = [], angles = [];
  for (const s of segs) {
    if (Math.max(s[0], s[2]) < lx - R || Math.min(s[0], s[2]) > lx + R || Math.max(s[1], s[3]) < ly - R || Math.min(s[1], s[3]) > ly + R) continue;
    near.push(s);
    for (let k = 0; k < 4; k += 2) { const a = Math.atan2(s[k + 1] - ly, s[k] - lx); angles.push(a - 0.0005, a, a + 0.0005); }
  }
  for (let i = 0; i < 40; i++) angles.push(-Math.PI + (i * Math.PI) / 20);
  angles.sort((a, b) => a - b);
  const pts = new Float32Array(angles.length * 2);
  for (let i = 0; i < angles.length; i++) {
    const dx = Math.cos(angles[i]), dy = Math.sin(angles[i]);
    let best = R;
    for (const s of near) { const t = raySeg(lx, ly, dx, dy, s); if (t !== null && t < best) best = t; }
    pts[i * 2] = lx + dx * best; pts[i * 2 + 1] = ly + dy * best;
  }
  return pts;
}

/** Can light (or sight) pass from one point to the other? Checked every 8 units. */
export function los(room, x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
  for (let i = 1; i < n; i++) if (solidPt(room, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n)) return false;
  return true;
}

/**
 * Every light right now: { x, y, r, rgb, kind }. kind is player (in your hand), lantern (thrown), hand (the faint
 * glow you keep while it's thrown), sconce (lit), ember (an unlit sconce's coal, too faint to count).
 */
export function makeLights(S) {
  const p = S.player, L = [];
  const r = p.snuffT > 0 ? SNUFFED_RADIUS : oilRadius(p.oil);
  if (!p.dead) {
    if (S.lantern.state === 'held') { const h = handPos(p); L.push({ x: h.x, y: h.y, r, rgb: LANTERN_RGB, kind: 'player' }); }
    else {
      L.push({ x: S.lantern.x, y: S.lantern.y, r, rgb: LANTERN_RGB, kind: 'lantern' });
      L.push({ x: p.x + p.w / 2, y: p.y + 18, r: HAND_RADIUS, rgb: LANTERN_RGB, kind: 'hand' });
    }
  }
  for (const s of S.sconces) L.push({ x: s.x, y: s.y, r: s.lit ? SCONCE_RADIUS : EMBER_RADIUS, rgb: SCONCE_RGB, kind: s.lit ? 'sconce' : 'ember' });
  return L;
}

/** Where the lantern hangs from your back hand. */
export const handPos = (p) => ({ x: p.x + p.w / 2 - p.face * 10, y: p.y + 22 });

/** How lit a point is, 0..1, and by which light. Embers don't count; walls block. */
export function lightLevel(room, L, x, y) {
  let v = 0, src = null;
  for (const l of L) {
    if (l.kind === 'ember') continue;
    const d = Math.hypot(x - l.x, y - l.y);
    if (d >= l.r) continue;
    const k = 1 - d / l.r;
    if (k > v && los(room, l.x, l.y, x, y)) { v = k; src = l; }
  }
  return { v, src };
}
