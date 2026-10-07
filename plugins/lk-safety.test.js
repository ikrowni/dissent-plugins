import { describe, it, expect } from 'vitest';
import { TOPICS, cleanPicks, combine, X_COOLDOWN_MS } from './lk-safety.js';

describe('safety topics', () => {
  it('has a short list of common topics with unique ids', () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(TOPICS.map(t => t.id)).size).toBe(TOPICS.length);
  });
});

describe('a player\'s picks', () => {
  it('keeps known topics as line or veil, and up to five own words each', () => {
    const p = cleanPicks({ topics: { spiders: 'line', gore: 'veil', nope: 'line', fire: 'ok' },
      custom: [{ text: '  clowns ', kind: 'line' }, { text: '', kind: 'veil' }, ...Array.from({ length: 8 }, (_, i) => ({ text: 'x' + i, kind: 'veil' }))] });
    expect(p.topics).toEqual({ spiders: 'line', gore: 'veil' });
    expect(p.custom[0]).toEqual({ text: 'clowns', kind: 'line' });
    expect(p.custom).toHaveLength(5);
  });
  it('copes with nothing', () => expect(cleanPicks(null)).toEqual({ topics: {}, custom: [] }));
});

describe('the table\'s list', () => {
  it('joins everyone\'s picks without names; a line beats a veil', () => {
    const t = combine({
      u1: { topics: { spiders: 'veil', gore: 'veil' }, custom: [{ text: 'Clowns', kind: 'veil' }] },
      u2: { topics: { spiders: 'line' }, custom: [{ text: 'clowns', kind: 'line' }] },
    });
    expect(t.lines).toEqual(['Clowns', 'Spiders and insects']);
    expect(t.veils).toEqual(['Gore']);
    expect(JSON.stringify(t)).not.toMatch(/u1|u2/);
  });
  it('is empty with no answers', () => expect(combine({})).toEqual({ lines: [], veils: [] }));
  it('lets a player tap X at most every few seconds', () => expect(X_COOLDOWN_MS).toBeGreaterThanOrEqual(10000));
});
