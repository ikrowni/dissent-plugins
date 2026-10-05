import { describe, it, expect } from 'vitest';
import * as AW from './arm-wrestle-rules.js';
import * as FF from './fillet-rules.js';
import { mulberry32 } from './kit.js';

describe('Arm Wrestle', () => {
  it('Strength widens the band, within limits', () => {
    expect(AW.bandWidth(1)).toBeGreaterThan(AW.bandWidth(0));
    expect(AW.bandWidth(-5)).toBeGreaterThanOrEqual(0.06);
    expect(AW.bandWidth(5)).toBeLessThanOrEqual(0.3);
  });
  it('judges a press against the band', () => {
    const band = { at: 0.5, width: 0.18 };
    expect(AW.press(0.5, band).kind).toBe('perfect');
    expect(AW.press(0.57, band).kind).toBe('hit');
    expect(AW.press(0.8, band)).toEqual({ kind: 'miss', push: AW.PUSH.miss });
  });
  it('moves the band somewhere new after a hit', () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 50; i++) expect(Math.abs(AW.nextBand({ at: 0.5, width: 0.2 }, rng).at - 0.5)).toBeGreaterThanOrEqual(0.2);
  });
  it('the marker stays on the bar', () => {
    for (let t = 0; t < 45; t += 0.37) { const m = AW.markerAt(t); expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThanOrEqual(1); }
  });
  it('a slammed hand ends the bout; time runs out to whoever is ahead', () => {
    expect(AW.boutResult(1, 3)).toBe('hero');
    expect(AW.boutResult(-1, 3)).toBe('host');
    expect(AW.boutResult(0.3, 3)).toBeNull();
    expect(AW.boutResult(0.3, AW.TIME_LIMIT)).toBe('hero');
    expect(AW.boutResult(0, AW.TIME_LIMIT)).toBe('draw');
  });
});

describe('Five-Finger Fillet', () => {
  it('goes back to the thumb gap between fingers', () => {
    expect(FF.PATTERN.filter((_, i) => i % 2 === 0).every(g => g === 0)).toBe(true);
    expect(FF.targetGap(FF.PATTERN.length + 3)).toBe(FF.PATTERN[3]);
  });
  it('speeds up, and a slowed count is slower', () => {
    expect(FF.bpm(40)).toBeGreaterThan(FF.bpm(0));
    expect(FF.bpm(40, true)).toBeLessThan(FF.bpm(40));
    const t = FF.beatTimes(30);
    expect(t[1] - t[0]).toBeGreaterThan(t[29] - t[28]);
  });
  it('retimes only the beats after the cheat', () => {
    const t = FF.beatTimes(20), r = FF.retime(t, 5);
    expect(r.slice(0, 6)).toEqual(t.slice(0, 6));
    expect(r[10] - r[9]).toBeGreaterThan(t[10] - t[9]);
  });
  it('judges a strike: wrong gap or off time is a miss', () => {
    const win = FF.windowFor(0);
    expect(FF.judge(2, 2, 0.01, win)).toBe('perfect');
    expect(FF.judge(2, 2, win * 0.8, win)).toBe('hit');
    expect(FF.judge(2, 3, 0, win)).toBe('miss');
    expect(FF.judge(2, 2, win * 1.2, win)).toBe('miss');
    expect(FF.windowFor(1)).toBeGreaterThan(FF.windowFor(0));
  });
  it('a host\'s run is in their skill\'s range, and more strikes win', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 30; i++) { const n = FF.hostStrikes('shark', rng); expect(n).toBeGreaterThanOrEqual(32); expect(n).toBeLessThanOrEqual(44); }
    expect(FF.result(30, 29)).toBe('hero');
    expect(FF.result(29, 29)).toBe('draw');
  });
});
