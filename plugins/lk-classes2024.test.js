import { describe, it, expect } from 'vitest';
import { features2024, CANTRIPS_2024, PREPARED_2024, INVOCATIONS_2024, EPIC_BOONS } from './lk-classes2024.js';
import { levelPlan, firstLevelPicks, applyLevel, checkChoice, heroRules, subclassLevel } from './lk-levelling.js';
import { maxSlotsFor } from './lk-rules5e.js';
import { featureDesc } from './lk-features.js';

const CLASSES = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
const ctx = { srd: { classes: CLASSES.map(id => ({ id, subclasses: [{ id: 'sub-' + id, name: 'Sub' }] })), feats: [], spells: [] }, library: {}, featsAllowed: true };
const hero = (cls, level, extra = {}) => ({ class: cls, level, rules: '2024', str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14,
  hpMax: 10, hp: 10, skills: { Arcana: 'proficient', Stealth: 'proficient', Perception: 'proficient', History: 'proficient' }, ...extra });
const kinds = plan => plan.steps.map(s => s.kind);

describe('which rules a hero levels by', () => {
  it('a hero made under 2024 carries it; everyone else is 2014', () => {
    expect(heroRules({ rules: '2024' })).toBe('2024');
    expect(heroRules({ origins: '2024' })).toBe('2024');
    expect(heroRules({})).toBe('2014');
  });
});

describe('2024 tables (SRD 5.2.1)', () => {
  it('cantrips: the base, +1 at 4 and 10', () => {
    expect(CANTRIPS_2024.cleric.slice(1, 11)).toEqual([3, 3, 3, 4, 4, 4, 4, 4, 4, 5]);
    expect(CANTRIPS_2024.sorcerer[20]).toBe(6);
  });
  it('prepared spells', () => {
    expect(PREPARED_2024.cleric[1]).toBe(4);
    expect(PREPARED_2024.paladin.slice(1, 6)).toEqual([2, 3, 4, 5, 6]);
    expect(PREPARED_2024.wizard[20]).toBe(25);
    expect(INVOCATIONS_2024[1]).toBe(1);
    expect(INVOCATIONS_2024[2]).toBe(3);
  });
  it('paladins and rangers have slots from level 1 in 2024 only', () => {
    expect(maxSlotsFor('paladin', 1, '2024')[1]).toBe(2);
    expect(maxSlotsFor('paladin', 1)[1]).toBe(0);
    expect(maxSlotsFor('ranger', 5, '2024').slice(1, 3)).toEqual([4, 2]);
  });
  it('a feature with a count in brackets stays one feature', () => {
    expect(features2024('fighter', 13)).toEqual(['Indomitable (two uses)', 'Studied Attacks']);
  });
  it('every 2024 feature has a description on the sheet', () => {
    for (const c of CLASSES) for (let l = 1; l <= 20; l++) for (const f of features2024(c, l)) {
      expect(featureDesc(f), `${c} ${l}: ${f}`).not.toBe('');
    }
  });
});

describe('levelling a 2024 hero', () => {
  it('every class takes its subclass at 3 (a 2014 cleric at 1)', () => {
    for (const c of CLASSES) {
      expect(kinds(levelPlan(hero(c, 2), ctx)), c).toContain('subclass');
      expect(kinds(levelPlan(hero(c, 1), ctx)), c).not.toContain('subclass');
    }
    expect(subclassLevel('cleric')).toBe(1);
    expect(subclassLevel('cleric', '2024')).toBe(3);
  });
  it('clerics and druids choose an Order at level 1; a 2014 cleric chooses a domain', () => {
    expect(kinds(firstLevelPicks(hero('cleric', 1), ctx))).toEqual(['order']);
    expect(kinds(firstLevelPicks(hero('druid', 1), ctx))).toEqual(['order']);
    expect(kinds(firstLevelPicks({ ...hero('cleric', 1), rules: undefined }, ctx))).toEqual(['subclass']);
  });
  it('a warlock takes an invocation at 1 (pacts are invocations) and two more at 2', () => {
    const l1 = firstLevelPicks(hero('warlock', 1), ctx).steps.find(s => s.kind === 'invocations');
    expect(l1.count).toBe(1);
    expect(l1.options.map(o => o.id)).toContain('pact-of-the-blade');
    expect(levelPlan(hero('warlock', 1), ctx).steps.find(s => s.kind === 'invocations').count).toBe(2);
    expect(kinds(levelPlan(hero('warlock', 2), ctx))).not.toContain('pactBoon');
  });
  it('ability increases at 4, 8, 12, 16 (fighter also 6 and 14, rogue 10); no 2014-style increase at 19', () => {
    expect(kinds(levelPlan(hero('fighter', 5), ctx))).toContain('asi');
    expect(kinds(levelPlan(hero('rogue', 9), ctx))).toContain('asi');
    expect(kinds(levelPlan(hero('wizard', 5), ctx))).not.toContain('asi');
  });
  it('level 19 is an Epic Boon: boons first, spell recall only for casters', () => {
    const w = levelPlan(hero('wizard', 18), ctx).steps.find(s => s.kind === 'asi');
    expect(w.epic).toBe(true);
    expect(w.feats.map(f => f.id)).toContain('boon-of-spell-recall');
    const b = levelPlan(hero('barbarian', 18), ctx).steps.find(s => s.kind === 'asi');
    expect(b.feats.map(f => f.id)).not.toContain('boon-of-spell-recall');
  });
  it('an Epic Boon raises the chosen ability past 20, up to 30', () => {
    const h = hero('fighter', 18, { str: 20 });
    const plan = levelPlan(h, ctx);
    const step = plan.steps.find(s => s.kind === 'asi');
    expect(checkChoice(step, { kind: 'feat', id: 'boon-of-combat-prowess' })).toMatch(/Choose which ability/);
    const out = applyLevel(h, plan, { hp: { mode: 'average' }, asi: { kind: 'feat', id: 'boon-of-combat-prowess', ability: 'str' } });
    expect(out.str).toBe(21);
    expect(out.features).toContain('Feat: Boon of Combat Prowess');
    expect(featureDesc('Feat: Boon of Combat Prowess')).toMatch(/missed attack/);
  });
  it('every caster prepares more spells as it levels; cantrips at 4', () => {
    const s = levelPlan(hero('cleric', 1), ctx).steps.find(x => x.kind === 'spells');
    expect(s).toMatchObject({ spells: 1, cantrips: 0 });
    expect(levelPlan(hero('cleric', 3), ctx).steps.find(x => x.kind === 'spells')).toMatchObject({ cantrips: 1 });
    expect(levelPlan(hero('paladin', 1), ctx).steps.find(x => x.kind === 'spells')).toMatchObject({ spells: 1 });
  });
  it('sorcerers take two metamagic options at 2', () => {
    expect(levelPlan(hero('sorcerer', 1), ctx).steps.find(s => s.kind === 'metamagic').count).toBe(2);
  });
  it('a 2014 hero still levels by the 2014 tables', () => {
    const p = levelPlan({ class: 'cleric', level: 1, con: 10, skills: {} }, ctx);
    expect(p.steps.find(s => s.kind === 'features').list).toContain('Channel Divinity (1/rest)');
  });
  it('the boons are the SRD\'s seven', () => expect(EPIC_BOONS).toHaveLength(7));
});
