// ul-player.js — the Lamplighter: run, held jump, roll, block and parry, a three-hit sword chain, the flask, the
// ledge hang, and the oil that runs out (spec §4.1, §5).
import { TS, SWING } from './ul-const.js';
import { moveX, moveY, standingOnOneWay, tryHang } from './ul-physics.js';
import { hurtPlayer, hurtEnemy, killPlayer } from './ul-combat.js';
import { throwOrRecall } from './ul-lantern.js';
import { sfx, text, burst } from './ul-fx.js';

export const FLASK_HEAL = 45, FLASK_TIME = 0.8, DARK_GRACE = 1.5, DARK_DPS = 6, SPIKE_DMG = 25;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** x, y: the spawn tile's centre. */
export function newPlayer(x, y) {
  return { x: x - 9, y: y + TS / 2 - 40, w: 18, h: 40, vx: 0, vy: 0, face: 1, onGround: false, wasGround: false,
    coyT: 0, bufT: 0, dropT: 0, jumpCut: false, rollT: 0, rollCd: 0, rollDir: 1, atkT: 0, atkN: 0, atkQ: false,
    atkHit: new Set(), blocking: false, parryT: 0, hp: 100, flask: 1, drinkT: 0, inv: 0, oil: 100, snuffT: 0,
    darkT: 0, beatT: 0, blockFlash: 0, hang: null, mantleT: 0, phase: 0, dead: false, deadT: 0, cause: '', hurtT: 0 };
}

export function stepPlayer(S, inp, dt) {
  const p = S.player, T = S.T, room = S.room;
  p.inv = Math.max(0, p.inv - dt); p.rollCd = Math.max(0, p.rollCd - dt); p.parryT = Math.max(0, p.parryT - dt);
  p.snuffT = Math.max(0, p.snuffT - dt); p.dropT = Math.max(0, p.dropT - dt); p.hurtT = Math.max(0, p.hurtT - dt);
  p.blockFlash = Math.max(0, p.blockFlash - dt);
  if (p.dead) {
    p.deadT += dt; p.vy += T.gravity * dt; p.vx *= 0.9;
    moveY(room, p, p.vy * dt, true); moveX(room, p, p.vx * dt);
    return;
  }

  // Oil drains; at zero the Dark comes (spec §4.1)
  p.oil = Math.max(0, p.oil - T.drain * dt);
  if (p.oil <= 0) {
    p.darkT += dt; p.beatT -= dt;
    if (p.beatT <= 0) { sfx(S, 'beat'); p.beatT = 1.05; }
    if (p.darkT > DARK_GRACE) { p.hp -= DARK_DPS * dt; if (p.hp <= 0) { killPlayer(S, 'the Dark'); return; } }
  } else p.darkT = 0;

  // The flask: one per act, a slow drink you can be hit out of
  if (p.drinkT > 0) {
    p.drinkT -= dt;
    if (p.drinkT <= 0) { p.hp = Math.min(100, p.hp + FLASK_HEAL); text(S, p.x + 9, p.y - 6, `+${FLASK_HEAL}`, '#ffb3a6'); }
  } else if (inp.flask && p.flask > 0 && p.onGround && p.rollT <= 0) { p.flask--; p.drinkT = FLASK_TIME; sfx(S, 'drink'); }

  // Hanging from a ledge: jump climbs up, down or away lets go
  if (p.hang) {
    p.vx = 0; p.vy = 0;
    const h = p.hang;
    if (p.mantleT > 0) {
      p.mantleT -= dt;
      const k = 1 - Math.max(0, p.mantleT) / 0.16;
      p.x = h.x0 + (h.x1 - h.x0) * k; p.y = h.y0 + (h.y1 - h.y0) * k;
      if (p.mantleT <= 0) { p.hang = null; p.onGround = true; }
      return;
    }
    if (inp.jump) {
      p.mantleT = 0.16; h.x0 = p.x; h.y0 = p.y; h.x1 = h.side > 0 ? h.tx : h.tx + TS - p.w; h.y1 = h.ty - p.h;
      return;
    }
    if (!(inp.down || inp.dir === -h.side)) return;
    p.hang = null; p.dropT = 0.1;
  }

  // Roll: a short dodge window at its start, then a cooldown
  if (p.rollT > 0) p.rollT -= dt;
  else if (inp.roll && p.rollCd <= 0 && p.drinkT <= 0) {
    p.rollT = T.rollTime; p.rollCd = T.rollTime + T.rollCd; p.rollDir = inp.dir || p.face; p.face = p.rollDir;
    p.atkT = 0; p.atkQ = false; p.blocking = false; sfx(S, 'roll');
  }
  const rolling = p.rollT > 0;

  // Block while held; a press opens the parry window (spec §5.2)
  p.blocking = inp.block && !rolling && p.drinkT <= 0 && p.atkT <= 0;
  if (inp.blockPress && !rolling) p.parryT = T.parry;

  // You can't turn mid-swing, but pressing the other way drops the swing and turns you at once (owner, 2026-10-21:
  // waiting the swing out felt clunky). Any hits it already landed stand.
  if (p.atkT > 0 && inp.dir && inp.dir !== p.face) { p.atkT = 0; p.atkQ = false; p.atkN = 0; p.face = inp.dir; }

  // Three-hit chain; a press during a swing queues the next one
  if (p.atkT > 0) {
    if (inp.attack) p.atkQ = true;
    p.atkT -= dt;
    if (p.atkT <= 0 && p.atkQ) { p.atkQ = false; startSwing(S, (p.atkN % 3) + 1); }
    else if (p.atkT <= 0) p.atkN = 0;
  } else if (inp.attack && !rolling && p.drinkT <= 0 && !p.blocking) startSwing(S, 1);
  if (p.atkT > 0) swingHits(S);

  if (inp.throwL && !rolling) throwOrRecall(S);

  // Run
  const ground = p.onGround;
  if (rolling) p.vx = p.rollDir * T.rollSpeed;
  else {
    const slow = p.blocking ? 0 : p.drinkT > 0 ? 0.3 : p.atkT > 0 && ground ? 0.35 : 1;
    const target = inp.dir * T.run * slow, a = ground ? (inp.dir ? T.accel : T.decel) : T.airAccel;
    p.vx += clamp(target - p.vx, -a * dt, a * dt);
    if (inp.dir && p.atkT <= 0 && !p.blocking) p.face = inp.dir;
  }

  // Jump: coyote time, a buffer, higher while held; S + jump drops through a thin ledge
  if (inp.jump) p.bufT = T.buffer / 1000; else p.bufT = Math.max(0, p.bufT - dt);
  p.coyT = ground ? T.coyote / 1000 : Math.max(0, p.coyT - dt);
  if (inp.down && inp.jump && ground && standingOnOneWay(room, p)) { p.dropT = 0.22; p.bufT = 0; }
  else if (p.bufT > 0 && p.coyT > 0 && !p.blocking && p.drinkT <= 0) {
    p.vy = -T.jump; p.bufT = 0; p.coyT = 0; p.jumpCut = false; if (rolling) p.rollT = 0; sfx(S, 'jump');
  }
  if (!inp.jumpHeld && p.vy < 0 && !p.jumpCut) { p.vy *= 0.45; p.jumpCut = true; }
  p.vy = Math.min(p.vy + T.gravity * (p.vy > 0 ? T.fallMult : 1) * dt, 950);

  const vyBefore = p.vy;
  moveX(room, p, p.vx * dt);
  if (p.hitWall && !ground && vyBefore > 0 && inp.dir === p.hitWall) {
    const h = tryHang(room, p, p.hitWall);
    if (h) { p.hang = h; p.rollT = 0; p.atkT = 0; return; }
  }
  moveY(room, p, p.vy * dt, p.dropT <= 0);
  if (p.onGround && !p.wasGround && vyBefore > 300) { sfx(S, 'land'); burst(S, p.x + p.w / 2, p.y + p.h, 5, '90,80,70', { spread: 60 }); }
  p.wasGround = p.onGround;
  if (p.spiked) { hurtPlayer(S, null, SPIKE_DMG, 'red', p.x + p.w / 2, 'spikes'); if (!p.dead) p.vy = -620; }
  p.phase += Math.abs(p.vx) * dt * 0.05;
}

function startSwing(S, n) {
  const p = S.player;
  p.atkN = n; p.atkT = SWING; p.atkHit = new Set(); sfx(S, 'swing');
  if (p.onGround) p.vx += p.face * (n === 3 ? 140 : 70);
}

/** The blade is live from 25% to 60% of a swing. The third hit is the heavy one. */
function swingHits(S) {
  const p = S.player, prog = 1 - p.atkT / SWING;
  if (prog < 0.25 || prog > 0.6) return;
  const box = { x: p.face > 0 ? p.x + p.w - 4 : p.x - 44, y: p.y + 2, w: 48, h: 36 };
  const heavy = p.atkN === 3;
  for (const e of S.enemies) {
    if (e.dead || p.atkHit.has(e)) continue;
    if (box.x < e.x + e.w && box.x + box.w > e.x && box.y < e.y + e.h && box.y + box.h > e.y) {
      p.atkHit.add(e); hurtEnemy(S, e, heavy ? 20 : 12, heavy ? 22 : 12, p.face * (heavy ? 320 : 170), p.x + p.w / 2);
    }
  }
}
