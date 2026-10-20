// ul-game.js — one room's state, one fixed step, and the clock that runs whole steps.
import { DT, MAX_STEPS, DEFAULT_TUNE } from './ul-const.js';
import { parseRoom } from './ul-room.js';
import { buildSegs, makeLights } from './ul-light.js';
import { newPlayer, stepPlayer } from './ul-player.js';
import { stepLantern } from './ul-lantern.js';
import { stepPickups } from './ul-pickups.js';
import { makeEnemy, stepEnemies } from './ul-enemies.js';
import { rng } from './ul-rng.js';
import { stepShots, stepHazards } from './ul-hazards.js';
import { makeRatKing, stepBoss } from './ul-ratking.js';

export const DEATH_CARD_AFTER = 1.3, CLEAR_CARD_AFTER = 0.9, OIL_CACHE = 20;

/**
 * over: null while playing, then 'dead', 'exit' (you reached the stairs down, X) or, in a room with no stairs,
 * 'cleared'. carry: { hp, oil, flask } brought from the level before.
 */
export function newGame(rows, { seed = 1, tune = DEFAULT_TUNE, carry = null, litSconces = false } = {}) {
  const room = parseRoom(rows), start = room.spawns.find((s) => s.ch === 'P');
  const S = { room, segs: buildSegs(room), T: { ...tune }, rng: rng(seed), t: 0, hitStop: 0, fx: [], over: null, clearT: 0,
    player: newPlayer(start.x, start.y), lantern: { state: 'held', x: 0, y: 0, vx: 0, vy: 0, hitSet: new Set() },
    enemies: [], sconces: [], drops: [], shots: [], hazards: [], stats: { parries: 0, dodges: 0, hits: 0 }, nextId: 1, exit: null, boss: null };
  if (carry) Object.assign(S.player, carry);
  for (const s of room.spawns) {
    if (s.ch === 'S') S.sconces.push({ x: s.x, y: s.y, lit: litSconces });
    else if (s.ch === 'K') S.enemies.push(...makeRatKing(S, s.x, s.y));
    else if (s.ch === 'X') S.exit = { x: s.x, y: s.y };
    else if (s.ch === 'o') S.drops.push({ x: s.x, y: s.y, vx: 0, vy: 0, amt: OIL_CACHE, t: 1 });
    else if (s.ch !== 'P') S.enemies.push(...makeEnemy(S, s.ch, s.x, s.y));
  }
  return S;
}

export function step(S, inp, dt) {
  if (S.over) return;
  S.t += dt;
  const L = makeLights(S);
  stepPlayer(S, inp, dt);
  stepLantern(S, dt);
  stepBoss(S, dt);
  stepEnemies(S, dt, L);
  stepPickups(S, dt);
  stepShots(S, dt);
  stepHazards(S, dt);
  const p = S.player;
  if (p.dead) { if (p.deadT > DEATH_CARD_AFTER) S.over = 'dead'; }
  else if (S.exit) { if (atExit(p, S.exit) && !(S.boss && !S.boss.dead)) S.over = 'exit'; } // shut while a boss lives // a level ends at the stairs; killing everything is not asked
  else if (S.enemies.length > 0 && S.enemies.every((e) => e.dead)) { // a room with no enemies never clears itself
    S.clearT += dt;
    if (S.clearT > CLEAR_CARD_AFTER) S.over = 'cleared';
  }
}

/** Your body touches the stairs' tile. The solver uses the same box (ul-solver.js). */
export const atExit = (p, e) => p.x < e.x + 12 && p.x + p.w > e.x - 12 && p.y < e.y + 12 && p.y + p.h > e.y - 12;

/**
 * Run whole fixed steps for the time banked in acc (seconds); returns what is left over.
 * 🔴 During hit-stop no step runs, and presses wait in the input until one does.
 */
export function advance(S, input, acc) {
  let steps = 0;
  while (acc >= DT && steps < MAX_STEPS) {
    acc -= DT; steps++;
    if (S.hitStop > 0) { S.hitStop -= DT; continue; }
    step(S, input.read(), DT);
    input.consume();
  }
  return steps >= MAX_STEPS ? 0 : acc;
}
