import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { subclassLevel, levelPlan, firstLevelPicks, INVOCATIONS } from './lk-levelling.js';

const read = f => JSON.parse(readFileSync(new URL(`./dnd-hub/dnd-srd/${f}.json`, import.meta.url)));
const srd = { classes: read('classes'), feats: read('feats'), spells: read('spells') };
const ctx = (over = {}) => ({ srd, library: { subclasses: {}, feats: {} }, featsAllowed: true, ...over });
const hero = (over = {}) => ({ class: 'fighter', level: 1, con: 14, str: 16, dex: 12, int: 10, wis: 10, cha: 8,
  hpMax: 12, hp: 12, spells: [], skills: { Athletics: 'proficient', Perception: 'proficient' }, features: [], ...over });
const kinds = p => p.steps.map(s => s.kind);

describe('subclassLevel', () => {
  it('follows the classes', () => {
    expect(['cleric', 'sorcerer', 'warlock'].map(subclassLevel)).toEqual([1, 1, 1]);
    expect(['druid', 'wizard'].map(subclassLevel)).toEqual([2, 2]);
    expect(['fighter', 'rogue', 'bard', 'barbarian', 'monk', 'paladin', 'ranger'].map(subclassLevel)).toEqual([3, 3, 3, 3, 3, 3, 3]);
  });
});

describe('levelPlan', () => {
  it('fighter 2 → 3 offers hit points, the subclass and the features', () => {
    const p = levelPlan(hero({ level: 2 }), ctx());
    expect(p.level).toBe(3);
    expect(kinds(p)).toEqual(['hp', 'subclass', 'features']);
    expect(p.steps[0]).toMatchObject({ die: 10, average: 6, conMod: 2 });
    expect(p.steps[1].options.map(o => o.id)).toEqual(['champion']);
  });
  it('fighter 3 → 4 and 5 → 6 offer an ability increase or a feat; feats off leaves only the increase', () => {
    expect(kinds(levelPlan(hero({ level: 3, subclass: 'champion' }), ctx()))).toContain('asi');
    expect(kinds(levelPlan(hero({ level: 5, subclass: 'champion' }), ctx()))).toContain('asi');
    const off = levelPlan(hero({ level: 3, subclass: 'champion' }), ctx({ featsAllowed: false }));
    expect(off.steps.find(s => s.kind === 'asi').feats).toEqual([]);
  });
  it('offers typed-in subclasses for the class and typed-in feats', () => {
    const library = { subclasses: { s1: { id: 's1', name: 'Rune Warden', classId: 'fighter', description: 'x' },
      s2: { id: 's2', name: 'Other', classId: 'wizard', description: 'y' } }, feats: { f1: { id: 'f1', name: 'Lucky Star', description: 'z' } } };
    const p = levelPlan(hero({ level: 2 }), ctx({ library }));
    expect(p.steps[1].options.map(o => o.id)).toEqual(['champion', 's1']);
    const a = levelPlan(hero({ level: 3, subclass: 'champion' }), ctx({ library })).steps.find(s => s.kind === 'asi');
    expect(a.feats.map(f => f.id)).toEqual(['grappler', 'f1']);
  });
  it('hides a feat whose prerequisite the hero does not meet', () => {
    const a = levelPlan(hero({ level: 3, subclass: 'champion', str: 10 }), ctx()).steps.find(s => s.kind === 'asi');
    expect(a.feats.map(f => f.id)).toEqual([]);
  });
  it('rogue 5 → 6 asks for expertise in two proficient skills', () => {
    const p = levelPlan(hero({ class: 'rogue', level: 5, subclass: 'thief' }), ctx());
    expect(p.steps.find(s => s.kind === 'expertise')).toMatchObject({ count: 2, options: ['Athletics', 'Perception'] });
  });
  it('warlock 1 → 2 asks for two invocations; 2 → 3 for a pact boon; prerequisites apply', () => {
    const w2 = levelPlan(hero({ class: 'warlock', level: 1, subclass: 'fiend', spells: ['eldritch-blast'] }), ctx());
    const inv = w2.steps.find(s => s.kind === 'invocations');
    expect(inv.count).toBe(2);
    expect(inv.options.map(o => o.id)).toContain('agonizing-blast');
    expect(inv.options.map(o => o.id)).not.toContain('thirsting-blade');
    const noBlast = levelPlan(hero({ class: 'warlock', level: 1, subclass: 'fiend', spells: [] }), ctx());
    expect(noBlast.steps.find(s => s.kind === 'invocations').options.map(o => o.id)).not.toContain('agonizing-blast');
    expect(kinds(levelPlan(hero({ class: 'warlock', level: 2, subclass: 'fiend', invocations: ['armor-of-shadows', 'devils-sight'] }), ctx())))
      .toContain('pactBoon');
  });
  it('sorcerer 2 → 3 picks two metamagic options', () => {
    expect(levelPlan(hero({ class: 'sorcerer', level: 2, subclass: 'draconic' }), ctx()).steps.find(s => s.kind === 'metamagic').count).toBe(2);
  });
  it('spells: wizard adds two to the spellbook; cleric only cantrips (at 4); sorcerer a new known spell', () => {
    const wiz = levelPlan(hero({ class: 'wizard', level: 1, spells: ['magic-missile'] }), ctx()).steps.find(s => s.kind === 'spells');
    expect(wiz).toMatchObject({ cantrips: 0, spells: 2, maxLevel: 1 });
    expect(wiz.options.spells.map(s => s.id)).not.toContain('magic-missile');
    expect(levelPlan(hero({ class: 'cleric', level: 2, subclass: 'life' }), ctx()).steps.find(s => s.kind === 'spells')).toBeUndefined();
    expect(levelPlan(hero({ class: 'cleric', level: 3, subclass: 'life' }), ctx()).steps.find(s => s.kind === 'spells'))
      .toMatchObject({ cantrips: 1, spells: 0 });
    expect(levelPlan(hero({ class: 'sorcerer', level: 2, subclass: 'draconic' }), ctx()).steps.find(s => s.kind === 'spells'))
      .toMatchObject({ spells: 1, maxLevel: 2 });
  });
  it('is null at level 20', () => {
    expect(levelPlan(hero({ level: 20 }), ctx())).toBe(null);
  });
});

describe('firstLevelPicks', () => {
  it('asks a cleric for a subclass, a fighter for a fighting style, a rogue for expertise; a wizard for nothing', () => {
    expect(kinds(firstLevelPicks(hero({ class: 'cleric' }), ctx()))).toEqual(['subclass']);
    expect(kinds(firstLevelPicks(hero({ class: 'fighter' }), ctx()))).toEqual(['fightingStyle']);
    expect(kinds(firstLevelPicks(hero({ class: 'rogue' }), ctx()))).toEqual(['expertise']);
    expect(kinds(firstLevelPicks(hero({ class: 'wizard' }), ctx()))).toEqual([]);
  });
});

describe('option lists', () => {
  it('every invocation has a name and a description', () => {
    for (const i of INVOCATIONS) expect(i.name && i.desc).toBeTruthy();
  });
});
