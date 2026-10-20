// ul-solver.js — can this level be finished? It flies the player's own physics (the same numbers and order of
// operations as ul-player.js: run, held jumps, drops through thin ledges; no roll, no lantern, no ledge grab) from
// every spot you can stand on, and reports what is reachable, whether the stairs are, and any trap: a spot you can
// reach but can't get from to the stairs. The level builder re-rolls a level with any problem (spec §6).
import { TS, DT } from './ul-const.js';
import { tileAt, isSolidTile } from './ul-room.js';
import { moveX, moveY } from './ul-physics.js';

const W = 18, H = 40, MAX_STEPS = 300;
const HOLDS = [5, 12, 24, 60];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Standing at column c with the floor at row r + 1. */
export function standable(room, c, r) {
  const below = tileAt(room, c, r + 1);
  return (below === '#' || below === '-') && !isSolidTile(tileAt(room, c, r)) && !isSolidTile(tileAt(room, c, r - 1));
}
const bodyAt = (c, r) => ({ x: c * TS + 3, y: (r + 1) * TS - H, w: W, h: H, vx: 0, vy: 0 });

/**
 * One flight: { dir, hold (steps the jump is held; 0 = no jump), steer (steps dir is held; then airDir), airDir,
 * drop (drop through a thin ledge), ground (starting on the ground) }. Mirrors stepPlayer's air movement.
 * Returns the body where it landed, or null (spikes, out of the room, still flying). trace collects positions.
 */
export function flight(room, T, body, prog, trace) {
  const b = { ...body };
  let cut = false, dropT = prog.drop ? 0.22 : 0;
  if (prog.hold > 0) b.vy = -T.jump;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (step > 0) dropT = Math.max(0, dropT - DT);
    const dir = step < (prog.steer ?? MAX_STEPS) ? prog.dir : prog.airDir ?? 0;
    const ground = step === 0 && prog.ground;
    const a = ground ? (dir ? T.accel : T.decel) : T.airAccel;
    b.vx += clamp(dir * T.run - b.vx, -a * DT, a * DT);
    if (step >= prog.hold && b.vy < 0 && !cut) { b.vy *= 0.45; cut = true; }
    b.vy = Math.min(b.vy + T.gravity * (b.vy > 0 ? T.fallMult : 1) * DT, 950);
    moveX(room, b, b.vx * DT);
    moveY(room, b, b.vy * DT, dropT <= 0);
    if (trace) trace.push([b.x, b.y]);
    if (b.spiked || b.y > room.h) return null;
    if (b.onGround && step > 0) return b;
  }
  return null;
}

/** Every flight worth trying from a standing spot. */
function programs(room, T, c, r) {
  const out = [], base = bodyAt(c, r);
  for (const dir of [-1, 0, 1]) {
    const runUp = dir !== 0 && standable(room, c - dir, r);
    for (const hold of HOLDS) for (const airDir of dir ? [dir, 0] : [0]) {
      out.push({ body: base, prog: { dir, hold, airDir, steer: airDir === dir ? MAX_STEPS : hold, ground: true } });
      if (runUp) out.push({ body: { ...base, vx: dir * T.run }, prog: { dir, hold, airDir, steer: airDir === dir ? MAX_STEPS : hold, ground: true } });
    }
  }
  if (tileAt(room, c, r + 1) === '-') for (const dir of [-1, 0, 1]) out.push({ body: base, prog: { dir, hold: 0, drop: true, ground: true } });
  for (const d of [-1, 1]) { // walking off an edge, holding on or letting go
    if (standable(room, c + d, r) || isSolidTile(tileAt(room, c + d, r)) || isSolidTile(tileAt(room, c + d, r - 1))) continue;
    const off = { ...bodyAt(c + d, r), vx: d * T.run };
    out.push({ body: off, prog: { dir: d, hold: 0 } }, { body: off, prog: { dir: 0, hold: 0 } });
  }
  return out;
}

/**
 * Everything about one room: { reach: Set of node keys, edges, exitNodes, exitOk, trapped: [keys], missing: [{ what, x, y }] }.
 * targets: { exit: { x, y } (tile centre), sconces: [{ x, y }], caches: [{ x, y }] }.
 */
export function solve(room, T, start, targets) {
  const key = (c, r) => r * room.cols + c, cr = (k) => [k % room.cols, Math.floor(k / room.cols)];
  const startC = Math.floor(start.x / TS), startR = Math.floor(start.y / TS);
  const first = standable(room, startC, startR) ? key(startC, startR) : null;
  const reach = new Set(), edges = new Map(), queue = [];
  if (first !== null) { reach.add(first); queue.push(first); }
  const link = (a, b) => { if (!edges.has(a)) edges.set(a, new Set()); edges.get(a).add(b); if (!reach.has(b)) { reach.add(b); queue.push(b); } };
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi], [c, r] = cr(k);
    for (const d of [-1, 1]) if (standable(room, c + d, r)) link(k, key(c + d, r));
    for (const { body, prog } of programs(room, T, c, r)) {
      const b = flight(room, T, body, prog);
      if (!b) continue;
      const lc = Math.floor((b.x + W / 2) / TS), lr = Math.floor((b.y + H) / TS) - 1;
      if (standable(room, lc, lr) && key(lc, lr) !== k) link(k, key(lc, lr));
    }
  }
  const box = (k) => { const [c, r] = cr(k); return { x: c * TS + 3, y: (r + 1) * TS - H, cx: c * TS + 12, cy: (r + 1) * TS - 20 }; };
  const exitNodes = [...reach].filter((k) => {
    const b = box(k), e = targets.exit;
    return e && b.x < e.x + TS / 2 && b.x + W > e.x - TS / 2 && b.y < e.y + TS / 2 && b.y + H > e.y - TS / 2;
  });
  // who can get to the stairs: walk the edges backwards from them
  const back = new Map();
  for (const [a, bs] of edges) for (const b of bs) { if (!back.has(b)) back.set(b, []); back.get(b).push(a); }
  const home = new Set(exitNodes), q2 = [...exitNodes];
  for (let qi = 0; qi < q2.length; qi++) for (const a of back.get(q2[qi]) ?? []) if (!home.has(a)) { home.add(a); q2.push(a); }
  const trapped = [...reach].filter((k) => !home.has(k));
  const centres = [...reach].map(box);
  const near = (p, dist) => centres.some((b) => Math.hypot(b.cx - p.x, b.cy - p.y) < dist);
  const missing = [
    ...(targets.sconces ?? []).filter((s) => !near(s, 48)).map((s) => ({ what: 'sconce', ...s })),
    ...(targets.caches ?? []).filter((o) => !near(o, 34)).map((o) => ({ what: 'oil cache', ...o })),
  ];
  return { reach, edges, exitNodes, exitOk: exitNodes.length > 0, trapped, missing, key, cr };
}
