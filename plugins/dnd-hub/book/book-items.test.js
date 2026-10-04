// plugins/dnd-hub/book/book-items.test.js
import { describe, it, expect } from 'vitest';
import { findItems } from './book-items.js';
import { ITEMS } from './book-fixtures.js';

describe('findItems', () => {
  const [lantern, ring] = findItems(ITEMS);
  it('reads a magic item into the SRD shape, with an attunement line that wraps', () => {
    expect(lantern).toMatchObject({ id: 'lantern-of-small-hours', name: 'Lantern of Small Hours', category: 'Wondrous Item',
      rarity: 'Rare', requires_attunement: 'by a cleric or paladin', confidence: 'sure' });
    expect(lantern.desc).toBe('Wondrous item, rare (requires attunement by a cleric or paladin)\nWhile lit, this lantern shows the path home. It sheds bright light in a 20-foot radius.');
  });
  it('an item with no attunement', () => {
    expect(ring).toMatchObject({ name: 'Ring of Quiet Steps', category: 'Ring', rarity: 'Uncommon', requires_attunement: false,
      desc: 'Ring, uncommon\nYou make no sound when you walk.' });
    expect(ring.lines[1]).toBe(ITEMS.length - 2);
  });
});
