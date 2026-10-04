import { describe, it, expect } from 'vitest';
import {
  abilityMod, profBonus, weaponKind, setHp, parseHpEntry, maxSlotsFor, normalizeSlots, withSlotsForLevel, isAsiLevel, hitDieFor,
  applyDamage, applyHealing, rollDeathSave, markDeathSave, attackOutcome, critDamageExpr,
  encounterMultiplier, adjustedEncounterXp, shortRestSpend, longRest, characterSummary,
  spellSaveDC, spellAttackBonus, conHpBonusOnIncrease, saveForHalf,
} from './lk-rules5e.js';

describe('basics', () => {
  it('ability modifiers', () => {
    expect([1, 8, 9, 10, 11, 12, 20].map(abilityMod)).toEqual([-5, -1, -1, 0, 0, 1, 5]);
  });
  it('proficiency bonus by level', () => {
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(profBonus)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
  it('ASI levels: fighter extra at 6 and 14, rogue at 10, nobody at 18', () => {
    expect(isAsiLevel('fighter', 6)).toBe(true);
    expect(isAsiLevel('fighter', 14)).toBe(true);
    expect(isAsiLevel('rogue', 10)).toBe(true);
    expect(isAsiLevel('rogue', 18)).toBe(false);
    expect(isAsiLevel('wizard', 6)).toBe(false);
    expect(isAsiLevel('wizard', 19)).toBe(true);
  });
  it('hit dice', () => {
    expect(hitDieFor('barbarian')).toBe(12);
    expect(hitDieFor('Wizard')).toBe(6);
    expect(hitDieFor('rogue')).toBe(8);
  });
});

describe('spell slots: index = slot level, [current, max]', () => {
  const maxes = (cls, lvl) => maxSlotsFor(cls, lvl);
  it('non-casters have none', () => {
    expect(maxes('fighter', 5).every(n => n === 0)).toBe(true);
    expect(maxes('rogue', 1).every(n => n === 0)).toBe(true);
  });
  it('full casters follow the table (wizard 1, 5, 17)', () => {
    expect(maxes('wizard', 1).slice(1, 3)).toEqual([2, 0]);
    expect(maxes('wizard', 5).slice(1, 4)).toEqual([4, 3, 2]);
    expect(maxes('wizard', 17)[9]).toBe(1);
  });
  it('half casters: nothing at 1, then ceil(level/2) of the full table', () => {
    expect(maxes('paladin', 1).every(n => n === 0)).toBe(true);
    expect(maxes('paladin', 2)[1]).toBe(2);
    expect(maxes('paladin', 3)[1]).toBe(3);
    expect(maxes('ranger', 5).slice(1, 3)).toEqual([4, 2]);
  });
  it('warlock pact magic: all slots one level', () => {
    expect(maxes('warlock', 1)[1]).toBe(1);
    expect(maxes('warlock', 2)[1]).toBe(2);
    expect(maxes('warlock', 3)[2]).toBe(2);
    expect(maxes('warlock', 3)[1]).toBe(0);
    expect(maxes('warlock', 11)[5]).toBe(3);
    expect(maxes('warlock', 17)[5]).toBe(4);
  });
  it('normalizes the creator shape (9 entries, index = level)', () => {
    const s = normalizeSlots([[0, 0], [2, 2], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
    expect(s).toHaveLength(10);
    expect(s[1]).toEqual([2, 2]);
  });
  it('normalizes the old level-up shape (9 entries, index 0 = 1st level)', () => {
    const s = normalizeSlots([[3, 4], [1, 3], [2, 2], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
    expect(s[1]).toEqual([3, 4]);
    expect(s[2]).toEqual([1, 3]);
    expect(s[3]).toEqual([2, 2]);
    expect(s[0]).toEqual([0, 0]);
  });
  it('normalizes the DM editor shape (used counts + spellSlotsMax)', () => {
    const s = normalizeSlots({ 1: 1, 2: 0 }, { 1: 4, 2: 3 });
    expect(s[1]).toEqual([3, 4]);
    expect(s[2]).toEqual([3, 3]);
  });
  it('withSlotsForLevel keeps spent slots spent but makes new ones usable', () => {
    const before = normalizeSlots([[0, 0], [1, 4], [0, 2], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
    const after = withSlotsForLevel(before, 'wizard', 4); // 4th level: 4/3
    expect(after[1]).toEqual([1, 4]);
    expect(after[2]).toEqual([1, 3]); // grew by one: the new slot is ready
    const lvl5 = withSlotsForLevel(after, 'wizard', 5);
    expect(lvl5[3]).toEqual([2, 2]); // a brand-new slot level arrives full
  });
});

describe('damage, 0 HP and death', () => {
  const pc = (o = {}) => ({ hp: 10, hpMax: 12, hpTemp: 0, conditions: [], deathSaves: { successes: 0, failures: 0 }, ...o });
  it('temporary HP soaks damage first', () => {
    const r = applyDamage(pc({ hpTemp: 5 }), 7);
    expect(r.hpTemp).toBe(0);
    expect(r.hp).toBe(8);
  });
  it('dropping to 0 knocks you unconscious', () => {
    const r = applyDamage(pc(), 10);
    expect(r.hp).toBe(0);
    expect(r.conditions).toContain('Unconscious');
    expect(r.dead).toBeFalsy();
  });
  it('massive damage (leftover ≥ max HP) kills outright', () => {
    const r = applyDamage(pc({ hp: 6 }), 6 + 12);
    expect(r.dead).toBe(true);
  });
  it('damage at 0 HP is a failed death save; a crit is two', () => {
    const down = applyDamage(pc(), 10);
    expect(applyDamage(down, 3).deathSaves.failures).toBe(1);
    expect(applyDamage(down, 3, { crit: true }).deathSaves.failures).toBe(2);
  });
  it('healing from 0 wakes you and clears death saves', () => {
    const down = { ...applyDamage(pc(), 10), deathSaves: { successes: 2, failures: 1 } };
    const up = applyHealing(down, 4);
    expect(up.hp).toBe(4);
    expect(up.conditions).not.toContain('Unconscious');
    expect(up.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
  it('healing never raises the dead and never passes max', () => {
    expect(applyHealing(pc({ hp: 0, dead: true }), 5).hp).toBe(0);
    expect(applyHealing(pc(), 50).hp).toBe(12);
  });
  it('death saves: 3 successes = stable at 0 HP, still unconscious', () => {
    let s = applyDamage(pc(), 10);
    for (let i = 0; i < 3; i++) s = rollDeathSave(s, 12);
    expect(s.stable).toBe(true);
    expect(s.hp).toBe(0);
    expect(s.conditions).toContain('Unconscious');
  });
  it('death saves: 3 failures = dead; a natural 1 counts twice', () => {
    let s = applyDamage(pc(), 10);
    s = rollDeathSave(s, 1);
    expect(s.deathSaves.failures).toBe(2);
    s = rollDeathSave(s, 5);
    expect(s.dead).toBe(true);
  });
  it('death saves: a natural 20 brings you back with 1 HP', () => {
    const s = rollDeathSave(applyDamage(pc(), 10), 20);
    expect(s.hp).toBe(1);
    expect(s.conditions).not.toContain('Unconscious');
  });
  it('manual death-save pips use the same outcome rules', () => {
    let s = applyDamage(pc(), 10);
    s = markDeathSave(s, 'success', 3);
    expect(s.stable).toBe(true);
    s = markDeathSave(applyDamage(pc(), 10), 'failure', 3);
    expect(s.dead).toBe(true);
  });
});

describe('attacks', () => {
  it('a natural 20 always hits and crits; a natural 1 always misses', () => {
    expect(attackOutcome(20, 21, 30)).toEqual({ hit: true, crit: true });
    expect(attackOutcome(1, 25, 10)).toEqual({ hit: false, crit: false });
    expect(attackOutcome(15, 20, 20)).toEqual({ hit: true, crit: false });
    expect(attackOutcome(14, 19, 20)).toEqual({ hit: false, crit: false });
  });
  it('a crit doubles the dice, not the modifier', () => {
    expect(critDamageExpr('1d6+2')).toBe('2d6+2');
    expect(critDamageExpr('2d8 + 3')).toBe('4d8+3');
    expect(critDamageExpr('1d12')).toBe('2d12');
  });
});

describe('encounters', () => {
  it('multiplier by number of monsters, shifted for small and large parties', () => {
    expect(encounterMultiplier(1, 4)).toBe(1);
    expect(encounterMultiplier(2, 4)).toBe(1.5);
    expect(encounterMultiplier(4, 4)).toBe(2);
    expect(encounterMultiplier(1, 2)).toBe(1.5);
    expect(encounterMultiplier(4, 6)).toBe(1.5);
  });
  it('four goblins against four level-1 heroes is 400 adjusted XP', () => {
    expect(adjustedEncounterXp([{ xp: 50, count: 4 }], 4)).toBe(400);
  });
});

describe('rests', () => {
  const ch = (o = {}) => ({ class: 'fighter', level: 4, con: 14, hp: 10, hpMax: 40, hitDiceRemaining: 4, exhaustion: 2,
    spellSlots: null, deathSaves: { successes: 1, failures: 1 }, concentration: { spellName: 'x' }, ...o });
  it('short rest spends the chosen Hit Dice: roll + CON each', () => {
    const r = shortRestSpend(ch(), 2, () => 6);
    expect(r.hp).toBe(10 + 2 * (6 + 2));
    expect(r.hitDiceRemaining).toBe(2);
  });
  it('short rest cannot spend dice you do not have, and never passes max', () => {
    expect(shortRestSpend(ch({ hitDiceRemaining: 1 }), 3, () => 10).hitDiceRemaining).toBe(0);
    expect(shortRestSpend(ch({ hp: 39 }), 1, () => 10).hp).toBe(40);
  });
  it('long rest: full HP, half the Hit Dice back, one less exhaustion, concentration ends', () => {
    const r = longRest(ch({ hitDiceRemaining: 0 }));
    expect(r.hp).toBe(40);
    expect(r.hitDiceRemaining).toBe(2);
    expect(r.exhaustion).toBe(1);
    expect(r.concentration).toBeNull();
    expect(r.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
  it('long rest refills spell slots; warlock slots also come back on a short rest', () => {
    const wiz = longRest(ch({ class: 'wizard', spellSlots: normalizeSlots([[0, 0], [0, 4], [1, 3]]) }));
    expect(wiz.spellSlots[1]).toEqual([4, 4]);
    const wl = shortRestSpend(ch({ class: 'warlock', level: 3, spellSlots: withSlotsForLevel(null, 'warlock', 3).map(([, m]) => [0, m]) }), 0, () => 1);
    expect(wl.spellSlots[2]).toEqual([2, 2]);
  });
});

describe('derived numbers', () => {
  it('spell save DC and attack bonus', () => {
    const c = { class: 'wizard', level: 5, int: 16, spellcastingAbility: 'int' };
    expect(spellSaveDC(c)).toBe(8 + 3 + 3);
    expect(spellAttackBonus(c)).toBe(6);
  });
  it('a CON increase raises max HP by one per level when the modifier goes up', () => {
    expect(conHpBonusOnIncrease(13, 14, 5)).toBe(5);
    expect(conHpBonusOnIncrease(14, 15, 5)).toBe(0);
  });
  it('the party summary carries concentration and death saves', () => {
    const s = characterSummary({ name: 'Ael', hp: 0, hpMax: 9, concentration: { spellName: 'Bless' },
      deathSaves: { successes: 1, failures: 2 } });
    expect(s.concentration).toBe('Bless');
    expect(s.deathSaves).toEqual({ successes: 1, failures: 2 });
    const fresh = characterSummary({ name: 'Bo' });
    expect(fresh.concentration).toBe(null);
    expect(fresh.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
  it('the party summary carries what the DM tools need', () => {
    const s = characterSummary({ name: 'Bree', race: 'halfling', class: 'rogue', level: 3, hp: 7, hpMax: 21, hpTemp: 2,
      ac: 14, dex: 16, wis: 12, skills: { Perception: 'proficient' }, conditions: ['Prone'], portraitUrl: 'p' }, { ac: 15 });
    expect(s).toMatchObject({ name: 'Bree', level: 3, hp: 7, hpMax: 21, hpTemp: 2, ac: 15, dex: 16, passivePerception: 10 + 1 + 2,
      conditions: ['Prone'], portraitUrl: 'p' });
  });
});

import { armorClass, weaponProfile, skillProficiencies, RACE_SKILLS } from './lk-rules5e.js';

describe('armour class', () => {
  const base = { class: 'fighter', dex: 14, con: 14, wis: 10 };
  it('no armour: 10 + DEX', () => expect(armorClass(base, [])).toBe(12));
  it('light armour adds all of DEX', () => expect(armorClass({ ...base, dex: 18 }, ['studded-leather-armor'])).toBe(16));
  it('medium armour caps DEX at +2', () => expect(armorClass({ ...base, dex: 18 }, ['scale-mail'])).toBe(16));
  it('heavy armour ignores DEX; a shield adds 2', () => expect(armorClass({ ...base, dex: 8 }, ['chain-mail', 'shield'])).toBe(18));
  it('barbarian and monk Unarmored Defense', () => {
    expect(armorClass({ class: 'barbarian', dex: 14, con: 16 }, [])).toBe(15);
    expect(armorClass({ class: 'barbarian', dex: 14, con: 16 }, ['shield'])).toBe(17);
    expect(armorClass({ class: 'monk', dex: 16, wis: 14 }, [])).toBe(15);
    expect(armorClass({ class: 'monk', dex: 16, wis: 14 }, ['shield'])).toBe(15); // shield: no WIS, but +2
  });
});

describe('weapons from the character', () => {
  const ftr = { class: 'fighter', level: 1, str: 16, dex: 12 };
  it('a longsword uses STR + proficiency', () => {
    expect(weaponProfile({ id: 'longsword' }, ftr)).toMatchObject({ toHit: 5, damage: '1d8+3', damageType: 'slashing' });
  });
  it('finesse takes the better of STR and DEX; ranged uses DEX', () => {
    const rog = { class: 'rogue', level: 1, str: 8, dex: 16 };
    expect(weaponProfile({ id: 'rapier' }, rog)).toMatchObject({ toHit: 5, damage: '1d8+3' });
    expect(weaponProfile({ id: 'shortbow' }, rog)).toMatchObject({ toHit: 5, damage: '1d6+3', rangeFt: 80 });
  });
  it('no proficiency bonus with a weapon the class cannot use', () => {
    const wiz = { class: 'wizard', level: 1, str: 10, dex: 14 };
    expect(weaponProfile({ id: 'longsword' }, wiz).toHit).toBe(0);
    expect(weaponProfile({ id: 'dagger' }, wiz).toHit).toBe(4);
  });
  it('a DM-forged weapon effect still wins', () => {
    expect(weaponProfile({ id: 'x', effects: [{ type: 'weapon', toHit: '+7', damage: '2d6', damageType: 'fire' }] }, ftr))
      .toMatchObject({ toHit: 7, damage: '2d6', damageType: 'fire' });
  });
});

describe('skills', () => {
  it('class picks, background and race combine', () => {
    const s = skillProficiencies({ race: 'elf', background: 'acolyte', classSkills: ['Athletics', 'Survival'] },
      { starting_proficiencies: ['Skill: Insight', 'Skill: Religion'] });
    expect(s).toEqual({ Athletics: 'proficient', Survival: 'proficient', Insight: 'proficient', Religion: 'proficient', Perception: 'proficient' });
  });
  it('race skill table', () => {
    expect(RACE_SKILLS['half-orc']).toEqual(['Intimidation']);
  });
});

describe('saveForHalf', () => {
  it('halves the damage, rounding down, when the save meets the DC', () => {
    expect(saveForHalf(7, 13, 13)).toEqual({ saved: true, damage: 3 });
  });
  it('keeps full damage on a failed save', () => {
    expect(saveForHalf(7, 12, 13)).toEqual({ saved: false, damage: 7 });
  });
});

describe('weaponKind', () => {
  it('sorts weapons as the class equipment lists do', () => {
    expect(weaponKind('greataxe')).toEqual({ cat: 'martial', ranged: false });
    expect(weaponKind('dart')).toEqual({ cat: 'simple', ranged: true });
    expect(weaponKind('crossbow-light')).toEqual({ cat: 'simple', ranged: true });
    expect(weaponKind('handaxe')).toEqual({ cat: 'simple', ranged: false });
    expect(weaponKind('net')).toEqual({ cat: 'martial', ranged: true });
    expect(weaponKind('backpack')).toBe(null);
  });
});

describe('setHp (the DM sets a number)', () => {
  const hero = { hp: 10, hpMax: 12, hpTemp: 5, conditions: [], deathSaves: { successes: 1, failures: 2 } };
  it('keeps the number and does not spend temporary HP', () => {
    expect(setHp(hero, 4)).toMatchObject({ hp: 4, hpTemp: 5 });
  });
  it('to 0: unconscious, fresh death saves', () => {
    const r = setHp(hero, 0);
    expect(r.hp).toBe(0);
    expect(r.conditions).toContain('Unconscious');
    expect(r.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
  it('from 0 back up: awake, fresh death saves', () => {
    const down = { ...hero, hp: 0, conditions: ['Unconscious', 'Prone'], deathSaves: { successes: 2, failures: 1 } };
    const r = setHp(down, 3);
    expect(r.hp).toBe(3);
    expect(r.conditions).toEqual(['Prone']);
    expect(r.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
  it('clamps to 0..max, and the dead stay dead', () => {
    expect(setHp(hero, 99).hp).toBe(12);
    expect(setHp(hero, -4).hp).toBe(0);
    expect(setHp({ ...hero, dead: true, hp: 0 }, 5).hp).toBe(0);
  });
});

describe('parseHpEntry', () => {
  it('reads damage, healing and a number', () => {
    expect(parseHpEntry('-7')).toEqual({ damage: 7 });
    expect(parseHpEntry(' +5 ')).toEqual({ heal: 5 });
    expect(parseHpEntry('12')).toEqual({ hp: 12 });
    expect(parseHpEntry('12/20')).toEqual({ hp: 12, hpMax: 20 });
    expect(parseHpEntry('lots')).toBe(null);
    expect(parseHpEntry('')).toBe(null);
  });
});
