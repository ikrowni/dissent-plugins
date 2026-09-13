import { describe, it, expect } from 'vitest';
import { wilson } from './wilson.js';

describe('wilson', () => {
  it('is null with nothing to divide', () => {
    expect(wilson(0, 0)).toBeNull();
  });

  it('matches the textbook interval for 5 of 10', () => {
    const w = wilson(5, 10);
    expect(w.rate).toBe(0.5);
    expect(w.low).toBeCloseTo(0.2366, 4);
    expect(w.high).toBeCloseTo(0.7634, 4);
  });

  it('never leaves [0, 1] at the extremes', () => {
    const none = wilson(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.2775, 4);
    const all = wilson(10, 10);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.7225, 4);
  });
});
