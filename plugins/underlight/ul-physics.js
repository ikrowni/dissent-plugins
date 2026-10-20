// ul-physics.js — boxes against tiles. A body is { x, y, w, h, vx, vy } with x, y its top-left corner.
// moveX/moveY set flags the callers read: hitWall (-1, 0, 1), onGround, spiked.
import { TS } from './ul-const.js';
import { tileAt, solid, solidPt, isSolidTile } from './ul-room.js';

export function moveX(room, e, dx) {
  e.x += dx; e.hitWall = 0;
  const r0 = Math.floor(e.y / TS), r1 = Math.floor((e.y + e.h - 0.01) / TS);
  if (dx > 0) {
    const c = Math.floor((e.x + e.w) / TS);
    for (let r = r0; r <= r1; r++) if (solid(room, c, r)) { e.x = c * TS - e.w; e.vx = 0; e.hitWall = 1; return; }
  } else if (dx < 0) {
    const c = Math.floor(e.x / TS);
    for (let r = r0; r <= r1; r++) if (solid(room, c, r)) { e.x = (c + 1) * TS; e.vx = 0; e.hitWall = -1; return; }
  }
}

/** oneWays: whether thin ledges hold this body (false while dropping through). A ledge only holds a body that was
 *  above it before the move, so you jump up through it and land on it coming down. */
export function moveY(room, e, dy, oneWays) {
  const prevBottom = e.y + e.h;
  e.y += dy; e.onGround = false; e.spiked = false;
  const c0 = Math.floor(e.x / TS), c1 = Math.floor((e.x + e.w - 0.01) / TS);
  if (dy > 0) {
    const r = Math.floor((e.y + e.h) / TS);
    for (let c = c0; c <= c1; c++) {
      const t = tileAt(room, c, r);
      if (isSolidTile(t) || (oneWays && t === '-' && prevBottom <= r * TS + 0.5)) {
        e.y = r * TS - e.h; e.vy = 0; e.onGround = true; e.spiked = t === '^'; return;
      }
    }
  } else if (dy < 0) {
    const r = Math.floor(e.y / TS);
    for (let c = c0; c <= c1; c++) if (solid(room, c, r)) { e.y = (r + 1) * TS; e.vy = 0; return; }
  }
}

/** Is there something to stand on just past this body's front foot? Walkers turn back rather than fall. */
export function groundAhead(room, e, dir) {
  const fx = dir > 0 ? e.x + e.w + 2 : e.x - 2;
  const t = tileAt(room, Math.floor(fx / TS), Math.floor((e.y + e.h + 4) / TS));
  return isSolidTile(t) || t === '-';
}
export const wallAhead = (room, e, dir) => solidPt(room, dir > 0 ? e.x + e.w + 2 : e.x - 2, e.y + e.h / 2);

/** Standing only on thin ledges (nothing solid under any part of the feet): S + jump drops through. */
export function standingOnOneWay(room, e) {
  const r = Math.floor((e.y + e.h + 1) / TS), c0 = Math.floor(e.x / TS), c1 = Math.floor((e.x + e.w - 0.01) / TS);
  let any = false;
  for (let c = c0; c <= c1; c++) {
    const t = tileAt(room, c, r);
    if (isSolidTile(t)) return false;
    if (t === '-') any = true;
  }
  return any;
}

/**
 * Falling against a wall whose top is near your hands, with room above it: grab the edge.
 * Returns { side, tx, ty } (the wall tile's x and top) or null. Moves the body to hang there.
 */
export function tryHang(room, e, side) {
  const wc = side > 0 ? Math.floor((e.x + e.w + 1) / TS) : Math.floor((e.x - 1) / TS);
  const tr = Math.floor((e.y + 6) / TS), mid = Math.floor((e.x + e.w / 2) / TS);
  for (const r of [tr, tr + 1]) {
    if (!solid(room, wc, r) || solid(room, wc, r - 1) || solid(room, wc, r - 2) || solid(room, mid, r - 1)) continue;
    const ty = r * TS;
    if (Math.abs(e.y - (ty - 4)) > 22) continue;
    e.y = ty - 4; e.vx = 0; e.vy = 0;
    return { side, tx: wc * TS, ty };
  }
  return null;
}
