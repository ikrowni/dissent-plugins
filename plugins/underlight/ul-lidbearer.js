// ul-lidbearer.js — the Lid-bearer (spec §7.1's shield): a barrel lid stops anything from the front (ul-combat.js).
// Ways in: roll through him and hit his back while he turns (slowly); parry his WHITE shove, which knocks the lid
// aside for 2.5 s; or throw your lantern past him: he turns his lid toward the light.
import { baseEnemy, walk, canAttack } from './ul-enemy.js';
import { hurtPlayer } from './ul-combat.js';
import { sfx } from './ul-fx.js';

export const LID_SHOVE_DMG = 14, TURN_TIME = 0.6;

export function makeLidbearer(S, x, y) {
  const e = baseEnemy(S, 'lidbearer', x - 12, y + 12 - 44, 24, 44, 70, 60);
  e.shield = true; e.lidDownT = 0; e.turnT = 0;
  return e;
}

/** What he wants his lid toward: a thrown lantern near him beats you. */
function lookAt(S, e, pc) {
  const l = S.lantern;
  if ((l.state === 'rest' || l.state === 'fly') && Math.hypot(l.x - (e.x + e.w / 2), l.y - (e.y + e.h / 2)) < 220) return l.x;
  return pc.x;
}

export function stepLidbearer(S, e, dt, L, pc) {
  const cx = e.x + e.w / 2, dx = pc.x - cx, dy = pc.y - (e.y + e.h / 2), p = S.player;
  e.t -= dt; e.lidDownT = Math.max(0, e.lidDownT - dt);
  // he turns slowly: what he wants to face must stay behind him for TURN_TIME first
  const want = Math.sign(lookAt(S, e, pc) - cx) || e.face;
  if (want !== e.face && e.state !== 'windup' && e.state !== 'attack') { e.turnT += dt; if (e.turnT >= TURN_TIME) { e.face = want; e.turnT = 0; } }
  else e.turnT = 0;
  if (e.state === 'windup') { walk(S, e, dt, 0, 0); if (e.t <= 0) { e.state = 'attack'; e.t = 0.18; e.hitDone = false; e.vx = e.face * 160; } return; }
  if (e.state === 'attack') {
    walk(S, e, dt, 160, e.face);
    const box = { x: e.face > 0 ? e.x + e.w : e.x - 40, y: e.y + 4, w: 40, h: 36 };
    if (!e.hitDone && box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) {
      e.hitDone = true;
      if (hurtPlayer(S, e, LID_SHOVE_DMG, 'white', cx) === 'hit') p.vx = e.face * 420; // the shove throws you
    }
    if (e.t <= 0) { e.state = 'recover'; e.t = 0.6; e.cd = 1.4; }
    return;
  }
  if (e.state === 'recover' || e.state === 'stagger') { e.vx *= Math.pow(0.05, dt); walk(S, e, dt, 0, 0); if (e.t <= 0) e.state = 'idle'; return; }
  if (Math.abs(dx) < 420 && Math.abs(dy) < 90) {
    e.state = 'advance';
    if (Math.abs(dx) < 62 && Math.sign(dx) === e.face && Math.abs(dy) < 40 && e.cd <= 0 && canAttack(S)) { e.state = 'windup'; e.t = S.T.tell; sfx(S, 'lidTell'); return; }
    walk(S, e, dt, Math.abs(dx) < 40 ? 0 : 65, Math.sign(dx) === e.face ? e.face : 0);
    return;
  }
  e.state = 'idle'; walk(S, e, dt, 0, 0);
}
