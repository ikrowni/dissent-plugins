import { describe, it, expect } from 'vitest';
import { etOffsetHours, etDateOf, etWallTimeToUtc } from './eastern-time.js';

describe('eastern time', () => {
  it('is UTC-4 in October (EDT) and UTC-5 in December (EST)', () => {
    expect(etOffsetHours(Date.UTC(2026, 9, 1, 12))).toBe(-4);
    expect(etOffsetHours(Date.UTC(2026, 11, 1, 12))).toBe(-5);
  });

  it('switches at 2:00 local on the first Sunday of November 2026 (Nov 1)', () => {
    // 05:59 UTC Nov 1 = 01:59 EDT → still EDT; 06:00 UTC = 01:00 EST → EST
    expect(etOffsetHours(Date.UTC(2026, 10, 1, 5, 59))).toBe(-4);
    expect(etOffsetHours(Date.UTC(2026, 10, 1, 6, 0))).toBe(-5);
  });

  it('switches at 2:00 local on the second Sunday of March 2026 (Mar 8)', () => {
    expect(etOffsetHours(Date.UTC(2026, 2, 8, 6, 59))).toBe(-5);
    expect(etOffsetHours(Date.UTC(2026, 2, 8, 7, 0))).toBe(-4);
  });

  it('a Monday-night kickoff (00:15 UTC Tuesday) is still Monday in ET', () => {
    expect(etDateOf(Date.UTC(2026, 8, 29, 0, 15))).toEqual({ y: 2026, m: 9, d: 28 });
  });

  it('09:00 ET on a date converts to the right UTC instant on both sides of the change', () => {
    expect(etWallTimeToUtc({ y: 2026, m: 10, d: 27 }, 9)).toBe(Date.UTC(2026, 9, 27, 13));
    expect(etWallTimeToUtc({ y: 2026, m: 11, d: 3 }, 9)).toBe(Date.UTC(2026, 10, 3, 14));
  });
});
