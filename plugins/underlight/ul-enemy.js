// ul-enemy.js — what every enemy shares: walking with gravity (turning back at edges and walls), flying with
// bounces, and attack tokens (spec §7.2): only so many may attack you at once; the rest wait their turn.
import { moveX, moveY, groundAhead, wallAhead } from './ul-physics.js';
import { solidPt } from './ul-room.js';
import { TS } from './ul-const.js';
import { ATTACK_STATES } from './ul-combat.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function attackersNow(S) { return S.enemies.filter((e) => !e.dead && ATTACK_STATES.includes(e.state)).length; }
export const canAttack = (S) => !S.player.dead && attackersNow(S) < S.T.tokens;

/** The fields every enemy has. */
export function baseEnemy(S, kind, x, y, w, h, hp, poise) {
  return { id: S.nextId++ & 255, kind, x, y, w, h, vx: 0, vy: 0, face: -1, state: 'idle', t: 0, cd: 0.3 + S.rng() * 0.9,
    flash: 0, exposedT: 0, litT: 0, lit: 0, anim: S.rng() * 6, hitDone: false, dead: false, homeX: x, homeY: y,
    hp, maxHp: hp, poise, maxPoise: poise, flies: false };
}

/** Walk toward dir (-1, 0, 1) at speed, never off a ledge or into a wall. */
export function walk(S, e, dt, speed, dir) {
  if (dir && (!groundAhead(S.room, e, dir) || wallAhead(S.room, e, dir))) dir = 0;
  e.vx += clamp(dir * speed - e.vx, -1400 * dt, 1400 * dt);
  e.vy = Math.min(e.vy + S.T.gravity * dt, 900);
  moveX(S.room, e, e.vx * dt); moveY(S.room, e, e.vy * dt, true);
}

/** Fly; bounce off stone. A dive that hits stone sets e.bonk. Stays inside the room. */
export function moveFly(S, e, dt) {
  const room = S.room, ox = e.x, oy = e.y;
  e.x += e.vx * dt;
  if (solidPt(room, e.x, e.y + e.h / 2) || solidPt(room, e.x + e.w, e.y + e.h / 2)) { e.x = ox; e.vx *= -0.5; if (e.state === 'dive') e.bonk = true; }
  e.y += e.vy * dt;
  if (solidPt(room, e.x + e.w / 2, e.y) || solidPt(room, e.x + e.w / 2, e.y + e.h)) { e.y = oy; e.vy *= -0.5; if (e.state === 'dive') e.bonk = true; }
  e.x = clamp(e.x, TS, room.w - TS - e.w); e.y = clamp(e.y, TS, room.h - TS * 3);
}

/** Ticks every enemy's timers before its own step. */
export function tickTimers(e, dt) {
  e.flash = Math.max(0, e.flash - dt); e.exposedT = Math.max(0, e.exposedT - dt); e.cd = Math.max(0, e.cd - dt); e.anim += dt;
}
