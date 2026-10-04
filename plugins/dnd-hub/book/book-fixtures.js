// book-fixtures.js — hand-written lines in the published 5e layout, for the recognisers' tests. Never real book text.
/** A line: plain body text, or `name` + text (a bold-italic run then body), or a label run (`lab`) then body. */
export function L(text, { size = 9.8, name = null, lab = null, font = 'body', page = 1 } = {}) {
  const runs = name ? [{ text: name, font: 'bi' }, { text: text, font: 'body' }]
    : lab ? [{ text: lab, font: 'bold' }, { text, font: 'body' }] : [{ text, font }];
  return { text: runs.map(r => r.text).filter(Boolean).join(' '), size, runs, page, x: 57, y: 0 };
}
export const H = (text, size = 12) => L(text, { size, font: 'bold' });

export const MUDLING = [
  H('Mudling'),
  L('Small humanoid (mudfolk), chaotic neutral', { font: 'italic' }),
  L('12 (leather armor)', { lab: 'Armor Class' }),
  L('9 (2d6 + 2)', { lab: 'Hit Points' }),
  L('30 ft., swim 20 ft.', { lab: 'Speed' }),
  L('STR DEX CON INT WIS CHA', { font: 'bold' }),
  L('10 (+0) 14 (+2) 12 (+1) 8 (−1) 11 (+0) 7 (−2)'),
  L('Dex +4', { lab: 'Saving Throws' }),
  L('Stealth +4, Perception +2', { lab: 'Skills' }),
  L('poison', { lab: 'Damage Resistances' }),
  L('charmed,', { lab: 'Condition Immunities' }),
  L('frightened'),
  L('darkvision 60 ft., passive Perception 12', { lab: 'Senses' }),
  L('Common, Mudling', { lab: 'Languages' }),
  L('1/2 (100 XP)', { lab: 'Challenge' }),
  L('The mudling can breathe air', { name: 'Amphibious.' }),
  L('and water.'),
  H('Actions', 10.8),
  L('The mudling makes two attacks.', { name: 'Multiattack.' }),
  L('Melee Weapon Attack: +4 to hit, reach 5 ft., one', { name: 'Claw.' }),
  L('target. Hit: 5 (1d6 + 2) slashing damage.'),
  H('Reactions', 10.8),
  L('The mudling sinks into mud.', { name: 'Slip Away.' }),
];

const lab = (label, text) => L(text, { lab: label });
export const SPELLS = [
  H('Ember Dart'),
  L('1st-level evocation', { font: 'italic' }),
  lab('Casting Time:', '1 action'), lab('Range:', '60 feet'), lab('Components:', 'V, S, M (a pinch of ash)'),
  lab('Duration:', 'Instantaneous'),
  L('A dart of fire leaps from your hand. Make a ranged'),
  L('spell attack. On a hit, the target takes 2d6 fire damage.'),
  L('When you cast this spell using a', { name: 'At Higher Levels.' }),
  L('spell slot of 2nd level or higher, the damage increases by 1d6.'),
  H('Quiet Ward'),
  L('Abjuration cantrip (ritual)', { font: 'italic' }),
  lab('Casting Time:', '1 bonus action'), lab('Range:', 'Self'), lab('Components:', 'S'),
  lab('Duration:', 'Concentration, up to 1 minute'),
  L('Sound around you dims.'),
  H('Chapter 9: Items', 18),
];
export const SPELL_LISTS = [
  H('Hearthkeeper Spells', 13.9),
  H('Cantrips (0 Level)'), L('Quiet Ward'),
  H('1st Level'), L('Ember Dart'), L('Mend Cloak'),
  H('Wayfarer Spells', 13.9), H('1st Level'), L('Ember Dart'),
  H('Spell Descriptions', 13.9), L('Each spell is described below, in alphabetical order by name.'),
];

export const ITEMS = [
  H('Lantern of Small Hours'),
  L('Wondrous item, rare (requires attunement by a', { font: 'italic' }),
  L('cleric or paladin)', { font: 'italic' }),
  L('While lit, this lantern shows the path home. It sheds'),
  L('bright light in a 20-foot radius.'),
  H('Ring of Quiet Steps'),
  L('Ring, uncommon', { font: 'italic' }),
  L('You make no sound when you walk.'),
  H('Appendix A', 18),
];

const P = (text, indent = false, font = 'body') => ({ ...L(text, { font }), indent });
export const STORY = [
  H('Chapter 1: The Drowned Bell', 18),
  P('The village of Brinemoor has not heard its bell in a'),
  P('hundred years.'),
  P('Last night, it rang.', true),
  H('Arriving in Brinemoor', 13.9),
  P('Read the following when the heroes arrive:'),
  P('Fog rolls off the water. Somewhere below the waves,', false, 'boxed'),
  P('a bell tolls once.', false, 'boxed'),
  P('The villagers watch from their doors.'),
  H('The Harbour Master', 12),
  P('Old Wendel knows more than he says.'),
  H('Chapter 2: Under the Waves', 18),
  P('The bell tower stands on the sea floor.'),
];
