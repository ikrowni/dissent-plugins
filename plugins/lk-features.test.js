import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { featureDesc } from './lk-features.js';
import { CLASS_FEATURES, FIGHTING_STYLES, PACT_BOONS } from './lk-levelling.js';

const json = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

describe('featureDesc — every feature a hero can get says what it does (owner, 2026-10-05)', () => {
  it('every racial trait in the SRD races', () => {
    const names = json('./dnd-hub/dnd-srd/races.json').flatMap(r => [...(r.traits || []),
      ...(r.subraces || []).flatMap(s => s.traits || s.racial_traits || [])]).map(t => t.name || t);
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter(n => !featureDesc(n))).toEqual([]);
  });
  it('every class feature the level-up hands out, and the level-1 ones the Forge gives', () => {
    const levelled = Object.values(CLASS_FEATURES).flatMap(byLevel => Object.values(byLevel).flatMap(l => l.split(', ')));
    const forge = readFileSync(new URL('./dnd-hub/dnd-hub-char.js', import.meta.url), 'utf8')
      .match(/const L1_FEATURES = \{([\s\S]*?)\};/)[1].match(/'[^']+'|"[^"]+"/g).map(s => s.slice(1, -1));
    expect(forge.length).toBeGreaterThan(20);
    expect([...levelled, ...forge].filter(n => !featureDesc(n))).toEqual([]);
  });
  it('the names the level-up writes: styles, subclasses, feats, pact boons, suffixes', () => {
    expect(featureDesc('Fighting Style: Archery')).toBe(FIGHTING_STYLES[0].desc);
    expect(featureDesc('Champion (subclass)')).toMatch(/critical/);
    expect(featureDesc('Feat: Grappler', { feats: [{ name: 'Grappler', desc: 'Hold on.' }] })).toBe('Hold on.');
    expect(featureDesc(PACT_BOONS[0].name)).toBe(PACT_BOONS[0].desc);
    expect(featureDesc('Extra Attack (2)')).toMatch(/attack twice/);
    expect(featureDesc('Wild Shape improvement')).toMatch(/beast/);
    expect(featureDesc('Shelter of the Faithful')).toMatch(/Temples/);
    expect(featureDesc('Made-up thing')).toBe('');
  });
});
