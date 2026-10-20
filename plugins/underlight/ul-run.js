// ul-run.js — one act of a run (spec §3.1): three levels with a lamp post between each, the boss, the camp. Body, oil, flask carry
// from one to the next. Every level's seed comes from the run's base, and in Dissent the base comes from the table's
// id, which the node made, plus how many runs that table has started: everyone at a table gets the same levels, and
// trying again is a new descent.
import { buildLevel } from './ul-level.js';
import { newGame } from './ul-game.js';

export const STEPS = ['level', 'lamp', 'level', 'lamp', 'level', 'boss', 'camp'];
export const LEVELS = STEPS.filter((s) => s === 'level').length;

/** FNV-1a, 32 bits: a string to a seed. */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h || 1;
}

export const newRun = (base) => ({ base, step: 0, carry: null });
const levelNo = (run) => STEPS.slice(0, run.step + 1).filter((s) => s === 'level').length;

export function stepLabel(run, biome) {
  const kind = STEPS[run.step];
  return kind === 'lamp' ? 'Lamp post' : kind === 'boss' ? 'The Rat King' : kind === 'camp' ? 'The camp' : `${biome.name} · level ${levelNo(run)} of ${LEVELS}`;
}

/** The game for the run's current step: a built level, the lamp post, the boss's arena or the camp (both lit when you
 *  arrive). A run continued from a save arrives at the camp having rested already: no second rest for free. */
export function openStep(run, biome, lampPost, arena, camp) {
  const seed = hashSeed(`${run.base}:${run.step}`), kind = STEPS[run.step];
  const rows = kind === 'lamp' ? lampPost.rows : kind === 'boss' ? arena : kind === 'camp' ? camp : buildLevel(biome, seed).rows;
  const S = newGame(rows, { seed, carry: run.carry, litSconces: kind === 'boss' || kind === 'camp' });
  if (kind === 'camp' && run.resumed && S.fire) S.fire.rested = true;
  return S;
}

/** The step was finished (its stairs reached): carry what you have on. 'next', or 'act-done' past the last step (the camp). */
export function closeStep(run, S) {
  const p = S.player;
  run.carry = { hp: p.hp, oil: p.oil, flask: p.flask };
  run.step++;
  return run.step >= STEPS.length ? 'act-done' : 'next';
}
