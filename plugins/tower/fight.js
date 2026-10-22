import { FIGHT, ITEMS, WL, WR } from "./tuning.js";
import { floorOf } from "./towerGen.js";

/**
 * Hitting, landing on heads, and bombs (spec §3.5–3.6, §7.2). Pure rules over positions; the round applies
 * them. 🔴 Who decides: the one who gets HIT, against where their own screen showed the attacker — so a punch
 * is checked on the victim's machine with the attacker's SHOWN position, never the attacker's word.
 */

/** A punch from `a` (facing f) lands on `v`: about one body width ahead, at the same height. */
export function punchLands(a, facing, v) {
  const ahead = (v.x - a.x) * facing;
  return ahead > -4 && ahead < FIGHT.reach && Math.abs(v.y - a.y) < FIGHT.height;
}

/** Falling from prevY to y: did these feet come down onto that head? */
export function landsOnHead(prevY, me, other) {
  const top = other.y - FIGHT.headTop;
  return prevY <= top && me.y >= top && Math.abs(me.x - other.x) < FIGHT.headHalfWidth;
}

const BOMB_G = 2300;

/** A bomb flies one step. Returns true when it goes off: on a ledge (after a moment), or at the end of its fuse. */
export function stepBomb(b, tower, dt) {
  b.t += dt;
  b.vy += BOMB_G * dt;
  const py = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < WL + 6 || b.x > WR - 6) {
    b.vx *= -0.7;
    b.x = Math.max(WL + 6, Math.min(WR - 6, b.x));
  }
  let onLedge = false;
  if (b.vy > 0) for (const l of tower.byFloor[floorOf(b.y)] ?? []) if (py <= l.y && b.y >= l.y && b.x > l.x && b.x < l.x + l.w) onLedge = true;
  return (b.t > 0.12 && onLedge) || b.t * 1000 > ITEMS.bombFuseMs;
}

/** What a blast at (bx, by) does to a figure standing at `v`: a knock, or nothing out of range. */
export function blast(bx, by, v) {
  const d = Math.hypot(v.x - bx, v.y - 22 - by);
  if (d >= ITEMS.bombRadius) return null;
  const dir = Math.sign(v.x - bx) || 1;
  return { vx: dir * ITEMS.bombKnock * (1.2 - d / 160), vy: ITEMS.bombLift, stunS: ITEMS.bombStunMs / 1000 };
}
