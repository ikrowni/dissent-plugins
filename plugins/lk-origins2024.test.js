import { describe, it, expect } from 'vitest';
import { SPECIES_2024, BACKGROUNDS_2024, ORIGIN_FEATS, bgIncreases, bgBonusScores, suggestBgBonus, suggestBackground, extraSkillsFor } from './lk-origins2024.js';

describe('2024 species (SRD 5.2.1)', () => {
  it('are the nine peoples, with Goliath and Orc and without half-elf and half-orc', () => {
    expect(SPECIES_2024.map(s => s.id)).toEqual(['dragonborn', 'dwarf', 'elf', 'gnome', 'goliath', 'halfling', 'human', 'orc', 'tiefling']);
  });
  it('give no ability increases', () => {
    for (const s of SPECIES_2024) {
      expect(s.ability_bonuses).toEqual([]);
      for (const sr of s.subraces) expect(sr.ability_bonuses).toEqual([]);
    }
  });
  it('carry the 2024 numbers', () => {
    const by = Object.fromEntries(SPECIES_2024.map(s => [s.id, s]));
    expect(by.dwarf).toMatchObject({ speed: 30, darkvision: 120 });
    expect(by.goliath.speed).toBe(35);
    expect(by.orc.darkvision).toBe(120);
    expect(by.elf.subraces.find(x => x.id === 'wood-elf').speed).toBe(35);
    expect(by.dragonborn.subraces).toHaveLength(10);
    expect(by.goliath.subraces).toHaveLength(6);
    for (const s of SPECIES_2024) for (const t of s.traits) expect(t.desc.length).toBeGreaterThan(10);
  });
});

describe('2024 backgrounds', () => {
  it('are Acolyte, Criminal, Sage and Soldier with three abilities, two skills and an origin feat each', () => {
    expect(BACKGROUNDS_2024.map(b => b.id)).toEqual(['acolyte', 'criminal', 'sage', 'soldier']);
    for (const b of BACKGROUNDS_2024) {
      expect(b.abilities).toHaveLength(3);
      expect(b.starting_proficiencies).toHaveLength(2);
      expect(ORIGIN_FEATS[b.feat]).toBeTruthy();
      expect(b.feature.name).toMatch(/\(origin feat\)$/);
    }
    expect(BACKGROUNDS_2024.find(b => b.id === 'soldier')).toMatchObject({ abilities: ['str', 'dex', 'con'], feat: 'savage-attacker' });
  });
});

describe('ability increases from the background', () => {
  const sage = BACKGROUNDS_2024.find(b => b.id === 'sage');
  it('+2 and +1 to two of its abilities, or +1 to all three', () => {
    expect(bgIncreases(sage, { plus2: 'int', plus1: 'wis' })).toEqual({ int: 2, wis: 1 });
    expect(bgIncreases(sage, { all: true })).toEqual({ con: 1, int: 1, wis: 1 });
  });
  it('nothing for abilities the background does not offer, or the same one twice', () => {
    expect(bgIncreases(sage, { plus2: 'str', plus1: 'int' })).toEqual({});
    expect(bgIncreases(sage, { plus2: 'int', plus1: 'int' })).toEqual({});
    expect(bgIncreases(null, { all: true })).toEqual({});
  });
  it('never above 20', () => expect(bgBonusScores({ int: 19, wis: 10 }, sage, { plus2: 'int', plus1: 'wis' })).toMatchObject({ int: 20, wis: 11 }));
  it('suggests what suits the class', () => {
    expect(suggestBgBonus(sage, ['int', 'con', 'dex'])).toEqual({ plus2: 'int', plus1: 'con' });
    expect(suggestBgBonus(sage, ['str', 'cha', 'int'])).toEqual({ all: true });
    expect(suggestBackground('fighter')).toBe('soldier');
    expect(suggestBackground('wizard')).toBe('sage');
    expect(suggestBackground('rogue')).toBe('criminal');
    expect(suggestBackground('cleric')).toBe('acolyte');
    // every class's background offers its main ability
    const MAIN = { barbarian: 'str', bard: 'cha', cleric: 'wis', druid: 'wis', fighter: 'str', monk: 'dex', paladin: 'str',
      ranger: 'dex', rogue: 'dex', sorcerer: 'cha', warlock: 'cha', wizard: 'int' };
    for (const [c, a] of Object.entries(MAIN)) expect(BACKGROUNDS_2024.find(b => b.id === suggestBackground(c)).abilities).toContain(a);
    expect(extraSkillsFor('human')).toBe(1);
  });
});

describe('Alert', () => {
  it('adds the proficiency bonus to initiative', async () => {
    const { alertBonus } = await import('./lk-origins2024.js');
    expect(alertBonus({ level: 1, features: ['Darkvision', 'Alert (origin feat)'] })).toBe(2);
    expect(alertBonus({ level: 5, features: [{ name: 'Alert (origin feat)' }] })).toBe(3);
    expect(alertBonus({ level: 5, features: ['Darkvision'] })).toBe(0);
  });
});
