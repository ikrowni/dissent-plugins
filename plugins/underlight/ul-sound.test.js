import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SFX, soundLevel, setVolume, setAppSound, setMuted } from './ul-sound.js';

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

  it('follows your volume, the app\'s volume, deafen and mute', () => {
    setVolume(0.5); setAppSound({ volume: 0.8, deafened: false });
    expect(soundLevel()).toBeCloseTo(0.2);
    setAppSound({ volume: 0.8, deafened: true }); expect(soundLevel()).toBe(0);
    setAppSound({ volume: 1, deafened: false }); setMuted(true); expect(soundLevel()).toBe(0);
    setMuted(false); setVolume(1); expect(soundLevel()).toBe(0.5);
  });
});
