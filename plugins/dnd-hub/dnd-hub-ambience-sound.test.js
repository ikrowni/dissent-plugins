import { describe, it, expect } from 'vitest';
import { dripTimes, ambienceSamples } from './dnd-hub-ambience-sound.js';

describe('ambience', () => {
  it('drips: three, in order, away from the loop seam', () => {
    const t = dripTimes(6, 7);
    expect(t.length).toBe(3);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    for (const x of t) expect(x > 0.2 && x < 5.7).toBe(true);
  });
  it('the same seed gives the same sound', () => {
    expect(ambienceSamples(8000, 6, 7)).toEqual(ambienceSamples(8000, 6, 7));
  });
  it('audible, never clipping, and silent at the loop seam (no click)', () => {
    const s = ambienceSamples(8000, 6, 7);
    expect(s.length).toBe(48000);
    const rms = Math.sqrt(s.reduce((a, x) => a + x * x, 0) / s.length);
    expect(rms).toBeGreaterThan(0.005);
    expect(Math.max(...s.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(Math.abs(s[0])).toBeLessThan(0.01);
    expect(Math.abs(s[s.length - 1])).toBeLessThan(0.01);
  });
});
