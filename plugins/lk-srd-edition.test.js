// plugins/lk-srd-edition.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { srdFile, withOtherEdition, browsable, loadSrd } from './lk-srd-edition.js';

const read = f => JSON.parse(readFileSync(new URL(`./dnd-hub/dnd-srd/${f}`, import.meta.url)));

describe('the SRD lists by rules edition', () => {
  it('names the file for each edition', () => {
    expect(srdFile('spells', '2014')).toBe('spells.json');
    expect(srdFile('spells', undefined)).toBe('spells.json');
    expect(srdFile('monsters', '2024')).toBe('monsters-2024.json');
  });
  it('lists only the edition; a lookup by id still finds the other edition\'s', () => {
    const list = withOtherEdition([{ id: 'goblin-warrior' }, { id: 'wolf' }], [{ id: 'goblin' }, { id: 'wolf', old: true }], '2024');
    expect(browsable(list).map(x => x.id)).toEqual(['goblin-warrior', 'wolf']);
    expect(list.find(x => x.id === 'goblin')).toMatchObject({ edition: '2014', otherEdition: true });
    expect(list.find(x => x.id === 'wolf')).toEqual({ id: 'wolf', edition: '2024' }); // the table's edition wins
  });
  it('loads each file once, and a missing one is an empty list', async () => {
    const asked = [];
    const fetchFn = async url => { asked.push(url); return url.endsWith('-2024.json') ? { ok: false } : { ok: true, json: async () => [{ id: 'a' }] }; };
    expect(await loadSrd('x/', 'feats', '2024', fetchFn)).toEqual([{ id: 'a', edition: '2014', otherEdition: true }]);
    await loadSrd('x/', 'feats', '2014', fetchFn);
    expect(asked.sort()).toEqual(['x/feats-2024.json', 'x/feats.json']);
  });
});

// The bundled 2024 data (scripts/build-srd-2024.mjs from SRD 5.2.1): the shapes the 2014 files have.
describe('the bundled 2024 data', () => {
  const spells = read('spells-2024.json'), monsters = read('monsters-2024.json'), items = read('magic-items-2024.json');
  it('is all there, with unique ids', () => {
    expect([spells.length, monsters.length, items.length]).toEqual([339, 331, 257]);
    for (const l of [spells, monsters, items]) expect(new Set(l.map(x => x.id)).size).toBe(l.length);
  });
  it('carries the 2014 fields', () => {
    const keys = f => Object.keys(read(f)[0]);
    for (const [a, b] of [['spells.json', spells], ['monsters.json', monsters], ['magic-items.json', items]]) {
      for (const k of keys(a)) expect(b.every(x => k in x), `${a}: ${k}`).toBe(true);
    }
  });
  it('reads the 2024 numbers (spot checks against the SRD 5.2.1)', () => {
    expect(monsters.find(m => m.id === 'adult-red-dragon')).toMatchObject({ ac: 19, hp: 256, cr: 17 });
    expect(monsters.find(m => m.id === 'goblin-warrior')).toMatchObject({ type: 'fey', cr: 0.25, bonus_actions: [{ name: 'Nimble Escape' }] });
    expect(monsters.find(m => m.id === 'death-dog')).toMatchObject({ damage_immunities: [], condition_immunities: expect.arrayContaining(['Blinded']) });
    expect(spells.find(s => s.id === 'hunters-mark')).toMatchObject({ name: "Hunter's Mark", level: 1, casting_time: 'Bonus Action', classes: ['Ranger'] });
    expect(items.find(i => i.id === 'amulet-of-proof-against-detection-and-location')).toMatchObject({ rarity: 'Uncommon', requires_attunement: true });
    expect(items.find(i => i.id === 'figurine-of-wondrous-power').desc).toContain('Silver Raven');
  });
  it('no summon without a challenge rating, and no curly apostrophes', () => {
    expect(monsters.filter(m => m.cr == null)).toEqual([]);
    expect(JSON.stringify([spells, monsters, items])).not.toMatch(/[‘’]/);
  });
});
