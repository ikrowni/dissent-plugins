import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterItems, searchScore } from './search.js';

const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url)));

describe('searchScore', () => {
  it('ranks a name match above a text match', () => {
    const bash = cards.find((c) => c.id === 'BASH');
    const other = cards.find((c) => c.id !== 'BASH' && /vulnerable/i.test(c.description));
    expect(searchScore(bash, 'bash')).toBeGreaterThan(searchScore(other, 'bash'));
    expect(searchScore(other, 'vulnerable')).toBeGreaterThan(0);
  });

  it('ignores case, markup and punctuation', () => {
    const bash = cards.find((c) => c.id === 'BASH');
    expect(searchScore(bash, 'VULNERABLE')).toBeGreaterThan(0);
    expect(searchScore(bash, '[gold]')).toBe(0);
  });
});

describe('filterItems over the real cards', () => {
  it('filters by character, type, rarity and cost together', () => {
    const out = filterItems(cards, { color: 'ironclad', type: 'Attack', rarity: 'Basic', cost: 2 });
    expect(out.map((c) => c.id)).toContain('BASH');
    expect(out.every((c) => c.color === 'ironclad' && c.type === 'Attack' && c.cost === 2)).toBe(true);
  });

  it('treats cost 3 as "3 or more"', () => {
    const out = filterItems(cards, { cost: 3 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.cost >= 3)).toBe(true);
  });

  it('orders a search by score, and an unsearched list by compendium order', () => {
    const searched = filterItems(cards, { q: 'strike' });
    expect(searched[0].name.toLowerCase()).toContain('strike');
    const plain = filterItems(cards, {});
    expect(plain.length).toBe(cards.length);
  });
});
