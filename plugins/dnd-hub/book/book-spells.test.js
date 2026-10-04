// plugins/dnd-hub/book/book-spells.test.js
import { describe, it, expect } from 'vitest';
import { findSpells, spellClasses } from './book-spells.js';
import { SPELLS, SPELL_LISTS } from './book-fixtures.js';

describe('findSpells', () => {
  const [ember, ward] = findSpells(SPELLS);
  it('reads a spell into the SRD spell shape', () => {
    expect(ember).toMatchObject({ id: 'ember-dart', name: 'Ember Dart', level: 1, school: 'Evocation', casting_time: '1 action',
      range: '60 feet', components: ['V', 'S', 'M'], material: 'a pinch of ash', ritual: false, concentration: false,
      duration: 'Instantaneous', confidence: 'sure' });
    expect(ember.desc).toBe('A dart of fire leaps from your hand. Make a ranged spell attack. On a hit, the target takes 2d6 fire damage.');
    expect(ember.higher_level).toBe('When you cast this spell using a spell slot of 2nd level or higher, the damage increases by 1d6.');
  });
  it('cantrips, rituals and concentration', () => {
    expect(ward).toMatchObject({ name: 'Quiet Ward', level: 0, school: 'Abjuration', ritual: true, concentration: true,
      duration: 'Concentration, up to 1 minute', components: ['S'], material: null, desc: 'Sound around you dims.' });
  });
  it('stops at the next big heading', () => {
    expect(ward.lines[1]).toBe(SPELLS.length - 2);
  });
  it('class lists fill each spell\'s classes', () => {
    const lists = spellClasses(SPELL_LISTS);
    expect(lists).toEqual({ 'quiet ward': ['Hearthkeeper'], 'ember dart': ['Hearthkeeper', 'Wayfarer'], 'mend cloak': ['Hearthkeeper'] });
    const withClasses = findSpells(SPELLS, lists);
    expect(withClasses[0].classes).toEqual(['Hearthkeeper', 'Wayfarer']);
  });
});
