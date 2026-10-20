// ul-bottler.js — the Bottler (spec §7.1's ranged role): a drunk cellarman who keeps his distance and lobs bottles in
// an arc with a RED tell (dodge, don't block). Where a bottle breaks it leaves glass for a few seconds. Get close and
// he backs off, or shoves you (WHITE) if you're right on him.
import { baseEnemy, walk, canAttack } from './ul-enemy.js';
import { hurtPlayer } from './ul-combat.js';
import { los } from './ul-light.js';
import { throwBottle } from './ul-hazards.js';
import { sfx } from './ul-fx.js';

export const SHOVE_DMG = 8;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function makeBottler(S, x, y) { const e = baseEnemy(S, 'bottler', x - 10, y + 12 - 44, 20, 44, 45, 25); e.aim = null; return e; }

export function stepBottler(S, e, dt, L, pc) {
  const cx = e.x + e.w / 2, cy = e.y + 14, dx = pc.x - cx, dy = pc.y - cy, dist = Math.abs(dx), p = S.player;
  e.t -= dt;
  if (e.state === 'windup') {
    walk(S, e, dt, 0, 0); e.face = Math.sign(dx) || e.face;
    if (e.t <= 0) {
      if (e.mode === 'throw') {
        const flight = clamp(dist / 350, 0.5, 1.0);
        throwBottle(S, e, cx + e.face * 8, e.y + 8, pc.x, p.y + p.h - 4, flight); sfx(S, 'toss');
        e.state = 'recover'; e.t = 0.8; e.cd = 2.2;
      } else { e.state = 'attack'; e.t = 0.16; e.hitDone = false; }
    }
    return;
  }
  if (e.state === 'attack') { // the shove
    walk(S, e, dt, 0, 0);
    const box = { x: e.face > 0 ? e.x + e.w : e.x - 30, y: e.y + 6, w: 30, h: 30 };
    if (!e.hitDone && box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) { e.hitDone = true; hurtPlayer(S, e, SHOVE_DMG, 'white', cx); }
    if (e.t <= 0) { e.state = 'recover'; e.t = 0.5; e.cd = 1.2; }
    return;
  }
  if (e.state === 'recover' || e.state === 'stagger') { e.vx *= Math.pow(0.05, dt); walk(S, e, dt, 0, 0); if (e.t <= 0) e.state = 'idle'; return; }
  if (dist < 460 && Math.abs(dy) < 220) {
    e.face = Math.sign(dx) || e.face;
    if (dist < 56 && Math.abs(dy) < 40 && e.cd <= 0 && canAttack(S)) { e.state = 'windup'; e.mode = 'shove'; e.t = S.T.tell; return; }
    if (dist >= 120 && e.cd <= 0 && canAttack(S) && los(S.room, cx, e.y + 8, pc.x, pc.y)) { e.state = 'windup'; e.mode = 'throw'; e.t = S.T.tell; sfx(S, 'bottleTell'); return; }
    e.state = 'keep';
    walk(S, e, dt, 70, dist < 150 ? -Math.sign(dx) : dist > 300 ? Math.sign(dx) : 0); // keep his distance
    return;
  }
  e.state = 'idle'; walk(S, e, dt, 0, 0);
}
