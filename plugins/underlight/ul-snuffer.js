// ul-snuffer.js — the Snuffer (spec §4.3): slow and heavy. It inhales with a VIOLET tell, then breathes a cone that
// puts your lantern out for 4 s (and lets the Shades in). Dodge it; blocking does not stop it.
import { baseEnemy, walk, canAttack } from './ul-enemy.js';
import { hurtPlayer } from './ul-combat.js';
import { sfx, burst } from './ul-fx.js';

export const SNUFF_DMG = 10, CONE_LEN = 124;

export function makeSnuffer(S, x, y) { return baseEnemy(S, 'snuffer', x - 17, y + 12 - 30, 34, 30, 60, 45); }

export function breathCone(e) { return { x: e.face > 0 ? e.x + e.w : e.x - CONE_LEN, y: e.y - 14, w: CONE_LEN, h: e.h + 14 }; }

export function stepSnuffer(S, e, dt, L, pc) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2, dx = pc.x - cx, dy = pc.y - cy, p = S.player;
  e.t -= dt;
  if (e.state === 'windup') { walk(S, e, dt, 0, 0); if (e.t <= 0) { e.state = 'breath'; e.t = 0.45; e.hitDone = false; } return; }
  if (e.state === 'breath') {
    walk(S, e, dt, 0, 0);
    if (S.rng() < 0.8) burst(S, e.face > 0 ? e.x + e.w : e.x, e.y + 10, 1, '160,110,255', { glow: true, dir: e.face, spread: 40 });
    const c = breathCone(e);
    if (!e.hitDone && c.x < p.x + p.w && c.x + c.w > p.x && c.y < p.y + p.h && c.y + c.h > p.y) { e.hitDone = true; hurtPlayer(S, e, SNUFF_DMG, 'violet', cx); }
    if (e.t <= 0) { e.state = 'recover'; e.t = 1.0; e.cd = 1.2; }
    return;
  }
  if (e.state === 'recover' || e.state === 'stagger') { e.vx *= Math.pow(0.02, dt); walk(S, e, dt, 0, 0); if (e.t <= 0) e.state = 'idle'; return; }
  if (Math.abs(dx) < 420 && Math.abs(dy) < 90) {
    e.face = Math.sign(dx) || e.face;
    if (Math.abs(dx) < 120 && Math.abs(dy) < 50 && e.cd <= 0 && canAttack(S)) { e.state = 'windup'; e.t = S.T.tell * 1.35; sfx(S, 'snuffTell'); return; }
    walk(S, e, dt, Math.abs(dx) < 70 ? 0 : 55, Math.sign(dx));
  } else walk(S, e, dt, 0, 0);
}
