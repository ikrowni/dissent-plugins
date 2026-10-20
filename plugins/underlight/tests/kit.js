// tests/kit.js — helpers the tests share. In tests/ so it is never declared as a plugin resource.
import { newGame, step } from '../ul-game.js';
import { DT } from '../ul-const.js';

export const idle = () => ({ dir: 0, down: false, jumpHeld: false, jump: false, roll: false, attack: false, block: false, blockPress: false, throwL: false, flask: false });
export const press = (over) => ({ ...idle(), ...over });

/** A plain room: a floor, walls, and the given rows of air above it. P at the left. */
export function flatRoom(width = 30, air = 8) {
  const rows = ['#'.repeat(width)];
  for (let i = 0; i < air - 1; i++) rows.push('#' + ' '.repeat(width - 2) + '#');
  rows.push('#P' + ' '.repeat(width - 3) + '#');
  rows.push('#'.repeat(width));
  return rows;
}

/** A game on rows, with the player settled on the floor. */
export function settled(rows, opts) {
  const S = newGame(rows, opts);
  run(S, 0.3);
  S.fx = [];
  return S;
}

/** Step for seconds with one input (or a function of the step number). */
export function run(S, seconds, inp = idle()) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) step(S, typeof inp === 'function' ? inp(i) : inp, DT);
}
