// ul-shade.js — the Shade (spec §4.3): flees real light and burns in it, so it comes when your light fails (low
// oil, snuffed, or the lantern thrown). Its attack is a lunge with a WHITE tell: block it or parry it.
import { baseEnemy, walk, canAttack } from './ul-enemy.js';
import { moveX, moveY } from './ul-physics.js';
import { lightLevel } from './ul-light.js';
import { hurtPlayer, killEnemy } from './ul-combat.js';
import { sfx, burst } from './ul-fx.js';

export const SHADE_FEAR = 0.5;      // light above this sends it running (at full oil: within ~150 units of you)
export const SHADE_BURN = 0.6;      // light above this burns it, after 0.9 s in it
export const SHADE_DMG = 20;

export function makeShade(S, x, y) { return baseEnemy(S, 'shade', x - 8, y + 12 - 46, 16, 46, 40, 20); }

export function stepShade(S, e, dt, L, pc) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2, lit = lightLevel(S.room, L, cx, cy);
  e.lit = lit.v;
  const dx = pc.x - cx, dy = pc.y - cy;
  if (e.state === 'windup' || e.state === 'attack' || e.state === 'recover' || e.state === 'stagger') { committed(S, e, dt, dx, cx); return; }
  if (lit.v > SHADE_FEAR) {
    e.litT += dt; e.state = 'flee';
    if (e.litT > 0.9 && lit.v > SHADE_BURN) {
      e.hp -= 12 * dt;
      if (S.rng() < 0.3) burst(S, cx, cy, 1, '30,30,40', { spread: 20 });
      if (e.hp <= 0) { killEnemy(S, e); return; }
    }
    const away = Math.sign(cx - lit.src.x) || 1;
    e.face = away; walk(S, e, dt, 150, away);
    return;
  }
  e.litT = Math.max(0, e.litT - dt);
  if (Math.hypot(dx, dy) < 320 && Math.abs(dy) < 80) {
    e.state = 'stalk'; e.face = Math.sign(dx) || e.face;
    if (Math.abs(dx) < 50 && Math.abs(dy) < 40 && e.cd <= 0 && canAttack(S)) { e.state = 'windup'; e.t = S.T.tell; e.vx = 0; sfx(S, 'shadeTell'); return; }
    walk(S, e, dt, Math.abs(dx) < 46 ? 0 : 120, Math.sign(dx));
    return;
  }
  e.state = 'idle'; walk(S, e, dt, 30, Math.sin(e.anim * 0.7) > 0 ? 1 : -1);
}

function committed(S, e, dt, dx, cx) {
  e.t -= dt;
  if (e.state === 'windup') {
    walk(S, e, dt, 0, 0); e.face = Math.sign(dx) || e.face;
    if (e.t <= 0) { e.state = 'attack'; e.t = 0.2; e.vx = e.face * 430; e.hitDone = false; }
  } else if (e.state === 'attack') {
    e.vy = Math.min(e.vy + S.T.gravity * dt, 900);
    moveX(S.room, e, e.vx * dt); moveY(S.room, e, e.vy * dt, true); // a lunge stops at stone
    const p = S.player;
    if (!e.hitDone && e.x - 6 < p.x + p.w && e.x + e.w + 6 > p.x && e.y < p.y + p.h && e.y + e.h > p.y) { e.hitDone = true; hurtPlayer(S, e, SHADE_DMG, 'white', cx); }
    if (e.t <= 0) { e.state = 'recover'; e.t = 0.55; e.cd = 0.9; }
  } else {
    e.vx *= Math.pow(0.02, dt); walk(S, e, dt, 0, 0);
    if (e.t <= 0) e.state = 'stalk';
  }
}
