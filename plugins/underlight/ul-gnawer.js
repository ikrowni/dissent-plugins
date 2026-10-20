// ul-gnawer.js — Gnawers (spec §7.1's swarm): the Rat King's children, in packs of 3–5. Weak alone; small WHITE bites
// that add up. They run on their own limit (two biting at once), not the attack tokens, so a pack never stops a
// Shade or a Bottler from taking its turn. A thrown lantern or a lit sconce nearby scatters them for a moment.
import { baseEnemy, walk } from './ul-enemy.js';
import { hurtPlayer } from './ul-combat.js';
import { wallAhead } from './ul-physics.js';
import { sfx } from './ul-fx.js';

export const GNAW_DMG = 6, GNAW_BITERS = 2, SCARE_REACH = 110;

/** A pack: three to five Gnawers around the spawn. */
export function makeGnawers(S, x, y) {
  const n = 3 + Math.floor(S.rng() * 3), pack = [];
  for (let i = 0; i < n; i++) {
    const e = baseEnemy(S, 'gnawer', x - 7 + (i - (n - 1) / 2) * 10, y + 12 - 10, 14, 10, 8, 1);
    e.speed = 175 + S.rng() * 40;
    pack.push(e);
  }
  return pack;
}

/** The lights that scare them: your thrown lantern, and lit sconces. Not the lantern in your hand. */
function scaredOf(S, e, L) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  return L.find((l) => (l.kind === 'lantern' || l.kind === 'sconce') && Math.hypot(l.x - cx, l.y - cy) < SCARE_REACH) ?? null;
}

export function stepGnawer(S, e, dt, L, pc) {
  const cx = e.x + e.w / 2, dx = pc.x - cx, dy = pc.y - (e.y + e.h / 2), p = S.player;
  e.t -= dt;
  if (e.state === 'bite') {
    walk(S, e, dt, 0, 0); e.face = Math.sign(dx) || e.face;
    if (e.t <= 0) { e.state = 'attack-g'; e.t = 0.14; e.vx = e.face * 260; e.vy = -180; e.hitDone = false; }
    return;
  }
  if (e.state === 'attack-g') {
    walk(S, e, dt, 260, e.face);
    if (!e.hitDone && e.x < p.x + p.w && e.x + e.w > p.x && e.y < p.y + p.h && e.y + e.h > p.y) { e.hitDone = true; hurtPlayer(S, e, GNAW_DMG, 'white', cx, 'Gnawers'); }
    if (e.t <= 0) { e.state = 'recover'; e.t = 0.4; e.cd = 0.6 + S.rng() * 0.5; }
    return;
  }
  if (e.state === 'recover' || e.state === 'stagger') { e.vx *= Math.pow(0.05, dt); walk(S, e, dt, 0, 0); if (e.t <= 0) e.state = 'chase'; return; }
  const fear = scaredOf(S, e, L);
  if (fear) { e.state = 'flee'; e.face = Math.sign(cx - fear.x) || 1; walk(S, e, dt, e.speed, e.face); return; }
  if (Math.abs(dx) < 380 && Math.abs(dy) < 100) {
    e.state = 'chase'; e.face = Math.sign(dx) || e.face;
    if (e.onGround && wallAhead(S.room, e, e.face)) e.vy = -560; // they hop up ledges
    const biting = S.enemies.filter((o) => !o.dead && o.kind === 'gnawer' && (o.state === 'bite' || o.state === 'attack-g')).length;
    if (Math.abs(dx) < 34 && Math.abs(dy) < 30 && e.cd <= 0 && biting < GNAW_BITERS && !p.dead) {
      e.state = 'bite'; e.t = Math.max(0.3, S.T.tell * 0.6); sfx(S, 'squeak'); return;
    }
    walk(S, e, dt, Math.abs(dx) < 20 ? 0 : e.speed, Math.sign(dx));
    return;
  }
  e.state = 'idle'; walk(S, e, dt, 40, Math.sin(e.anim * 1.3 + e.id) > 0 ? 1 : -1);
}
