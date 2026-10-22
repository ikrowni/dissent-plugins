import { BODY_W, MOVE, WL, WR } from "./tuning.js";
import { floorOf } from "./towerGen.js";

/**
 * Moving your own figure (spec §8.3): a capsule against flat one-way ledges — you jump up through a ledge
 * and land on it from above. Every surface in the tower is such a ledge, so this plain check is exact,
 * cheap and the same on every machine. Pure: the caller owns the clock and the input.
 */

export const NO_INTENT = { dir: 0, jumpPressed: false, jumpHeld: false, drop: false };

export function newClimber(x, y) {
  return {
    x, y, vx: 0, vy: 0, onGround: false, ledge: null, facing: 1, coyote: 0, buffer: 0, dropT: 0, dropFrom: null, jumpHeld: false,
    phase: 0, squash: 0, blink: 0, spawning: true, jumpFloor: 0, combo: 0, comboJumps: 0, comboT: 0, best: 0, stun: 0,
  };
}

const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));

/** Knocked by a hit or a blast: thrown, and limp for stunS seconds. */
export function knock(c, vx, vy, stunS) {
  c.vx = vx;
  c.vy = vy;
  c.onGround = false;
  c.ledge = null;
  c.stun = Math.max(c.stun, stunS);
  c.jumpFloor = floorOf(c.y);
  c.jumpHeld = false;
  c.combo = 0;
  c.comboJumps = 0;
  c.comboT = 0;
}

const SLICK_GRIP = 0.12;

/**
 * One fixed step. Returns what happened, for sound and the HUD. `icy(ledge)` says whether a ledge is slick for
 * this climber right now (another player's Slick).
 */
export function stepClimber(c, input, tower, dt, icy) {
  const ev = [];
  const ground = c.onGround;
  const l = c.ledge;
  const stunned = c.stun > 0;
  const i = stunned ? NO_INTENT : input;

  const target = stunned ? c.vx : i.dir * MOVE.run;
  let acc = ground ? (i.dir ? MOVE.accel : MOVE.decel) : MOVE.airAccel;
  if (stunned) acc = ground ? MOVE.decel * 0.5 : 0;
  if (ground && l && icy?.(l)) acc *= SLICK_GRIP;
  c.vx = approach(c.vx, stunned && ground ? 0 : target, acc * dt);
  if (i.dir) c.facing = i.dir;

  if (i.jumpPressed) c.buffer = MOVE.bufferMs / 1000;
  c.buffer -= dt;
  c.coyote = ground ? MOVE.coyoteMs / 1000 : c.coyote - dt;
  if (c.buffer > 0 && c.coyote > 0) {
    const sp = Math.min(1, Math.abs(c.vx) / MOVE.run);
    c.vy = -MOVE.jump * (1 + MOVE.speedJump * sp * sp);
    if (l?.type === "move") c.vx += ((l.dx ?? 0) / dt) * 0.8; // keep the ledge's speed (Celeste)
    c.onGround = false;
    c.coyote = 0;
    c.buffer = 0;
    c.jumpHeld = true;
    c.jumpFloor = l ? l.floor : floorOf(c.y);
    c.squash = -0.6;
    ev.push("jump");
  }
  if (c.jumpHeld && !i.jumpHeld) {
    if (c.vy < 0) c.vy *= 0.5;
    c.jumpHeld = false;
  }
  if (c.vy >= 0) c.jumpHeld = false;

  if (c.onGround && l) {
    if (l.type === "move") c.x += l.dx ?? 0;
    if (i.drop && l.type !== "ground" && l.type !== "landing") {
      c.onGround = false;
      c.dropT = 0.22;
      c.dropFrom = l; // only THIS ledge is ignored (the mock ignored all of them, and fell through the ground)
      c.y += 2;
      c.jumpFloor = l.floor;
    } else if (c.x + BODY_W / 2 < l.x || c.x - BODY_W / 2 > l.x + l.w) {
      c.onGround = false;
      c.jumpFloor = l.floor;
    }
  }
  if (!c.onGround) {
    let g = MOVE.gravity;
    if (c.vy > 0) g *= MOVE.fallMult;
    else if (MOVE.apexHalf && c.jumpHeld && Math.abs(c.vy) < MOVE.apexBand) g *= 0.5;
    c.vy = Math.min(c.vy + g * dt, MOVE.maxFall);
  }

  c.x += c.vx * dt;
  if (c.x < WL + BODY_W / 2) {
    c.x = WL + BODY_W / 2;
    c.vx = c.onGround ? 0 : Math.abs(c.vx) * MOVE.wallKeep;
  }
  if (c.x > WR - BODY_W / 2) {
    c.x = WR - BODY_W / 2;
    c.vx = c.onGround ? 0 : -Math.abs(c.vx) * MOVE.wallKeep;
  }

  if (!c.onGround) {
    const py = c.y;
    c.y += c.vy * dt;
    if (c.vy >= 0) {
      const lo = Math.max(0, floorOf(py) - 1);
      const hi = floorOf(c.y) + 1;
      search: for (let f = hi; f >= lo; f--) {
        for (const q of tower.byFloor[f] ?? []) {
          if (c.spawning && q.floor !== 0) continue;
          if (c.dropT > 0 && q === c.dropFrom) continue;
          if (py <= q.y + 0.5 && c.y >= q.y && c.x + BODY_W / 2 > q.x && c.x - BODY_W / 2 < q.x + q.w) {
            land(c, q, ev);
            break search;
          }
        }
      }
    }
  }
  c.dropT -= dt;
  if (c.onGround && Math.abs(c.vx) > 5) c.phase += (Math.abs(c.vx) * dt) / 38;
  c.squash *= Math.pow(0.0004, dt);
  c.blink = Math.max(0, c.blink - dt);
  c.stun = Math.max(0, c.stun - dt);
  if (c.comboT > 0 && (c.comboT -= dt) <= 0) endCombo(c, ev);
  return ev;
}

function land(c, q, ev) {
  const speed = c.vy;
  c.y = q.y;
  c.onGround = true;
  c.ledge = q;
  c.spawning = false;
  c.squash = Math.min(1, speed / 1300);
  c.vy = 0;
  c.best = Math.max(c.best, q.floor);
  if (q.type === "spring") {
    c.vy = -MOVE.spring;
    c.onGround = false;
    c.jumpFloor = q.floor;
    c.squash = -0.8;
    ev.push("spring");
    return;
  }
  if (speed > 250) ev.push("land");
  const gained = q.floor - c.jumpFloor;
  if (gained >= MOVE.comboFloors) {
    c.comboJumps++;
    c.combo += gained;
    c.comboT = MOVE.comboMs / 1000;
    if (c.comboJumps >= 2) ev.push({ combo: c.combo });
  } else if (c.comboJumps) endCombo(c, ev);
  c.jumpFloor = q.floor;
}

function endCombo(c, ev) {
  if (c.comboJumps >= 2) ev.push({ comboEnded: c.combo });
  c.combo = 0;
  c.comboJumps = 0;
  c.comboT = 0;
}

/** Caught by the mist in a race: back on the first steady ledge a few floors above it, blinking (§3.4). */
export function respawnAbove(c, tower, mistY, floorsAbove, blinkS) {
  for (let f = Math.max(0, floorOf(mistY) + floorsAbove); f <= tower.floors; f++) {
    const spot = (tower.byFloor[f] ?? []).find((q) => q.type !== "move");
    if (!spot) continue;
    Object.assign(c, { x: spot.x + spot.w / 2, y: spot.y, vx: 0, vy: 0, onGround: true, ledge: spot, jumpFloor: spot.floor, blink: blinkS });
    c.combo = 0;
    c.comboJumps = 0;
    c.comboT = 0;
    return true;
  }
  return false;
}

