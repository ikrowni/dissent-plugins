import { describe, it, expect } from 'vitest';
import { makeLayout } from './ul-layout.js';
import { rng } from './ul-rng.js';

const PLAN = { grid: [6, 4], path: [7, 14], sides: [2, 3], pacing: [0, 2, 3, 4, 1, 4, 5, 6, 2, 6, 7], sideBudget: 4 };
const seeds = Array.from({ length: 300 }, (_, i) => i + 1);

describe('makeLayout', () => {
  it('is the same for the same seed', () => {
    const a = makeLayout(PLAN, rng(42)), b = makeLayout(PLAN, rng(42));
    expect(JSON.stringify(a, (k, v) => (v instanceof Set ? [...v].sort() : v))).toBe(JSON.stringify(b, (k, v) => (v instanceof Set ? [...v].sort() : v)));
  });
  it('runs from an entrance on the top row to the stairs on the bottom row, in reach of the plan', () => {
    for (const s of seeds) {
      const L = makeLayout(PLAN, rng(s));
      const path = L.cells.filter((c) => c.role !== 'side');
      expect(path[0]).toMatchObject({ role: 'entrance', r: 0 });
      expect(path.at(-1)).toMatchObject({ role: 'exit', r: 3 });
      expect(path.length).toBeGreaterThanOrEqual(7);
      expect(path.length).toBeLessThanOrEqual(14);
    }
  });
  it('steps one cell at a time, sideways or down, never up, never twice into a cell', () => {
    for (const s of seeds) {
      const L = makeLayout(PLAN, rng(s)), path = L.cells.filter((c) => c.role !== 'side');
      for (let i = 1; i < path.length; i++) {
        const dc = Math.abs(path[i].c - path[i - 1].c), dr = path[i].r - path[i - 1].r;
        expect(dc + dr).toBe(1);
        expect(dr).toBeGreaterThanOrEqual(0);
      }
      expect(new Set(L.cells.map((c) => `${c.c},${c.r}`)).size).toBe(L.cells.length);
    }
  });
  it('opens matching sides between neighbours, and nothing else', () => {
    for (const s of seeds) {
      const L = makeLayout(PLAN, rng(s)), at = new Map(L.cells.map((c) => [`${c.c},${c.r}`, c]));
      for (const cell of L.cells) for (const side of cell.need) {
        const [dc, dr] = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] }[side];
        const other = at.get(`${cell.c + dc},${cell.r + dr}`);
        expect(other, `seed ${s}: ${side} of ${cell.c},${cell.r}`).toBeDefined();
        expect(other.need.has({ L: 'R', R: 'L', U: 'D', D: 'U' }[side])).toBe(true);
      }
    }
  });
  it('hangs two or three side rooms off the path as dead ends', () => {
    let total = 0;
    for (const s of seeds) {
      const sides = makeLayout(PLAN, rng(s)).cells.filter((c) => c.role === 'side');
      for (const x of sides) expect(x.need.size).toBe(1);
      total += sides.length;
    }
    expect(total / seeds.length).toBeGreaterThan(1.8);
  });
  it('gives the entrance no enemies, sides their budget, and the path its pacing', () => {
    const L = makeLayout(PLAN, rng(9));
    expect(L.cells.find((c) => c.role === 'entrance').budget).toBe(0);
    for (const x of L.cells.filter((c) => c.role === 'side')) expect(x.budget).toBe(4);
    expect(L.cells.find((c) => c.role === 'exit').budget).toBe(7);
  });
});
