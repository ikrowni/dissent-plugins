// ul-save.js — a run saved at a camp (spec §3.1: saves only at camps), and read back. A save is small: the run's seed
// base, the step it is on (the camp), and what you carry. Anything that doesn't look exactly like a save is ignored,
// never trusted: it came from storage, which a future version, a bug or a hand might have changed.
import { STEPS } from './ul-run.js';

export const SAVE_KEY = 'run', SAVE_V = 1;

export function saveOf(run, at) {
  return { v: SAVE_V, base: run.base, step: run.step, carry: { hp: run.carry.hp, oil: run.carry.oil, flask: run.carry.flask }, at };
}

const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

/** A stored value → a save, or null. Only a save at a camp is a save. */
export function readSave(x) {
  if (!x || typeof x !== 'object' || x.v !== SAVE_V) return null;
  if (!Number.isInteger(x.base) || x.base <= 0 || !Number.isInteger(x.step) || STEPS[x.step] !== 'camp') return null;
  const c = x.carry;
  if (!c || !num(c.hp, 1, 100) || !num(c.oil, 0, 100) || (c.flask !== 0 && c.flask !== 1)) return null;
  return { base: x.base, step: x.step, carry: { hp: c.hp, oil: c.oil, flask: c.flask }, at: num(x.at, 0, 1e15) ? x.at : 0 };
}

/** The run a save continues. */
export const runFrom = (save) => ({ base: save.base, step: save.step, carry: { ...save.carry }, resumed: true });
