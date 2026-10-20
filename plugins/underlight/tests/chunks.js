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

