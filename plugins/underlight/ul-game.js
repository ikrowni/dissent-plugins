// ul-game.js — one room's state, one fixed step, and the clock that runs whole steps.
import { DT, MAX_STEPS, DEFAULT_TUNE } from './ul-const.js';
import { parseRoom } from './ul-room.js';
import { buildSegs, makeLights } from './ul-light.js';
import { newPlayer, stepPlayer } from './ul-player.js';
import { stepLantern } from './ul-lantern.js';
import { stepPickups } from './ul-pickups.js';
import { makeEnemy, stepEnemies } from './ul-enemies.js';
import { rng } from './ul-rng.js';

export const DEATH_CARD_AFTER = 1.3, CLEAR_CARD_AFTER = 0.9;

/** over: null while playing, then 'dead' or 'cleared' (the room shows its card). */
export function newGame(rows, { seed = 1, tune = DEFAULT_TUNE } = {}) {
  const room = parseRoom(rows), start = room.spawns.find((s) => s.ch === 'P');
  const S = { room, segs: buildSegs(room), T: { ...tune }, rng: rng(seed), t: 0, hitStop: 0, fx: [], over: null, clearT: 0,
    player: newPlayer(start.x, start.y), lantern: { state: 'held', x: 0, y: 0, vx: 0, vy: 0, hitSet: new Set() },
    enemies: [], sconces: [], drops: [], stats: { parries: 0, dodges: 0, hits: 0 }, nextId: 1 };
  for (const s of room.spawns) {
    if (s.ch === 'S') S.sconces.push({ x: s.x, y: s.y, lit: false });
    else if (s.ch !== 'P') S.enemies.push(makeEnemy(S, s.ch, s.x, s.y));
  }
  return S;
}

export function step(S, inp, dt) {
  if (S.over) return;
  S.t += dt;
  const L = makeLights(S);
  stepPlayer(S, inp, dt);
  stepLantern(S, dt);
  stepEnemies(S, dt, L);
  stepPickups(S, dt);
  if (S.player.dead) { if (S.player.deadT > DEATH_CARD_AFTER) S.over = 'dead'; }
  else if (S.enemies.length > 0 && S.enemies.every((e) => e.dead)) { // a room with no enemies never clears itself
    S.clearT += dt;
    if (S.clearT > CLEAR_CARD_AFTER) S.over = 'cleared';
  }
}

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
