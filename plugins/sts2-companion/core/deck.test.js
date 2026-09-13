import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from './data.js';
import { resolveCards, groupDeck, energyCurve, costBucket, keywordCoverage, compareCoverage, characterColor } from './deck.js';

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const snapshot = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const data = createData({ load });
const card = async (id) => data.get('card', id);

describe('over the REAL current-run projection', () => {
  const deck = snapshot('current-run-after').players[0].deck;

  it('resolves every card', async () => {
    const entries = await resolveCards(data, deck);
    expect(entries).toHaveLength(11);
    expect(entries.filter((e) => e.card.unknown)).toEqual([]);
    expect(entries.map((e) => e.card.name)).toContain('Bash');
  });

  it('folds identical cards into counted rows, attacks first', async () => {
    const groups = groupDeck(await resolveCards(data, deck));
    expect(groups[0].type).toBe('Attack');
    expect(groups[0].items.find((r) => r.card.id === 'STRIKE_IRONCLAD').count).toBe(5);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(11);
  });

  it('the energy curve accounts for every card', async () => {
    const { buckets, unknown } = energyCurve(await resolveCards(data, deck));
    expect(unknown).toBe(0);
    expect(Object.fromEntries(buckets.map((b) => [b.label, b.n]))).toMatchObject({ 0: 0, 1: 10, 2: 1 });
  });

  it('keyword coverage counts Vulnerable (Bash) and Exhaust (Feed)', async () => {
    const cov = keywordCoverage(await resolveCards(data, deck));
    expect(cov.find((r) => r.term === 'Vulnerable')?.n).toBe(1);
    expect(cov.find((r) => r.term === 'Exhaust')?.n).toBe(1);
  });
});

describe('over the REAL finished-run projection', () => {
  const deck = snapshot('run-1773796874').players[0].deck;

  it('keeps upgraded copies apart from plain ones', async () => {
    const groups = groupDeck(await resolveCards(data, deck));
    const strikes = groups.flatMap((g) => g.items).filter((r) => r.card.id === 'STRIKE_IRONCLAD');
    expect(new Set(strikes.map((r) => r.upgrades)).size).toBe(strikes.length);
    expect(strikes.reduce((n, r) => n + r.count, 0)).toBe(deck.filter((c) => c.id === 'CARD.STRIKE_IRONCLAD').length);
  });
});

describe('a card missing from this data build', () => {
  // 🔴 Never a blank tile and never dropped: CARD.GRAPPLE is real, from the owner's v0.99.1 run.
  it('🔴 stays in the deck as unknown, and the curve says it was not counted', async () => {
    const entries = await resolveCards(data, [{ id: 'CARD.GRAPPLE', upgrades: 0 }, { id: 'CARD.BASH', upgrades: 1 }]);
    expect(entries[0].card).toMatchObject({ unknown: true, id: 'GRAPPLE' });
    expect(groupDeck(entries).map((g) => g.type)).toEqual(['Attack', 'Unknown']);
    expect(energyCurve(entries).unknown).toBe(1);
  });
});

describe('cost buckets from the real card data', () => {
  it('X, unplayable, and 3 or more', async () => {
    expect(costBucket(await card('CASCADE'))).toBe('X');
    expect(costBucket(await card('BURN'))).toBe('Unplayable');
    expect(costBucket(await card('BASH'))).toBe('2');
    const three = (await data.list('card')).find((c) => c.cost === 4);
    expect(costBucket(three)).toBe('3+');
  });
});

describe('compareCoverage and characterColor', () => {
  it('lists every term in either deck with both counts', () => {
    const rows = compareCoverage([{ term: 'Exhaust', n: 2 }], [{ term: 'Vulnerable', n: 3 }, { term: 'Exhaust', n: 1 }]);
    expect(rows).toEqual([{ term: 'Vulnerable', a: 0, b: 3 }, { term: 'Exhaust', a: 2, b: 1 }]);
  });
  it('maps a character id to the data card colour', () => {
    expect(characterColor('CHARACTER.IRONCLAD')).toBe('ironclad');
  });
});
