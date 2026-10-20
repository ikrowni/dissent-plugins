import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SFX } from './ul-sound.js';

describe('sounds', () => {
  it('every sfx the game logic emits has a sound', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const names = new Set();
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/sfx\(S, '([a-zA-Z]+)'\)/g)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(15);
    for (const n of names) expect(SFX[n], `sound "${n}"`).toBeTypeOf('function');
  });
});
