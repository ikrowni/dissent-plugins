import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from './data.js';
import { THEMES, cardTerms, classifyDeck, buildTypeLabel, colorOf } from './classify.js';

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const cards = JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/cards.json`));
const run = JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/run-1773796874.json`));

describe('themes are real card text', () => {
  // 🔴 A theme word no card of that character uses can never match — a typo would silently make a
  // build type impossible. Every word must be found on at least one non-Basic card of its colour.
  it('every theme word appears on a card of that character', () => {
    for (const [color, themes] of Object.entries(THEMES)) {
      const own = cards.filter((c) => c.color === color && c.rarity !== 'Basic');
      for (const [tag, words] of Object.entries(themes)) {
        for (const w of words) {
          expect(own.some((c) => cardTerms(c).has(w)), `${color} ${tag}: "${w}"`).toBe(true);
        }
      }
    }
  });

  it('reads [gold] terms and keywords, not plain words', () => {
    const bash = cards.find((c) => c.id === 'BASH');
    expect([...cardTerms(bash)]).toEqual(['Vulnerable']);
  });

  it('maps a character id to its card colour', () => {
    expect(colorOf('CHARACTER.NECROBINDER')).toBe('necrobinder');
  });
});

describe('the REAL fixture decks', () => {
  it('player 1 is a Vulnerable build (5 of 20 counted cards)', async () => {
    const p = run.players[0];
    const got = await classifyDeck(p.deck, p.character, createData({ load }));
    expect(got).toEqual({ counted: 20, counts: { Strength: 2, Vulnerable: 5, Exhaust: 3 }, tags: ['Vulnerable'] });
    expect(buildTypeLabel(got.tags)).toBe('Vulnerable');
  });

  it('player 2 falls short of every threshold and is Mixed', async () => {
    const p = run.players[1];
    const got = await classifyDeck(p.deck, p.character, createData({ load }));
    expect(got).toEqual({ counted: 20, counts: { Strength: 2, Vulnerable: 4, Exhaust: 3 }, tags: [] });
    expect(buildTypeLabel(got.tags)).toBe('Mixed');
  });

  it('an unknown character or an empty deck is Mixed, never a throw', async () => {
    const data = createData({ load });
    expect((await classifyDeck([], 'CHARACTER.IRONCLAD', data)).tags).toEqual([]);
    expect((await classifyDeck(run.players[0].deck, 'CHARACTER.NOBODY', data)).tags).toEqual([]);
  });
});
