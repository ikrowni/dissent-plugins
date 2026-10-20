// tests/route.js — can you get through one chunk? It sits in the middle of a 3 x 3 grid of plain neighbours: you
// start in the neighbour on the `from` side (or at the chunk's own P), and the stairs are in the neighbour on the `to`
// side (or at the chunk's own X). Sides the route doesn't use are sealed. Slots: '*' all stone or all air (worst
// case, both are tried by the caller), '?' a sconce (it must be reachable), g/a nothing.
import { CW, CH, SIDES, seal } from '../ul-chunk.js';
import { stitch, targetsOf } from '../ul-level.js';
import { parseRoom } from '../ul-room.js';
import { solve } from '../ul-solver.js';
import { DEFAULT_TUNE } from '../ul-const.js';
import { blank } from './chunks.js';

const AT = { L: [0, 1], R: [2, 1], U: [1, 0], D: [1, 2] };
const OPP = { L: 'R', R: 'L', U: 'D', D: 'U' };

/** from/to: a side, or 'self' (the chunk's own P / X). stars: '#' or ' '. Returns the solver's result. */
export function route(chunk, from, to, stars = ' ') {
  const used = new Set([from, to].filter((s) => s !== 'self'));
  let rows = seal(chunk.rows, SIDES.filter((s) => !used.has(s)));
  rows = rows.map((row) => row.replace(/\*/g, stars).replace(/\?/g, 'S').replace(/[ga]/g, ' '));
  if (from !== 'self') rows = rows.map((row) => row.replace('P', ' '));
  if (to !== 'self') rows = rows.map((row) => row.replace('X', ' '));
  const placed = [{ cell: { c: 1, r: 1 }, rows }];
  for (const s of used) {
    const [c, r] = AT[s];
    // a plain neighbour opening back at the chunk, its marks on the floor away from its own shaft. Going in and
    // back out the same side (a side room), the neighbour holds both the start and the stairs.
    const marks = from === to ? [[15, 6, 'P'], [15, 24, 'X']] : [[15, s === 'R' ? 24 : 6, s === from ? 'P' : 'X']];
    placed.push({ cell: { c, r }, rows: blank(OPP[s], marks) });
  }
  const room = parseRoom(stitch({ cols: 3, rows: 3 }, placed));
  return solve(room, DEFAULT_TUNE, room.spawns.find((s) => s.ch === 'P'), targetsOf(room));
}

/** Every route a chunk must allow, for its role. */
export function routesFor(chunk, open) {
  const outs = [...open].filter((s) => s !== 'U'), ins = [...open].filter((s) => s !== 'D');
  if (chunk.role === 'entrance') return outs.map((to) => ['self', to]);
  if (chunk.role === 'exit') return ins.map((from) => [from, 'self']);
  if (chunk.role === 'lamppost') return [['self', 'self']];
  if (chunk.role === 'side') return [...open].map((s) => [s, s]); // in from one side, everything reachable, back out
  const pairs = [];
  for (const from of ins) for (const to of outs) if (from !== to) pairs.push([from, to]);
  return pairs;
}
export { CW, CH };
