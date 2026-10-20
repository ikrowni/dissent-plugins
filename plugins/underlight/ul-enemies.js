// ul-enemies.js — which letter in a room is which enemy, and stepping them all. Piece 1c adds kinds here.
import { tickTimers } from './ul-enemy.js';
import { ATTACK_STATES } from './ul-combat.js';
import { makeShade, stepShade } from './ul-shade.js';
import { makeMoth, stepMoth } from './ul-moth.js';
import { makeSnuffer, stepSnuffer } from './ul-snuffer.js';

/** Room letter → the enemy it spawns. */
export const ENEMY_KINDS = {
  h: { kind: 'shade', make: makeShade, step: stepShade },
  m: { kind: 'moth', make: makeMoth, step: stepMoth },
  n: { kind: 'snuffer', make: makeSnuffer, step: stepSnuffer },
};
const STEP = Object.fromEntries(Object.values(ENEMY_KINDS).map((k) => [k.kind, k.step]));

/** x, y: the spawn tile's centre. */
export function makeEnemy(S, ch, x, y) {
  const k = ENEMY_KINDS[ch];
  if (!k) throw new Error(`no enemy for "${ch}"`);
  return k.make(S, x, y);
}

/** Enemies further than this from you sleep (a level is ~30 of them; most are screens away). */
export const AWAKE = 900;

export function stepEnemies(S, dt, L) {
  const p = S.player, pc = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  for (const e of S.enemies) {
    if (e.dead) continue;
    e.asleep = Math.hypot(e.x + e.w / 2 - pc.x, e.y + e.h / 2 - pc.y) > AWAKE;
    if (e.asleep) { if (ATTACK_STATES.includes(e.state)) e.state = 'idle'; continue; } // a sleeper holds no attack token
    tickTimers(e, dt);
    STEP[e.kind](S, e, dt, L, pc);
  }
}
