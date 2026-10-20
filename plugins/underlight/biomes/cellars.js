// biomes/cellars.js — the Cellars, act 1's first biome: its plan and its chunks.
import { CELLARS_ENDS } from './cellars-entrances.js';
import { CELLARS_PATHS } from './cellars-paths.js';
import { CELLARS_SIDES } from './cellars-sides.js';

export const CELLARS = {
  name: 'Cellars',
  // a 6 x 4 grid; a path of 8–14 cells; two or three side rooms; danger rising, a break, a peak at the stairs
  plan: { grid: [6, 4], path: [8, 14], sides: [2, 3], pacing: [0, 2, 3, 4, 2, 5, 6, 3, 6, 7], sideBudget: 4 },
  chunks: [...CELLARS_ENDS, ...CELLARS_PATHS, ...CELLARS_SIDES],
};
export const LAMP_POST = CELLARS_ENDS.find((k) => k.role === 'lamppost');
