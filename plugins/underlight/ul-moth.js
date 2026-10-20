// ul-moth.js — the Moth (spec §4.3): circles the brightest light in reach. If that is you, it dives with a RED
// tell (dodge it; it can't be parried). A thrown lantern or a lit sconce is a decoy it circles and never attacks.
import { baseEnemy, moveFly, canAttack } from './ul-enemy.js';
import { los } from './ul-light.js';
import { hurtPlayer } from './ul-combat.js';
import { sfx } from './ul-fx.js';

export const MOTH_SIGHT = 440, MOTH_DMG = 18, DIVE_SPEED = 540;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function makeMoth(S, x, y) { const e = baseEnemy(S, 'moth', x - 11, y - 9, 22, 18, 25, 1); e.flies = true; e.ang = S.rng() * 6; return e; }

/** The light it wants: biggest reach, nearer is better. Embers and your faint hand-glow don't draw it. */
export function mothTarget(S, e, L) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  let tgt = null, best = -Infinity;
  for (const l of L) {
    if (l.kind === 'ember' || l.kind === 'hand') continue;
    const d = Math.hypot(l.x - cx, l.y - cy);
    if (d > MOTH_SIGHT) continue;
    const score = l.r - d * 0.3;
    if (score > best && los(S.room, cx, cy, l.x, l.y)) { best = score; tgt = l; }
  }
  return tgt;
}

export function stepMoth(S, e, dt, L, pc) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2, p = S.player;
  e.tgt = mothTarget(S, e, L);
  e.t -= dt;
  if (e.state === 'dive') {
    moveFly(S, e, dt);
    if (!e.hitDone && e.x < p.x + p.w && e.x + e.w > p.x && e.y < p.y + p.h && e.y + e.h > p.y) { e.hitDone = true; hurtPlayer(S, e, MOTH_DMG, 'red', cx); }
    if (e.t <= 0 || e.bonk) { e.state = 'recover'; e.t = 0.7; e.cd = 1.4; e.vy = -120; e.bonk = false; }
    return;
  }
  if (e.state === 'windup') {
    e.vx *= 0.9; e.vy *= 0.9; moveFly(S, e, dt);
    if (e.t <= 0) { // it aims where you are when it goes, so moving during the tell is how you dodge
      const a = Math.atan2(pc.y - cy, pc.x - cx);
      e.vx = Math.cos(a) * DIVE_SPEED; e.vy = Math.sin(a) * DIVE_SPEED; e.state = 'dive'; e.t = 0.42; e.hitDone = false;
    }
    return;
  }
  if (e.state === 'stagger' || e.state === 'recover') {
    e.vx *= Math.pow(0.1, dt); e.vy = e.vy * Math.pow(0.1, dt) - 40 * dt; moveFly(S, e, dt);
    if (e.t <= 0) e.state = 'circle';
    return;
  }
  e.state = 'circle';
  let gx, gy;
  if (e.tgt) { e.ang += dt * 1.9; gx = e.tgt.x + Math.cos(e.ang) * 72; gy = e.tgt.y - 26 + Math.sin(e.ang * 1.3) * 36; }
  else { e.ang += dt; gx = e.homeX + Math.cos(e.ang) * 60; gy = e.homeY + Math.sin(e.ang * 1.7) * 20; }
  e.vx += clamp((gx - cx) * 6 - e.vx * 2.2, -900, 900) * dt;
  e.vy += clamp((gy - cy) * 6 - e.vy * 2.2, -900, 900) * dt + Math.sin(e.anim * 11) * 30 * dt;
  e.face = e.vx >= 0 ? 1 : -1;
  moveFly(S, e, dt);
  if (e.tgt && e.tgt.kind === 'player' && Math.hypot(pc.x - cx, pc.y - cy) < 190 && e.cd <= 0 && canAttack(S)) {
    e.state = 'windup'; e.t = S.T.tell; sfx(S, 'mothTell');
  }
}
