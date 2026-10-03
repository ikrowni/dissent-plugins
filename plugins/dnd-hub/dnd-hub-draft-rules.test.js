import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spellLimitL1, CANTRIPS_KNOWN, classSkillChoice, draftScores, validateDraft } from './dnd-hub-draft-rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(readFileSync(join(here, 'dnd-srd', f), 'utf8'));
const SRD = { races: load('races.json'), classes: load('classes.json'), backgrounds: load('backgrounds.json'),
  spells: load('spells.json'), equipment: load('equipment.json') };

const good = {
  race: 'dwarf', subrace: 'hill-dwarf', class: 'fighter', background: 'acolyte',
  abilityMethod: 'standard-array', baseScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  proficiencyChoices: ['Athletics', 'Perception'], extraSkills: [], halfElfBonus: [],
  spells: [], cantrips: [], name: 'Thora',
};

describe('creator rules', () => {
  it('spell limits at level 1', () => {
    expect(spellLimitL1('wizard', 10)).toBe(6);
    expect(spellLimitL1('cleric', 16)).toBe(4);
    expect(spellLimitL1('cleric', 8)).toBe(1);
    expect(spellLimitL1('paladin', 16)).toBe(0);
    expect(CANTRIPS_KNOWN.sorcerer).toBe(4);
  });
  it('class skill choice comes from the class data', () => {
    expect(classSkillChoice(SRD.classes, 'rogue').choose).toBe(4);
    expect(classSkillChoice(SRD.classes, 'fighter').from).toContain('Athletics');
  });
  it('final scores add race and subrace', () => {
    expect(draftScores(good, SRD.races)).toMatchObject({ con: 15, wis: 11 });
  });
  it('a complete draft has no problems', () => {
    expect(validateDraft(good, SRD)).toEqual([]);
  });
  it('names each missing choice with the creator step it belongs to', () => {
    const steps = d => validateDraft({ ...good, ...d }, SRD).map(p => p.step);
    expect(steps({ subrace: null })).toEqual([0]);
    expect(steps({ proficiencyChoices: ['Athletics'] })).toEqual([1]);
    expect(steps({ baseScores: { ...good.baseScores, str: 0 } })).toEqual([2]);
    expect(steps({ class: 'wizard', proficiencyChoices: ['Arcana', 'History'], spells: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toEqual([5]);
    expect(steps({ name: '  ' })).toEqual([6]);
  });
  it('half-elves need two more skills and two different +1s', () => {
    const he = { ...good, race: 'half-elf', subrace: null };
    expect(validateDraft(he, SRD).map(p => p.step)).toEqual([1, 2]);
    expect(validateDraft({ ...he, extraSkills: ['Stealth', 'Arcana'], halfElfBonus: ['str', 'con'] }, SRD)).toEqual([]);
  });
});
