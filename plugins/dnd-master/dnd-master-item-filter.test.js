// plugins/dnd-master/dnd-master-item-filter.test.js
import { describe, it, expect } from 'vitest';
import { groupOf, groupCounts, filterItems, ITEM_GROUPS } from './dnd-master-item-filter.js';

const items = [
  { id: 'a', name: 'Longsword', type: 'weapon' }, { id: 'b', name: 'chain mail', type: 'armor' },
  { id: 'c', name: 'Potion of Healing', type: 'consumable' }, { id: 'd', name: 'Lantern of Small Hours', type: 'magic' },
  { id: 'e', name: 'Rope', type: 'misc' }, { id: 'f', name: 'Odd thing' },
];

describe('the item library\'s kinds', () => {
  it('the forge\'s misc and anything unknown are Other', () => {
    expect(groupOf(items[4])).toBe('other');
    expect(groupOf(items[5])).toBe('other');
    expect(ITEM_GROUPS.map(g => g[1])).toEqual(['Weapons', 'Armour', 'Consumables', 'Magic', 'Other']);
  });
  it('counts each kind', () => {
    expect(groupCounts(items)).toEqual({ all: 6, weapon: 1, armor: 1, consumable: 1, magic: 1, other: 2 });
  });
  it('lists one kind, or all, A–Z whatever the case', () => {
    expect(filterItems(items, 'all').map(i => i.name)).toEqual(['chain mail', 'Lantern of Small Hours', 'Longsword', 'Odd thing', 'Potion of Healing', 'Rope']);
    expect(filterItems(items, 'other').map(i => i.id)).toEqual(['f', 'e']);
  });
  it('a search narrows by name within the kind', () => {
    expect(filterItems(items, 'all', 'LAN').map(i => i.id)).toEqual(['d']);
    expect(filterItems(items, 'weapon', 'potion')).toEqual([]);
  });
});
