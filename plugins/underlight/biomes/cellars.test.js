import { describe, it, expect, vi } from 'vitest';
import { CELLARS, LAMP_POST } from './cellars.js';
import { chunkErrors, openings } from '../ul-chunk.js';
import { makeLayout } from '../ul-layout.js';
import { pickChunk, buildLevel } from '../ul-level.js';
import { rng } from '../ul-rng.js';
import { route, routesFor } from '../tests/route.js';

vi.setConfig({ testTimeout: 60000 }); // the solver runs a lot here

describe('the Cellars chunks', () => {
  it('are all well made, with unique ids', () => {
    expect(CELLARS.chunks.flatMap(chunkErrors)).toEqual([]);
    expect(new Set(CELLARS.chunks.map((k) => k.id)).size).toBe(CELLARS.chunks.length);
    expect(LAMP_POST.role).toBe('lamppost');
  });
  it('can each be crossed every way they open, with every sconce and oil cache in reach and no traps', () => {
    const fails = [];
    for (const k of CELLARS.chunks) for (const [from, to] of routesFor(k, openings(k.rows))) {
      for (const stars of k.rows.join('').includes('*') ? ['#', ' '] : [' ']) {
        const res = route(k, from, to, stars);
        if (!res.exitOk || res.trapped.length || res.missing.length) fails.push(`${k.id} ${from}→${to}`);
      }
    }
    expect(fails).toEqual([]);
  });
  it('cover every opening a layout asks for (300 layouts)', () => {
    for (let s = 1; s <= 300; s++) {
      const r = rng(s), L = makeLayout(CELLARS.plan, r);
      for (const cell of L.cells) expect(() => pickChunk(CELLARS, cell, new Set(), r)).not.toThrow();
    }
  });
});

describe('Cellars levels', () => {
  it('build and pass the solver for a spread of seeds (tests/sweep.mjs runs hundreds)', () => {
    for (const seed of [1, 2, 3, 1000, 65535, 4294967295]) {
      const L = buildLevel(CELLARS, seed);
      expect(L.rows.length).toBe(4 * 18);
      expect(L.tries).toBeLessThanOrEqual(3);
    }
  });
});
