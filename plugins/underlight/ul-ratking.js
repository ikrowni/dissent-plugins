// ul-ratking.js — the Rat King, act 1's boss (spec §7.6; owner approved 2026-10-20). One health pool, three phases:
//   1. the Crown: a knot of rats with a crown. Charges (WHITE), leaps and slams a shockwave along the floor (RED: jump
//      it or roll), coughs out Gnawers.
//   2. at two thirds: it tears into two halves that fight together (charges and Gnawers; only one winds up at a time).
//   3. at one third: it knots back together and EATS THE LIGHT, snuffing the arena's sconces one by one and hunting you
//      in the dark. Light a sconce near it (touch it, or land the thrown lantern beside it) and it staggers, exposed.
// Its parts are enemies of kind 'king' sharing S.boss.hp (ul-combat.js routes their damage to the pool).
import { baseEnemy, walk, canAttack } from './ul-enemy.js';
import { moveX, moveY } from './ul-physics.js';
import { hurtPlayer, ATTACK_STATES } from './ul-combat.js';
import { makeGnawers } from './ul-gnawer.js';
import { sfx, text, burst, shake } from './ul-fx.js';

export const KING_HP = 600, SPLIT_AT = 2 / 3, MERGE_AT = 1 / 3, GNAWER_CAP = 6, EAT_EVERY = 5, RELIGHT_REACH = 160;
export const CHARGE_DMG = { crown: 18, half: 12 }, WAVE_DMG = 20, WAVE_SPEED = 360;
const SIZE = { crown: [64, 48], half: [44, 34] };

function part(S, form, x, floorY) {
  const [w, h] = SIZE[form], e = baseEnemy(S, 'king', x - w / 2, floorY - h, w, h, KING_HP, form === 'crown' ? 80 : 50);
  e.form = form; e.boss = S.boss; e.neverSleeps = true; e.cd = 1.2;
  return e;
}

/** x, y: the spawn tile's centre (on the arena floor). */
export function makeRatKing(S, x, y) {
  S.boss = { name: 'The Rat King', hp: KING_HP, maxHp: KING_HP, phase: 1, dead: false, eatT: EAT_EVERY, floorY: y + 12 };
  return [part(S, 'crown', x, y + 12)];
}

const alive = (S) => S.enemies.filter((e) => !e.dead && e.kind === 'king');

/** Phase changes, the dark hunger, and death. Called once a step before the parts move. */
export function stepBoss(S, dt) {
  const B = S.boss;
  if (!B || B.dead) return;
  if (B.hp <= 0) { kill(S); return; }
  if (B.phase === 3) B.eatT -= dt; // the hunger always grows, whatever it is doing
  const parts = alive(S), frac = B.hp / B.maxHp;
  if (B.phase === 1 && frac <= SPLIT_AT && parts[0]) {
    const c = parts[0], cx = c.x + c.w / 2;
    c.dead = true; B.phase = 2; roar(S, cx, c.y);
    for (const d of [-1, 1]) { const h = part(S, 'half', cx + d * 40, B.floorY); h.state = 'roar'; h.t = 1.2; h.face = d; S.enemies.push(h); }
  } else if (B.phase === 2 && frac <= MERGE_AT) {
    const cx = parts.reduce((a, p) => a + p.x + p.w / 2, 0) / Math.max(1, parts.length);
    for (const p of parts) p.dead = true;
    B.phase = 3; roar(S, cx, B.floorY - 48);
    const c = part(S, 'crown', cx, B.floorY); c.state = 'roar'; c.t = 1.2; S.enemies.push(c);
  }
}

function roar(S, x, y) { sfx(S, 'roar'); shake(S, 6); text(S, x, y - 10, 'the Rat King roars', '#ffcf9a'); burst(S, x, y, 24, '30,26,24', { grav: true, spread: 200 }); }

function kill(S) {
  const B = S.boss;
  B.dead = true; sfx(S, 'kingDie'); shake(S, 8);
  for (const p of alive(S)) {
    p.dead = true; p.state = 'dead';
    burst(S, p.x + p.w / 2, p.y + p.h / 2, 40, '24,20,18', { grav: true, spread: 260 });
    S.drops.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, vx: 0, vy: -260, amt: 30, t: 0 });
  }
  text(S, S.player.x + 9, S.player.y - 20, 'the stairs are open', '#ffcf86');
}

/** A sconce was just lit. In phase 3, the King staggers if it is close: light hurts it. */
export function onSconceLit(S, s) {
  const B = S.boss;
  if (!B || B.dead || B.phase !== 3) return;
  for (const p of alive(S)) if (Math.abs(p.x + p.w / 2 - s.x) < RELIGHT_REACH && Math.abs(p.y + p.h / 2 - s.y) < RELIGHT_REACH) {
    p.state = 'stagger'; p.t = 2; p.exposedT = 2; sfx(S, 'kingHurt'); text(S, p.x + p.w / 2, p.y - 8, 'the light burns it', '#fff1d0');
  }
}

/** The shockwave of a slam: two waves along the floor from where it landed. */
function slamWaves(S, x, floorY) {
  sfx(S, 'shockwave'); shake(S, 7); burst(S, x, floorY - 4, 20, '60,50,40', { grav: true, spread: 220 });
  for (const d of [-1, 1]) S.hazards.push({ kind: 'wave', x: x - 10 + d * 20, y: floorY - 22, w: 20, h: 22, vx: d * WAVE_SPEED, t: 1.6, dmg: WAVE_DMG });
}

export function stepKing(S, e, dt, L, pc) {
  const B = S.boss, p = S.player, cx = e.x + e.w / 2, dx = pc.x - cx;
  e.t -= dt;
  if (e.state === 'roar') { walk(S, e, dt, 0, 0); if (e.t <= 0) { e.state = 'idle'; e.cd = 0.6; } return; }
  if (e.state === 'stagger' || e.state === 'recover') { e.vx *= Math.pow(0.05, dt); walk(S, e, dt, 0, 0); if (e.t <= 0) { e.state = 'idle'; } return; }
  if (e.state === 'windup') {
    walk(S, e, dt, 0, 0);
    if (e.t > 0) return;
    if (e.move === 'charge') { e.state = 'attack'; e.t = 1.1; e.hitDone = false; e.vx = e.face * 520; }
    else { // slam: leap at where you are now
      e.state = 'attack'; e.t = 0.7; e.leap = true; e.hitDone = true; e.vy = -620; e.vx = (pc.x - cx) / 0.7;
    }
    return;
  }
  if (e.state === 'attack') {
    if (e.leap) {
      e.vy = Math.min(e.vy + S.T.gravity * dt, 900);
      moveX(S.room, e, e.vx * dt); moveY(S.room, e, e.vy * dt, true); // the leap keeps its speed in the air
      if ((e.onGround && e.t < 0.6) || e.t <= 0) { e.leap = false; slamWaves(S, e.x + e.w / 2, e.y + e.h); e.state = 'recover'; e.t = 0.9; e.cd = 1.6; e.vx = 0; }
      return;
    }
    const before = e.x;
    walk(S, e, dt, 520, e.face);
    if (!e.hitDone && e.x < p.x + p.w && e.x + e.w > p.x && e.y < p.y + p.h && e.y + e.h > p.y) {
      e.hitDone = true;
      if (hurtPlayer(S, e, CHARGE_DMG[e.form], 'white', cx, B.name) === 'hit') p.vx = e.face * 380;
    }
    if (e.t <= 0 || (Math.abs(e.x - before) < 0.5 && e.t < 1.0)) { e.state = 'recover'; e.t = 0.7; e.cd = B.phase === 3 ? 1.0 : 1.5; if (e.x === before) shake(S, 4); }
    return;
  }
  if (e.state === 'spit') {
    walk(S, e, dt, 0, 0);
    if (e.t <= 0) {
      const n = S.enemies.filter((o) => !o.dead && o.kind === 'gnawer').length;
      if (n < GNAWER_CAP) for (const g of makeGnawers(S, cx + e.face * (e.w / 2 + 10), B.floorY - 12).slice(0, GNAWER_CAP - n)) S.enemies.push(g);
      sfx(S, 'squeak'); e.state = 'recover'; e.t = 0.5; e.cd = 1.2;
    }
    return;
  }
  // phase 3: go and eat the nearest lit sconce, every few seconds
  if (B.phase === 3) {
    const lit = S.sconces.filter((s) => s.lit);
    if (e.state === 'eat') { walk(S, e, dt, 0, 0); if (e.t <= 0) { e.target.lit = false; sfx(S, 'chew'); text(S, e.target.x, e.target.y - 14, 'a light goes out', '#c4a6ff'); e.state = 'idle'; e.cd = 0.8; } return; }
    if (B.eatT <= 0 && lit.length) {
      const s = lit.reduce((a, b) => (Math.abs(b.x - cx) < Math.abs(a.x - cx) ? b : a));
      if (Math.abs(s.x - cx) < 40) { B.eatT = EAT_EVERY; e.state = 'eat'; e.t = 0.8; e.target = s; return; }
      e.face = Math.sign(s.x - cx) || e.face; walk(S, e, dt, 180, e.face); e.state = 'feed'; return;
    }
  }
  e.face = Math.sign(dx) || e.face;
  if (e.cd <= 0 && !p.dead) {
    const other = alive(S).find((o) => o !== e && ATTACK_STATES.includes(o.state)); // halves take turns
    const gnawers = S.enemies.filter((o) => !o.dead && o.kind === 'gnawer').length;
    if (!other && canAttack(S)) {
      if (gnawers < 3 && S.rng() < 0.3) { e.state = 'spit'; e.t = 0.5; return; }
      if (e.form === 'crown' && Math.abs(dx) > 120 && S.rng() < 0.45) { e.state = 'windup'; e.move = 'slam'; e.t = S.T.tell; sfx(S, 'slamTell'); return; }
      e.state = 'windup'; e.move = 'charge'; e.t = S.T.tell * 1.2; sfx(S, 'kingTell'); return;
    }
  }
  e.state = 'idle'; walk(S, e, dt, Math.abs(dx) > 160 ? 70 : 0, Math.sign(dx));
}
