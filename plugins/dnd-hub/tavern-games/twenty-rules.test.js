import { describe, it, expect } from 'vitest';
import { newDeck, sideDeck, sideCount, setResult, hostPlay, gameResult, sideValue } from './twenty-rules.js';
import { mulberry32 } from './kit.js';

const side = (table, o = {}) => ({ table, stood: false, bust: false, ...o });

describe('Twenty', () => {
  it('deals from forty cards, four of each value', () => {
    const d = newDeck(mulberry32(1));
    expect(d).toHaveLength(40);
    expect(d.filter(v => v === 7)).toHaveLength(4);
  });
  it('side decks hold signed cards and flips', () => {
    for (const c of sideDeck(50, mulberry32(3))) {
      if (c.flip) expect(c.flip).toBeGreaterThanOrEqual(1);
      else expect(Math.abs(c.v)).toBeGreaterThanOrEqual(1);
    }
    expect(sideValue({ flip: 3 }, -1)).toBe(-3);
    expect(sideCount(1)).toBe(6); expect(sideCount(0)).toBe(4); expect(sideCount(-1)).toBe(3);
  });
  it('a bust loses the set, nine cards win it, and both standing compares', () => {
    expect(setResult(side([10, 9], { bust: true }), side([5]))).toBe('host');
    expect(setResult(side([1, 1, 1, 1, 1, 1, 1, 1, 1]), side([5]))).toBe('hero');
    expect(setResult(side([10, 8], { stood: true }), side([10, 9]))).toBeNull();
    expect(setResult(side([10, 8], { stood: true }), side([10, 9], { stood: true }))).toBe('host');
    expect(setResult(side([10, 9], { stood: true }), side([10, 9], { stood: true }))).toBe('draw');
  });
  it('the host saves a bust with a minus card, takes an exact twenty, and stands on what beats yours', () => {
    expect(hostPlay(side([10, 9, 4]), side([]), [{ v: -3 }, { v: 2 }])).toMatchObject({ side: 0 });
    expect(hostPlay(side([10, 8]), side([]), [{ v: 2 }])).toEqual({ side: 0, sign: 1, t: 20, stand: true });
    expect(hostPlay(side([10, 9]), side([10, 8], { stood: true }), []).stand).toBe(true);
    expect(hostPlay(side([10, 5]), side([10, 8], { stood: true }), []).stand).toBe(false);
  });
  it('first to two sets wins; five sets at most', () => {
    expect(gameResult({ hero: 2, host: 1 }, 3)).toBe('hero');
    expect(gameResult({ hero: 1, host: 1 }, 2)).toBeNull();
    expect(gameResult({ hero: 1, host: 1 }, 5)).toBe('draw');
  });
});
