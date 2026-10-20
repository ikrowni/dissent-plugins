import { describe, it, expect } from 'vitest';
import { fill, COST } from './ul-level.js';
import { CELLARS } from './biomes/cellars.js';
import { rng } from './ul-rng.js';
import { blank } from './tests/chunks.js';

describe("the Cellars' enemy mix", () => {
  it('spends within budget, keeps the one-per-chunk limits, and uses every kind', () => {
    const rows = blank('LR', [[15, 3, 'g'], [15, 7, 'g'], [15, 11, 'g'], [15, 15, 'g'], [15, 19, 'g'], [15, 23, 'g'], [8, 12, 'a'], [8, 20, 'a']]);
    const seen = {};
    for (let s = 1; s <= 300; s++) {
      const out = fill(rows, 9, rng(s), CELLARS.foes).join('');
      let spent = 0;
      for (const ch of Object.keys(COST)) {
        const n = out.split(ch).length - 1;
        spent += n * COST[ch]; seen[ch] = (seen[ch] ?? 0) + n;
        const max = [...CELLARS.foes.ground, ...CELLARS.foes.air].find((f) => f.ch === ch)?.max;
        if (max) expect(n).toBeLessThanOrEqual(max);
      }
      expect(spent).toBeLessThanOrEqual(9);
    }
    for (const ch of ['h', 'n', 'm', 'r', 'b', 'l']) expect(seen[ch], ch).toBeGreaterThan(0);
  });
});
