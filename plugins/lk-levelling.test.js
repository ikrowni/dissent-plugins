import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { subclassLevel, levelPlan, firstLevelPicks, INVOCATIONS } from './lk-levelling.js';
import { checkChoice, applyLevel } from './lk-levelling.js';
import { applyFirstPicks } from './lk-levelling.js';
import { xpLevel, allowedLevel, xpShare, XP_FOR_LEVEL } from './lk-levelling.js';

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


describe('checkChoice', () => {
  it('requires every step answered correctly', () => {
    expect(checkChoice({ kind: 'hp', die: 10 }, { mode: 'roll', roll: 11 })).toMatch(/1 and 10/);
    expect(checkChoice({ kind: 'hp', die: 10 }, { mode: 'average' })).toBe(null);
    expect(checkChoice({ kind: 'subclass', options: [{ id: 'champion' }] }, 'nope')).toMatch(/Choose/);
    expect(checkChoice({ kind: 'expertise', count: 2, options: ['A', 'B', 'C'] }, ['A'])).toMatch(/2/);
    expect(checkChoice({ kind: 'asi', feats: [] }, { kind: 'asi', plus: { str: 1 } })).toMatch(/two points/);
    expect(checkChoice({ kind: 'asi', feats: [] }, { kind: 'asi', plus: { str: 2 } })).toBe(null);
    expect(checkChoice({ kind: 'asi', feats: [] }, { kind: 'asi', plus: { str: 3 } })).toMatch(/two points/);
    expect(checkChoice({ kind: 'spells', cantrips: 1, spells: 0, options: { cantrips: [{ id: 'light' }], spells: [] } },
      { cantrips: [], spells: [] })).toMatch(/cantrip/);
    expect(checkChoice({ kind: 'features', list: [] }, undefined)).toBe(null);
  });
});

describe('applyLevel', () => {
  const plan = levelPlan(hero({ level: 3, subclass: 'champion', hp: 20, hpMax: 30 }), ctx());
  it('average hit points, the level, the proficiency bonus and the features', () => {
    const h = applyLevel(hero({ level: 3, subclass: 'champion', hp: 20, hpMax: 30 }), plan, { hp: { mode: 'average' }, asi: { kind: 'asi', plus: { str: 2 } } });
    expect(h).toMatchObject({ level: 4, hpMax: 30 + 6 + 2, hp: 20 + 6 + 2, str: 18, proficiencyBonus: 2 });
  });
  it('a CON increase raises hit points for every level; scores stop at 20', () => {
    const h = applyLevel(hero({ level: 3, subclass: 'champion', con: 15, str: 20, hpMax: 30, hp: 30 }), plan,
      { hp: { mode: 'roll', roll: 1 }, asi: { kind: 'asi', plus: { con: 1, str: 1 } } });
    expect(h.str).toBe(20);
    expect(h.con).toBe(16);
    expect(h.hpMax).toBe(30 + Math.max(1, 1 + 2) + 4); // +1 CON mod × level 4
  });
  it('at least 1 hit point a level, hill dwarves +1', () => {
    const weak = hero({ level: 1, con: 3, hpMax: 5, hp: 5 });
    const p = levelPlan(weak, ctx());
    expect(applyLevel(weak, p, { hp: { mode: 'roll', roll: 1 } }).hpMax).toBe(6);
    const dwarf = hero({ level: 1, subrace: 'hill-dwarf', hpMax: 13, hp: 13 });
    expect(applyLevel(dwarf, levelPlan(dwarf, ctx()), { hp: { mode: 'average' } }).hpMax).toBe(13 + 6 + 2 + 1);
  });
  it('records subclass, style, expertise, pact, invocations, metamagic, feat and spells', () => {
    const f2 = hero({ level: 2 });
    expect(applyLevel(f2, levelPlan(f2, ctx()), { hp: { mode: 'average' }, subclass: 'champion' }).subclass).toBe('champion');
    const r5 = hero({ class: 'rogue', level: 5, subclass: 'thief' });
    expect(applyLevel(r5, levelPlan(r5, ctx()), { hp: { mode: 'average' }, expertise: ['Athletics', 'Perception'] }).skills)
      .toEqual({ Athletics: 'expertise', Perception: 'expertise' });
    const w = hero({ class: 'wizard', level: 1, spells: [] });
    const ww = applyLevel(w, levelPlan(w, ctx()), { hp: { mode: 'average' }, subclass: 'evocation', spells: { cantrips: [], spells: ['shield', 'sleep'] } });
    expect(ww.spells).toEqual(['shield', 'sleep']);
    expect(ww.spellSlots[1]).toEqual([3, 3]);
    const f3 = hero({ level: 3, subclass: 'champion' });
    const ft = applyLevel(f3, levelPlan(f3, ctx()), { hp: { mode: 'average' }, asi: { kind: 'feat', id: 'grappler' } });
    expect(ft.feats).toEqual(['grappler']);
    expect(ft.features).toContain('Feat: Grappler');
  });
  it('refuses incomplete choices', () => {
    const f2 = hero({ level: 2 });
    expect(() => applyLevel(f2, levelPlan(f2, ctx()), { hp: { mode: 'average' } })).toThrow(/subclass/i);
  });
});

describe('applyFirstPicks', () => {
it('applyFirstPicks records a cleric subclass and a rogue expertise', () => {
  const c = hero({ class: 'cleric' });
  expect(applyFirstPicks(c, firstLevelPicks(c, ctx()), { subclass: 'life' }).subclass).toBe('life');
  const r = hero({ class: 'rogue' });
  expect(applyFirstPicks(r, firstLevelPicks(r, ctx()), { expertise: ['Athletics', 'Perception'] }).skills.Athletics).toBe('expertise');
});
});

describe('authority', () => {
  it('xpLevel follows the thresholds', () => {
    expect([0, 299, 300, 899, 900, 355000].map(xpLevel)).toEqual([1, 1, 2, 2, 3, 20]);
    expect(XP_FOR_LEVEL[4]).toBe(2700);
  });
  it('milestone: the granted level, never below the starting level or the hero\'s own', () => {
    const camp = { startingLevel: 1, levels: { u: 3 } };
    expect(allowedLevel(camp, 'u', { level: 2 }, false)).toBe(3);
    expect(allowedLevel({ startingLevel: 3 }, 'u', { level: 1 }, false)).toBe(3);
    expect(allowedLevel({}, 'u', { level: 5 }, false)).toBe(5);
  });
  it('experience: the campaign\'s XP, falling back to the hero\'s', () => {
    expect(allowedLevel({ xp: { u: 900 } }, 'u', { level: 1, xp: 0 }, true)).toBe(3);
    expect(allowedLevel({}, 'u', { level: 1, xp: 300 }, true)).toBe(2);
  });
  it('xpShare splits evenly, rounding down', () => {
    expect(xpShare(100, ['a', 'b', 'c'])).toEqual({ a: 33, b: 33, c: 33 });
    expect(xpShare(100, [])).toEqual({});
  });
});
