// plugins/dnd-hub/book/book-formats.test.js — the layouts met in real books (2026-10-04): the 2024 rules (SRD 5.2),
// Black Flag / Tales of the Valiant, a book set in 12 pt, and an adventure's keyed areas. Invented text throughout.
import { describe, it, expect } from 'vitest';
import { L, H } from './book-fixtures.js';
import { findMonsters } from './book-monsters.js';
import { findSpells } from './book-spells.js';
import { findItems } from './book-items.js';
import { findStory } from './book-story.js';

const N = (text, name, size) => L(text, { name, size });

describe('2024 layout (SRD 5.2)', () => {
  const BOG = [
    H('Bog Hag Sprout', 15),
    L('Small Fey (Hag), Neutral Evil'),
    L('AC 13 Initiative +2 (12)'), L('HP 22 (5d6 + 5)'), L('Speed 30 ft., Swim 20 ft.'),
    L('MOD SAVE MOD SAVE MOD SAVE', { size: 6 }),
    L('Str 10 +0 +0 Dex 14 +2 +4 Con12 +1 +1'), L('Int 9 −1 −1 WIS 12 +1 3 Cha 13 +1 +1'),
    L('Skills Stealth +4'), L('Immunities Poison; Charmed, Poisoned'), L('Senses Darkvision 60 ft.;'), L('Passive Perception 11'),
    L('Languages Sylvan'), L('CR 1 (XP 200; PB +2)'),
    H('Traits', 12), N('It can breathe mud.', 'Mud Breather.'),
    H('Actions', 12), N('Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage.', 'Claw.'),
    N('The webbing has', 'Snare.'), L('AC 10 and 5 hit points.'),
    H('Bonus Actions', 12), N('It hides.', 'Sink.'),
  ];
  it('reads AC/HP/CR, the score table with saves, one Immunities line, Traits, and the 2024 attack roll', () => {
    const [m] = findMonsters(BOG);
    expect(m).toMatchObject({ name: 'Bog Hag Sprout', size: 'Small', type: 'fey', ac: 13, hp: 22, hp_dice: '5d6+5', cr: 1, xp: 200,
      str: 10, dex: 14, con: 12, int: 9, wis: 12, cha: 13, damage_immunities: ['Poison'], condition_immunities: ['Charmed', 'Poisoned'] });
    expect(m.saving_throws).toEqual([{ ability: 'dex', bonus: 4 }, { ability: 'wis', bonus: 3 }]); // a save missing its sign still reads
    expect(m.special_abilities.map(a => a.name)).toEqual(['Mud Breather']);
    expect(m.actions.map(a => [a.name, a.attack_bonus])).toEqual([['Claw', 4], ['Snare', null]]);
    expect(m.ac).toBe(13); // "AC 10 and 5 hit points" inside an action is not the Armor Class
    expect(m.confidence).toBe('sure');
  });
  it('reads a 2024 spell: classes inline (wrapped), ritual in the casting time, the higher-level paragraph', () => {
    const [s] = findSpells([H('Mire Sense', 12), L('Level 1 Divination (Bard, Cleric, Druid,'), L('Ranger, Wizard)'),
      L('Casting Time: Action or Ritual'), L('Range: Self'), L('Components: V, S'), L('Duration: Concentration, up to 10 minutes'),
      L('You sense mud.'), L('Using a Higher-Level Spell Slot. The range grows.')]);
    expect(s).toMatchObject({ name: 'Mire Sense', level: 1, school: 'Divination', ritual: true, casting_time: 'Action',
      classes: ['Bard', 'Cleric', 'Druid', 'Ranger', 'Wizard'], concentration: true, higher_level: 'The range grows.' });
  });
  it('reads an item whose type line wraps after its comma', () => {
    const [it] = findItems([H('Reed Blade', 12), L('Weapon (Dagger, Shortsword, or Scimitar),'), L('Rare (Requires Attunement)'), L('It bends.')]);
    expect(it).toMatchObject({ name: 'Reed Blade', rarity: 'Rare', requires_attunement: true });
  });
});

describe('Black Flag / Tales of the Valiant', () => {
  it('reads "Name CR n", a size line without alignment, modifiers-only scores, Resistant/Immune', () => {
    const [m] = findMonsters([L('Bog Lurker CR 3', { size: 9, font: 'bold' }), L('Large Monstrosity'),
      L('Armor Class 14 (natural armor)'), L('Hit Points 60'), L('Speed 20 ft., swim 40 ft.'), L('Perception 13 Stealth 7'),
      L('Resistant cold | Thick Hide'), L('Immune poison; poisoned'), L('STR DEX CON INT WIS CHA'), L('+4 +1 +3 −3 +1 −2'),
      N('Cold does little.', 'Thick Hide.'), H('ACTIONS', 9), N('Melee Weapon Attack: +6 to hit, reach 5 ft.', 'Bite.')]);
    expect(m).toMatchObject({ name: 'Bog Lurker', size: 'Large', type: 'monstrosity', cr: 3, ac: 14, hp: 60,
      str: 18, dex: 12, con: 16, int: 4, wis: 12, cha: 6, damage_resistances: ['cold'], damage_immunities: ['poison'],
      condition_immunities: ['Poisoned'] });
    expect(m.actions.map(a => [a.name, a.attack_bonus])).toEqual([['Bite', 6]]);
    expect(m.confidence).toBe('sure');
  });
  it('reads circles, sources and a "(School)" wrapped onto the next line; capitals become a title', () => {
    const sp = findSpells([L('MUD BOLT'), L('2nd-Circle Arcane, Divine, Primordial, and Wyrd Ritual'), L('(Evocation)'),
      L('Casting Time: 1 action'), L('Range: 60 feet'), L('Components: V'), L('Duration: Instantaneous'), L('Mud flies.'),
      L('SPARK'), L('Arcane and Wyrd Cantrip (Evocation)'), L('Casting Time: 1 action'), L('Range: 30 feet'),
      L('Components: S'), L('Duration: Instantaneous'), L('A spark.')]);
    expect(sp.map(s => [s.name, s.level, s.school, s.ritual, s.classes])).toEqual([
      ['Mud Bolt', 2, 'Evocation', true, []], ['Spark', 0, 'Evocation', false, []]]);
  });
});

describe('book-wide sizes and adventures', () => {
  it('a book set in 12 pt does not end every spell at its first line', () => {
    const big = t => L(t, { size: 12 });
    const body = Array.from({ length: 30 }, (_, i) => big(`filler text line ${i} of the book in its usual size`));
    const sp = findSpells([...body, L('Mud Bolt', { size: 13 }), big('1st-level evocation'), big('Casting Time: 1 action'),
      big('Range: 60 feet'), big('Components: V'), big('Duration: Instantaneous'), big('Mud flies at a creature.')]);
    expect(sp[0].confidence).toBe('sure');
  });
  it('a cover title is not the chapter level, and keyed areas are sections of their own', () => {
    const st = findStory([L('THE MUD MANOR', { size: 60 }), L('Credits', { size: 24 }), L('Written by someone.'),
      L('Mud Manor', { size: 24 }), L('A house sinks.'), L('Areas of the Manor', { size: 20 }), L('Read on.'),
      L('1. Porch', { size: 15 }), L('Boards creak.'), L('Loose Board', { size: 12 }), L('One gives.'),
      L('2. Hall', { size: 15 }), L('Dark.'), L('2A. Closet', { size: 12 }), L('Coats.')]);
    expect(st.map(s => s.title)).toEqual(['THE MUD MANOR', 'Credits', 'Mud Manor', 'Areas of the Manor', '1. Porch', '2. Hall', '2A. Closet']);
    expect(st.find(s => s.title === 'Credits').chapter).toBe('Credits'); // the 24 pt headings are the chapters
    expect(st.find(s => s.title === '2. Hall').chapter).toBe('Mud Manor');
  });
});
