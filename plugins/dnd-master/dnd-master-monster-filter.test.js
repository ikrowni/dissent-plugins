import { describe, it, expect } from 'vitest';
import { crValue, typeOf, typesIn, applyFilter, DEFAULT_FILTER, filterBarHtml, isFiltered,
  getFilter, monsterFilterSet, monsterFilterClear, onFilterChange } from './dnd-master-monster-filter.js';

const POOL = [
  { id: 'goblin', name: 'Goblin', cr: 0.25, type: 'humanoid', hp: 7 },
  { id: 'zombie', name: 'Zombie', cr: 0.25, type: 'undead', hp: 22 },
  { id: 'lich', name: 'Lich', cr: 21, type: 'undead', hp: 135 },
  { id: 'rats', name: 'Swarm of Rats', cr: 0.25, type: 'swarm of Tiny beasts', hp: 24 },
  { id: 'boss', name: 'Goblin Boss', cr: '1', type: 'humanoid (goblinoid)', hp: 21, source: { title: 'My Book' } },
  { id: 'custom_x', name: 'Innkeeper', cr: '1/8', type: 'npc', hp: 4, _isCustom: true },
  { id: 'odd', name: 'Mystery', cr: null, type: 'aberration', hp: 10 },
];
const names = list => list.map(m => m.name);

describe('crValue', () => {
  it('reads numbers, fractions and numeric strings', () => {
    expect(crValue(0.25)).toBe(0.25);
    expect(crValue('1/4')).toBe(0.25);
    expect(crValue('1/8')).toBe(0.125);
    expect(crValue('3')).toBe(3);
    expect(crValue(0)).toBe(0);
  });
  it('is null for nothing it can read', () => {
    expect(crValue(null)).toBe(null);
    expect(crValue('')).toBe(null);
    expect(crValue('?')).toBe(null);
  });
});

describe('typeOf', () => {
  it('drops a subtype and groups swarms', () => {
    expect(typeOf({ type: 'humanoid (goblinoid)' })).toBe('humanoid');
    expect(typeOf({ type: 'swarm of Tiny beasts' })).toBe('swarm');
    expect(typeOf({ type: 'Undead' })).toBe('undead');
  });
  it('lists each type once, sorted', () => {
    expect(typesIn(POOL)).toEqual(['aberration', 'humanoid', 'npc', 'swarm', 'undead']);
  });
});

describe('applyFilter', () => {
  it('with no filter sorts A–Z and keeps everything', () => {
    expect(applyFilter(POOL, DEFAULT_FILTER)).toHaveLength(POOL.length);
    expect(names(applyFilter(POOL))[0]).toBe('Goblin');
  });
  it('searches by name', () => {
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, q: 'gob' }))).toEqual(['Goblin', 'Goblin Boss']);
  });
  it('filters by type, subtype or not', () => {
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, type: 'humanoid' }))).toEqual(['Goblin', 'Goblin Boss']);
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, type: 'undead' }))).toEqual(['Lich', 'Zombie']);
  });
  it('filters by a CR range, across number and fraction forms', () => {
    const f = { ...DEFAULT_FILTER, crMin: '0.125', crMax: '1' };
    expect(names(applyFilter(POOL, f))).toEqual(['Goblin', 'Goblin Boss', 'Innkeeper', 'Swarm of Rats', 'Zombie']);
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, crMin: '20' }))).toEqual(['Lich']);
  });
  it('drops an unknown CR only when a CR bound is set', () => {
    expect(names(applyFilter(POOL))).toContain('Mystery');
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, crMax: '30' }))).not.toContain('Mystery');
  });
  it('filters by source', () => {
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, source: 'custom' }))).toEqual(['Innkeeper']);
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, source: 'book' }))).toEqual(['Goblin Boss']);
  });
  it('sorts by CR and HP both ways, ties by name', () => {
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, sort: 'cr-desc' })).slice(0, 2)).toEqual(['Lich', 'Goblin Boss']);
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, sort: 'cr' })).slice(0, 2)).toEqual(['Mystery', 'Innkeeper']);
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, sort: 'hp' }))[0]).toBe('Innkeeper');
    expect(names(applyFilter(POOL, { ...DEFAULT_FILTER, sort: 'hp-desc' }))[0]).toBe('Lich');
  });
  it('does not reorder the list it was given', () => {
    const copy = POOL.slice();
    applyFilter(POOL, { ...DEFAULT_FILTER, sort: 'hp' });
    expect(POOL).toEqual(copy);
  });
});

describe('filter bar', () => {
  it('marks the chosen values and offers sources only when there is a choice', () => {
    const html = filterBarHtml('enc', { ...DEFAULT_FILTER, type: 'undead' }, ['humanoid', 'undead'], { hasCustom: true });
    expect(html).toContain('value="undead" selected');
    expect(html).toContain('My NPCs');
    expect(html).toContain('Clear filters');
    expect(filterBarHtml('mon', DEFAULT_FILTER, ['undead'])).not.toContain('All sources');
  });
  it('isFiltered ignores the search text', () => {
    expect(isFiltered({ ...DEFAULT_FILTER, q: 'x' })).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTER, sort: 'cr' })).toBe(true);
  });
  it('a change redraws its own tab; clearing keeps the search text', () => {
    let drawn = 0;
    onFilterChange('t1', () => drawn++);
    getFilter('t1').q = 'gob';
    monsterFilterSet('t1', 'type', 'undead');
    expect(getFilter('t1').type).toBe('undead');
    monsterFilterSet('t1', 'notAKey', 'x');
    expect(getFilter('t1').notAKey).toBeUndefined();
    monsterFilterClear('t1');
    expect(getFilter('t1')).toEqual({ ...DEFAULT_FILTER, q: 'gob' });
    expect(drawn).toBe(2);
    expect(getFilter('t2').type).toBe('');
  });
});
