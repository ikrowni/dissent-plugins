import { describe, it, expect } from 'vitest';
import { windSamples, dripSamples, nextDripDelay } from './dnd-hub-ambience-sound.js';

const rms = s => Math.sqrt(s.reduce((a, x) => a + x * x, 0) / s.length);
const peak = s => s.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('wind loop', () => {
  it('the same seed gives the same wind', () => {
    expect(windSamples(8000, 6, 7)).toEqual(windSamples(8000, 6, 7));
  });
  it('audible, never clipping, and silent at the loop seam (no click)', () => {
    const s = windSamples(8000, 6, 7);
    expect(s.length).toBe(48000);
    expect(rms(s)).toBeGreaterThan(0.005);
    expect(peak(s)).toBeLessThanOrEqual(1);
    expect(Math.abs(s[0])).toBeLessThan(0.01);
    expect(Math.abs(s[s.length - 1])).toBeLessThan(0.01);
  });
});

describe('drips', () => {
  it('each drip differs (owner: "a single drip over and over")', () => {
    const a = dripSamples(8000, 0.1), b = dripSamples(8000, 0.9);
    expect(a).not.toEqual(b);
    expect(Math.abs(rms(a) - rms(b)) + Math.abs(a.length - b.length)).toBeGreaterThan(0);
  });
  it('short, quiet, never clipping, and ends in silence', () => {
    for (const v of [0, 0.3, 0.7, 1]) {
      const d = dripSamples(8000, v);
      expect(d.length).toBeLessThan(8000 * 0.4);
      expect(peak(d)).toBeLessThanOrEqual(0.25);
      expect(rms(d)).toBeGreaterThan(0.001);
      expect(Math.abs(d[d.length - 1])).toBeLessThan(0.005);
    }
  });
  it('drips come at irregular gaps of 3 to 9 seconds', () => {
    const gaps = [0, 0.25, 0.5, 0.99].map(nextDripDelay);
    for (const g of gaps) expect(g >= 3 && g <= 9).toBe(true);
    expect(new Set(gaps).size).toBe(4);
  });
});
