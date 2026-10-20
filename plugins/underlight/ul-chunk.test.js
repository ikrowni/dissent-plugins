import { describe, it, expect } from 'vitest';
import { openings, chunkErrors, seal, CW, CH } from './ul-chunk.js';
import { blank } from './tests/chunks.js';

describe('openings', () => {
  it('reads which slots are air', () => {
    expect([...openings(blank('LRD'))].sort()).toEqual(['D', 'L', 'R']);
    expect(openings(blank('')).size).toBe(0);
  });
});

describe('chunkErrors', () => {
  it('passes a well-made chunk', () => {
    expect(chunkErrors({ id: 'ok', role: 'path', rows: blank('LRUD') })).toEqual([]);
  });
  it('wants 32 x 18', () => {
    expect(chunkErrors({ id: 'short', role: 'path', rows: blank('LR').slice(1) })[0]).toBe(`short: 17 rows, not ${CH}`);
    const wide = blank('LR'); wide[3] += ' ';
    expect(chunkErrors({ id: 'wide', role: 'path', rows: wide })).toEqual([`wide: row 3 is ${CW + 1} wide, not ${CW}`]);
  });
  it('wants stone on the border outside the slots', () => {
    const rows = blank('LR', [[5, 0, ' ']]);
    expect(chunkErrors({ id: 'leak', role: 'path', rows })).toContain('leak: border at row 5 col 0 must be stone');
  });
  it('wants a slot all open or all shut', () => {
    const rows = blank('', [[13, 0, ' ']]);
    expect(chunkErrors({ id: 'half', role: 'path', rows })).toContain('half: the L slot must be all air or all stone');
  });
  it('knows its letters', () => {
    expect(chunkErrors({ id: 'q', role: 'path', rows: blank('LR', [[10, 5, 'h']]) })).toContain('q: row 10 col 5: unknown "h"');
  });
  it('wants one P in an entrance, one X in an exit, and neither elsewhere', () => {
    expect(chunkErrors({ id: 'e', role: 'entrance', rows: blank('LR') })).toContain('e: an entrance needs exactly one P');
    expect(chunkErrors({ id: 'x', role: 'exit', rows: blank('LR') })).toContain('x: needs exactly one X');
    expect(chunkErrors({ id: 'p', role: 'path', rows: blank('LR', [[15, 5, 'P']]) })).toContain('p: only an entrance has a P');
  });
});

describe('seal', () => {
  it('fills a side with stone and leaves the rest', () => {
    const rows = seal(blank('LRD'), ['L', 'D']);
    expect([...openings(rows)]).toEqual(['R']);
    expect(chunkErrors({ id: 's', role: 'path', rows })).toEqual([]);
  });
});
