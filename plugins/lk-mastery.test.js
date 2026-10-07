import { describe, it, expect } from 'vitest';
import { MASTERY_OF, MASTERIES, masteryCount, masteryFor, defaultMasteries, masteryOutcome } from './lk-mastery.js';

describe('which weapon has which mastery (SRD 5.2.1 weapons table)', () => {
  it('matches the table for a sample of weapons', () => {
    expect(MASTERY_OF.dagger).toBe('nick');
    expect(MASTERY_OF.quarterstaff).toBe('topple');
    expect(MASTERY_OF.greatsword).toBe('graze');
    expect(MASTERY_OF.longsword).toBe('sap');
    expect(MASTERY_OF.rapier).toBe('vex');
    expect(MASTERY_OF['crossbow-heavy']).toBe('push');
    expect(MASTERY_OF.longbow).toBe('slow');
    expect(MASTERY_OF.greataxe).toBe('cleave');
  });
  it('gives every weapon one of the eight masteries', () => {
    expect(Object.keys(MASTERIES).sort()).toEqual(['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex']);
    for (const k of Object.values(MASTERY_OF)) expect(MASTERIES[k]).toBeTruthy();
    expect(Object.keys(MASTERY_OF).length).toBe(36); // every weapon in lk-rules5e.js WEAPONS
  });
});

describe('how many a hero masters', () => {
  it('follows the class tables', () => {
    expect(masteryCount('fighter', 1)).toBe(3);
    expect(masteryCount('fighter', 4)).toBe(4);
    expect(masteryCount('fighter', 10)).toBe(5);
    expect(masteryCount('fighter', 16)).toBe(6);
    expect(masteryCount('barbarian', 3)).toBe(2);
    expect(masteryCount('barbarian', 4)).toBe(3);
    expect(masteryCount('barbarian', 10)).toBe(4);
    expect(masteryCount('Rogue', 20)).toBe(2);
    expect(masteryCount('paladin', 1)).toBe(2);
    expect(masteryCount('ranger', 5)).toBe(2);
    expect(masteryCount('wizard', 20)).toBe(0);
  });
  it('a new hero masters the weapons in their pack first', () => {
    expect(defaultMasteries({ class: 'fighter', level: 1 }, ['chain-mail', 'longsword', 'shield', 'crossbow-light', 'handaxe', 'handaxe']))
      .toEqual(['longsword', 'crossbow-light', 'handaxe']);
    expect(defaultMasteries({ class: 'wizard', level: 1 }, ['dagger'])).toEqual([]);
  });
});

describe('a mastered weapon in an attack', () => {
  const hero = { class: 'fighter', level: 1, str: 16, dex: 12, masteries: ['greatsword', 'quarterstaff'] };
  it('is nothing when the table has mastery off, or the weapon is not mastered', () => {
    expect(masteryFor(hero, { id: 'greatsword' }, false)).toBeNull();
    expect(masteryFor(hero, { id: 'longsword' }, true)).toBeNull();
  });
  it('carries the kind, the attack\'s ability modifier and the save DC', () => {
    expect(masteryFor(hero, { id: 'greatsword' }, true)).toEqual({ kind: 'graze', name: 'Graze', mod: 3, dc: 13 });
    expect(masteryFor(hero, { id: 'quarterstaff' }, true)).toMatchObject({ kind: 'topple', dc: 13 });
  });
  it('says what happens: Graze hurts on a miss; the rest on a hit', () => {
    expect(masteryOutcome({ kind: 'graze', mod: 3 }, { hit: false, targetName: 'Goblin' }))
      .toEqual({ damage: 3, text: 'Graze: the miss still deals 3 damage to Goblin.' });
    expect(masteryOutcome({ kind: 'graze', mod: 0 }, { hit: false, targetName: 'Goblin' })).toBeNull();
    expect(masteryOutcome({ kind: 'graze', mod: 3 }, { hit: true, targetName: 'Goblin' })).toBeNull();
    expect(masteryOutcome({ kind: 'vex', mod: 3 }, { hit: true, targetName: 'Goblin' })).toMatchObject({ vex: true, text: expect.stringMatching(/advantage on your next attack against Goblin/) });
    expect(masteryOutcome({ kind: 'topple', dc: 13 }, { hit: true, targetName: 'Ogre' }).text).toMatch(/Ogre makes a DC 13 Constitution save or falls Prone/);
    expect(masteryOutcome({ kind: 'sap' }, { hit: false, targetName: 'Ogre' })).toBeNull();
  });
});
