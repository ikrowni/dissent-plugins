// plugins/dnd-hub/dnd-hub-forge-shape.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shapeSteps, swapScore, rollScores, toggleLimited, skillStep, spellStep, kitNames } from './dnd-hub-forge-shape.js';
import { quickBuild } from './dnd-hub-quick.js';
import { validateDraft } from './dnd-hub-draft-rules.js';

const load = f => JSON.parse(readFileSync(new URL(`./dnd-srd/${f}.json`, import.meta.url)));
const SRD = { races: load('races'), classes: load('classes'), backgrounds: load('backgrounds'), equipment: load('equipment'), spells: load('spells') };

describe('shapeSteps', () => {
  it('a fighter: abilities, skills, gear, name — no spells, no one-option choices', () => {
    expect(shapeSteps(quickBuild(SRD, 'dwarf', 'fighter'), SRD)).toEqual(['abilities', 'skills', 'gear', 'details']);
  });
  it('a wizard gets a spells step', () => {
    expect(shapeSteps(quickBuild(SRD, 'elf', 'wizard'), SRD)).toEqual(['abilities', 'skills', 'gear', 'spells', 'details']);
  });
  it('a paladin has no spells at level 1', () => {
    expect(shapeSteps(quickBuild(SRD, 'human', 'paladin'), SRD)).not.toContain('spells');
  });
  it('a race with two subraces, and two backgrounds, add their steps', () => {
    const srd = { ...SRD, races: SRD.races.map(r => r.id === 'dwarf' ? { ...r, subraces: [...r.subraces, { id: 'mountain-dwarf', name: 'Mountain Dwarf' }] } : r),
      backgrounds: [...SRD.backgrounds, { id: 'sage', name: 'Sage', starting_proficiencies: [] }] };
    expect(shapeSteps(quickBuild(srd, 'dwarf', 'fighter'), srd)).toEqual(['heritage', 'abilities', 'skills', 'background', 'gear', 'details']);
  });
});

describe('swapScore', () => {
  const b = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  it('giving an ability a score another has swaps the two', () => {
    expect(swapScore(b, 'cha', 15)).toEqual({ ...b, str: 8, cha: 15 });
  });
  it('the same score is no change', () => expect(swapScore(b, 'str', 15)).toEqual(b));
  it('never changes its input', () => { swapScore(b, 'cha', 15); expect(b.str).toBe(15); });
});

describe('rollScores', () => {
  it('rolls six 4d6-drop-lowest scores, the best on the class\'s main ability', () => {
    const seq = [0.99, 0.99, 0.99, 0.0]; let i = 0;
    const s = rollScores(['int', 'con', 'dex', 'wis', 'cha', 'str'], () => seq[i++ % 4]);
    expect(Object.values(s).every(v => v === 18)).toBe(true);
    const r = rollScores(['int', 'con', 'dex', 'wis', 'cha', 'str'], Math.random);
    expect(Object.values(r).every(v => v >= 3 && v <= 18)).toBe(true);
    expect(r.int).toBe(Math.max(...Object.values(r)));
  });
});

describe('toggleLimited', () => {
  it('adds up to the limit and removes', () => {
    expect(toggleLimited(['a'], 'b', 2)).toEqual(['a', 'b']);
    expect(toggleLimited(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggleLimited(['a', 'b'], 'a', 2)).toEqual(['b']);
  });
});

describe('skillStep', () => {
  it('the class list, the count, and the skills the hero already has from race and background', () => {
    const st = skillStep(quickBuild(SRD, 'elf', 'rogue'), SRD);
    expect(st.choose).toBe(4);
    expect(st.already).toEqual(expect.arrayContaining(['Insight', 'Religion', 'Perception']));
    expect(st.from).not.toContain('Perception'); // an elf already has it
  });
});

describe('spellStep', () => {
  it('a cleric: three cantrips, WIS-based prepared spells, from the cleric list', () => {
    const d = quickBuild(SRD, 'human', 'cleric');
    const st = spellStep(d, SRD);
    expect(st.cantrips).toBe(3);
    expect(st.spells).toBeGreaterThanOrEqual(1);
    expect(st.options.cantrips.length).toBeGreaterThan(3);
    expect(st.options.spells.every(s => s.level === 1)).toBe(true);
  });
});

describe('kitNames', () => {
  it('names the kit items', () => expect(kitNames(quickBuild(SRD, 'dwarf', 'fighter'), SRD)).toContain('Longsword'));
});

it('every guided hero from the suggestions is a valid hero', () => {
  for (const r of SRD.races) for (const c of SRD.classes) {
    const d = quickBuild(SRD, r.id, c.id); d.name = 'X';
    expect(validateDraft(d, SRD)).toEqual([]);
  }
});
