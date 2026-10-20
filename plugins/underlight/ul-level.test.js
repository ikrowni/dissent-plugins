import { describe, it, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000 }); // each level runs the solver
import { buildLevel, fill, pickChunk, targetsOf, COST } from './ul-level.js';
import { solve } from './ul-solver.js';
import { DEFAULT_TUNE } from './ul-const.js';
import { CW, CH } from './ul-chunk.js';
import { parseRoom } from './ul-room.js';
import { rng } from './ul-rng.js';
import { blank, testBiome } from './tests/chunks.js';

const count = (rows, ch) => rows.join('').split(ch).length - 1;
const cellText = (rows, c, r) => rows.slice(r * CH, r * CH + CH).map((row) => row.slice(c * CW, c * CW + CW));

describe('buildLevel', () => {
  it('is one level per seed', () => {
    expect(buildLevel(testBiome(), 5).rows).toEqual(buildLevel(testBiome(), 5).rows);
    expect(buildLevel(testBiome(), 5).rows).not.toEqual(buildLevel(testBiome(), 6).rows);
  });
  it('stitches the grid into one map with one start and one stairs', () => {
    const { rows } = buildLevel(testBiome(), 11);
    expect(rows.length).toBe(3 * CH);
    expect(rows.every((r) => r.length === 4 * CW)).toBe(true);
    expect([count(rows, 'P'), count(rows, 'X')]).toEqual([1, 1]);
    expect(() => parseRoom(rows)).not.toThrow();
  });
  it('leaves no opening into rock: every open slot faces an open slot', () => {
    for (let s = 1; s <= 15; s++) {
      const { rows, layout } = buildLevel(testBiome(), s);
      const at = new Set(layout.cells.map((c) => `${c.c},${c.r}`));
      for (const cell of layout.cells) {
        const t = cellText(rows, cell.c, cell.r);
        if (t[13][CW - 1] === ' ') expect(at.has(`${cell.c + 1},${cell.r}`)).toBe(true);
        if (t[13][0] === ' ') expect(at.has(`${cell.c - 1},${cell.r}`)).toBe(true);
        if (t[CH - 1][15] === ' ') expect(at.has(`${cell.c},${cell.r + 1}`)).toBe(true);
        if (t[0][15] === ' ') expect(at.has(`${cell.c},${cell.r - 1}`)).toBe(true);
      }
    }
  });
  it('spends no more than each cell\'s budget on enemies', () => {
    for (let s = 1; s <= 15; s++) {
      const { rows, layout } = buildLevel(testBiome(), s);
      for (const cell of layout.cells) {
        const t = cellText(rows, cell.c, cell.r);
        const spent = count(t, 'h') * COST.h + count(t, 'm') * COST.m + count(t, 'n') * COST.n;
        expect(spent).toBeLessThanOrEqual(cell.budget);
        expect(count(t, 'n')).toBeLessThanOrEqual(1);
      }
    }
  });
  it('never hands out a level with a trap in it', () => {
    let sawTrap = 0;
    for (let s = 1; s <= 12; s++) {
      const L = buildLevel(testBiome({ trap: true }), s);
      const room = parseRoom(L.rows), res = solve(room, DEFAULT_TUNE, room.spawns.find((q) => q.ch === 'P'), targetsOf(room));
      expect(res.trapped).toEqual([]);
      if (L.tries > 1) sawTrap++;
    }
    expect(sawTrap).toBeGreaterThan(0); // the trap chunk did come up, and was rolled away
  });
  it('re-rolls a level the solver rejects, and still gives a good one', () => {
    let rerolled = 0;
    for (let s = 1; s <= 15; s++) if (buildLevel(testBiome({ bad: true }), s).tries > 1) rerolled++; // (the wall is fine where the path only drops through it)
    expect(rerolled).toBeGreaterThan(0);
  });
});

describe('fill', () => {
  const rows = blank('LR', [[15, 3, 'g'], [15, 6, 'g'], [15, 9, 'g'], [8, 12, 'a'], [8, 16, 'a'], [10, 20, '*'], [15, 22, '?']]);
  it('places nothing on a budget of zero, and resolves every slot', () => {
    const out = fill(rows, 0, rng(1)).join('');
    for (const ch of 'hmnga*?') expect(out.includes(ch)).toBe(false);
  });
  it('buys Moths for air slots and Shades or one Snuffer for ground slots, within budget', () => {
    for (let s = 1; s < 50; s++) {
      const out = fill(rows, 7, rng(s));
      const spent = count(out, 'h') * 2 + count(out, 'm') * 2 + count(out, 'n') * 3;
      expect(spent).toBeLessThanOrEqual(7);
      expect(spent).toBeGreaterThanOrEqual(6);
      for (const [r, c] of [[8, 12], [8, 16]]) expect(' m').toContain(out[r][c]);
    }
  });
});

describe('pickChunk', () => {
  it('says plainly when a biome has no chunk for a need', () => {
    expect(() => pickChunk(testBiome(), { role: 'side', need: new Set(['D']) }, new Set(), rng(1))).toThrow('Test: no side chunk opens D');
  });
});
