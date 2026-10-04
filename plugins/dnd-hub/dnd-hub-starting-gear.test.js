import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLASS_GEAR, PICK_KINDS, PACK_CONTENTS, pickOptions, defaultGear, resolveGear, backgroundGear, applyGear,
  partLabel, pickKey, costCp, fmtCp, spentCp, buyItem, shopItems } from './dnd-hub-starting-gear.js';

const load = n => JSON.parse(readFileSync(new URL(`./dnd-srd/${n}.json`, import.meta.url), 'utf8'));
const SRD = { equipment: load('equipment'), backgrounds: load('backgrounds'), classes: load('classes') };
const EQ = SRD.equipment;
const ids = list => Object.fromEntries(list.map(x => [x.id, x.qty]));

describe('the data', () => {
  it('has every SRD class', () => {
    expect(Object.keys(CLASS_GEAR).sort()).toEqual(SRD.classes.map(c => c.id).sort());
  });
  it('names only items that exist', () => {
    const have = new Set(EQ.map(e => e.id));
    for (const [cls, g] of Object.entries(CLASS_GEAR)) {
      for (const p of [...g.choices.flat(2), ...g.fixed]) {
        if (p.pick) expect(PICK_KINDS[p.pick], `${cls} ${p.pick}`).toBeTruthy();
        else expect(have.has(p.id), `${cls} ${p.id}`).toBe(true);
      }
    }
    for (const k of Object.keys(PACK_CONTENTS)) expect(have.has(k), k).toBe(true);
  });
  it('every pick has something to pick from', () => {
    for (const k of Object.keys(PICK_KINDS)) expect(pickOptions(k, EQ).length, k).toBeGreaterThan(0);
  });
  it('sorts weapons the way the rules do', () => {
    expect(pickOptions('martial-melee', EQ)).toContain('greataxe');
    expect(pickOptions('martial-melee', EQ)).not.toContain('longbow');
    expect(pickOptions('simple-melee', EQ)).not.toContain('dart');
    expect(pickOptions('simple', EQ)).toContain('dart');
    expect(pickOptions('simple', EQ)).not.toContain('longsword');
  });
});

describe('resolveGear', () => {
  it('the default is the first option of each choice', () => {
    expect(ids(resolveGear('barbarian', defaultGear('barbarian'), EQ))).toEqual({ greataxe: 1, handaxe: 2, 'explorers-pack': 1, javelin: 4 });
  });
  it('follows the options picked and the items picked for "any …"', () => {
    const gear = { opts: [1, 1], picks: { [pickKey(0, 1, 0)]: 'battleaxe', [pickKey(1, 1, 0)]: 'spear' } };
    expect(ids(resolveGear('barbarian', gear, EQ))).toEqual({ battleaxe: 1, spear: 1, 'explorers-pack': 1, javelin: 4 });
  });
  it('an item that is not allowed for the pick falls back to the first allowed one', () => {
    const gear = { opts: [1, 0], picks: { [pickKey(0, 1, 0)]: 'plate-armor' } };
    const got = resolveGear('barbarian', gear, EQ).map(x => x.id);
    expect(got).not.toContain('plate-armor');
    expect(got).toContain(pickOptions('martial-melee', EQ)[0]);
  });
  it('two picks of one kind are chosen separately; repeats are merged', () => {
    const gear = { opts: [0, 1, 0, 0], picks: { [pickKey(1, 1, 0)]: 'longsword', [pickKey(1, 1, 0) + '.1']: 'longsword' } };
    expect(ids(resolveGear('fighter', gear, EQ)).longsword).toBe(2);
  });
  it('the fixed gear can hold a pick too (a holy symbol)', () => {
    const gear = { opts: [0, 0, 0, 0], picks: { [pickKey('f', 0, 1)]: 'reliquary' } };
    expect(ids(resolveGear('cleric', gear, EQ)).reliquary).toBe(1);
  });
  it('a bad option index is clamped, an unknown class gives nothing', () => {
    expect(resolveGear('wizard', { opts: [9, -3, 'x'] }, EQ).length).toBe(4);
    expect(resolveGear('witch', defaultGear('witch'), EQ)).toEqual([]);
  });
});

describe('backgroundGear and applyGear', () => {
  it('matches background gear to items by name, keeps the rest as names', () => {
    const r = backgroundGear({ starting_equipment: ['Clothes, common', 'Pouch', 'A prayer wheel'] }, EQ);
    expect(r.items.map(x => x.id)).toEqual(['clothes-common', 'pouch']);
    expect(r.named).toEqual(['A prayer wheel']);
  });
  it('writes ids once each, the counts, and the background gear', () => {
    const d = applyGear({ class: 'rogue', background: 'acolyte' }, SRD);
    expect(d.equipment).toContain('dagger');
    expect(d.equipment.filter(x => x === 'dagger')).toHaveLength(1);
    expect(d.equipmentQty).toMatchObject({ dagger: 2, arrow: 20 });
    expect(d.equipment).toContain('clothes-common');
  });
  it('starting gold clears the gear', () => {
    const d = applyGear({ class: 'rogue', useStartingGold: true, equipment: ['dagger'] }, SRD);
    expect(d.equipment).toEqual([]);
  });
});

describe('partLabel', () => {
  it('names items and picks', () => {
    expect(partLabel({ id: 'handaxe', qty: 2 }, EQ)).toBe('2 × Handaxe');
    expect(partLabel({ pick: 'martial-melee', count: 1 }, EQ)).toBe('any martial melee weapon');
    expect(partLabel({ pick: 'martial', count: 2 }, EQ)).toBe('2 × any martial weapon');
  });
});

describe('starting gold', () => {
  it('reads prices', () => {
    expect(costCp('10gp')).toBe(1000);
    expect(costCp('5 sp')).toBe(50);
    expect(costCp('1,500gp')).toBe(150000);
    expect(costCp('—')).toBe(null);
    expect(fmtCp(1050)).toBe('105 sp');
    expect(fmtCp(1000)).toBe('10 gp');
  });
  it('buys within the budget only, and never below none', () => {
    const d = {};
    expect(buyItem(d, 'explorers-pack', 1, 1500, EQ)).toBe(true);   // 10 gp of 15
    expect(buyItem(d, 'explorers-pack', 1, 1500, EQ)).toBe(false);  // 20 gp > 15
    expect(spentCp(d.buy, EQ)).toBe(1000);
    expect(buyItem(d, 'explorers-pack', -1, 1500, EQ)).toBe(true);
    expect(d.buy).toEqual({});
    expect(buyItem(d, 'explorers-pack', -1, 1500, EQ)).toBe(false);
  });
  it('what was bought becomes the gear', () => {
    const d = applyGear({ class: 'rogue', useStartingGold: true, buy: { dagger: 3, 'leather-armor': 1 } }, SRD);
    expect(d.equipment.sort()).toEqual(['dagger', 'leather-armor']);
    expect(d.equipmentQty).toEqual({ dagger: 3 });
  });
  it('the shop sells no horses and nothing without a price', () => {
    const shop = shopItems(EQ);
    expect(shop.some(e => e.category === 'Mounts and Vehicles')).toBe(false);
    expect(shop.every(e => costCp(e.cost) != null)).toBe(true);
    expect(shopItems(EQ, 'Armor').every(e => e.category === 'Armor')).toBe(true);
  });
});
