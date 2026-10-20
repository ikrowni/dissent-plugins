// tests/chunks.js — build test chunks: a stone frame with a floor at row 16 and the given sides open.
import { CW, CH, slotTiles } from '../ul-chunk.js';

/** open: a string of sides, e.g. 'LRD'. put: [[row, col, text]] written over the result. */
export function blank(open = '', put = []) {
  const g = Array.from({ length: CH }, (_, r) => Array.from({ length: CW }, (_, c) =>
    (r === 0 || r >= 16 || c === 0 || c === CW - 1) ? '#' : ' '));
  for (const s of open) for (const [c, r] of slotTiles(s)) g[r][c] = ' ';
  if (open.includes('D')) for (const c of [14, 15, 16, 17]) g[16][c] = ' '; // a hole in the floor down to the shaft
  for (const [r, c, text] of put) for (let i = 0; i < text.length; i++) g[r][c + i] = text[i];
  return g.map((r) => r.join(''));
}

/** A small biome of plain chunks, for testing the builder rather than the rooms. bad: add a path chunk with a wall
 *  down its middle that no level can get through, so the solver has something to reject. */
export function testBiome({ bad = false, trap = false } = {}) {
  const chunks = [
    { id: 'in', role: 'entrance', rows: blank('LRD', [[15, 4, 'P']]) },
    { id: 'out', role: 'exit', rows: blank('LRU', [[15, 26, 'X']]) },
    { id: 'hall', role: 'path', rows: blank('LRUD', [[15, 6, 'g'], [15, 24, 'g'], [9, 10, 'a'], [9, 20, 'a'], [15, 9, '?']]) },
    { id: 'hall2', role: 'path', rows: blank('LRUD', [[15, 8, 'g'], [8, 16, 'a'], [14, 20, '*']]) },
    { id: 'nook', role: 'side', rows: blank('LR', [[15, 15, 'o'], [15, 10, 'g'], [15, 20, 'g']]) },
  ];
  // trap: a side room holding a closed cellar under a high lid you can drop through (S + jump) but never climb back
  // out of. One side room in five, so it comes up in some levels and the builder has to roll it away.
  if (trap) {
    for (const n of [2, 3, 4]) chunks.push({ id: `nook${n}`, role: 'side', rows: blank('LR', [[15, 15, 'o']]) });
    chunks.push({ id: 'trap', role: 'side', rows: blank('LR', [[12, 17, '---'], [9, 21, '------'], [15, 6, 'o'],
      ...Array.from({ length: 6 }, (_, i) => [10 + i, 20, '#']), ...Array.from({ length: 6 }, (_, i) => [10 + i, 27, '#'])]) });
  }
  if (bad) chunks.push({ id: 'wall', role: 'path', rows: blank('LRUD', Array.from({ length: 15 }, (_, i) => [i + 1, 10, '#'])) });
  return { name: 'Test', plan: { grid: [4, 3], path: [4, 9], sides: [1, 2], pacing: [0, 2, 4, 6], sideBudget: 4 }, chunks };
}
