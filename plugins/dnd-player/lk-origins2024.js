// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-origins2024.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-origins2024.js' directly would make the plugin unmirrorable.

// lk-origins2024.js — the 2024 (fifth-edition, revised) character origins, an optional Table rule (owner, 2026-10-07).
//
// ⚠️ SOURCE; vendored into dnd-hub (scripts/vendor-shared.mjs). Pure.
//
// Facts from the System Reference Document 5.2.1 (CC-BY-4.0): in the 2024 rules a hero's ability increases come from
// their BACKGROUND (+2 and +1, or +1 to all three of the background's abilities), and the background gives an
// ORIGIN FEAT; species give traits but no ability increases. Shaped like the bundled 2014 data (dnd-srd/races.json,
// backgrounds.json) so the Hero Forge reads either. Every description is our own wording.

const T = (name, desc) => ({ name, desc });
const sub = (id, name, traits = [], extra = {}) => ({ id, name, ability_bonuses: [], traits, ...extra });

export const SPECIES_2024 = [
  { id: 'dragonborn', name: 'Dragonborn', speed: 30, size: 'Medium', darkvision: 60, ability_bonuses: [],
    traits: [T('Draconic Ancestry', 'Your dragon ancestor sets the element of your breath and of your resistance.'),
      T('Breath Weapon', 'In place of one attack, breathe a 15-ft cone or 30-ft line: Dexterity save (DC 8 + CON + proficiency) or 1d10 of your element, half on a save; grows at levels 5, 11 and 17. Proficiency-bonus uses a long rest.'),
      T('Damage Resistance', 'Resistance to your ancestry\'s damage type.'), T('Darkvision', 'You see in darkness within 60 ft as if it were dim light.'),
      T('Draconic Flight', 'From level 5, sprout spectral wings for 10 minutes as a bonus action: fly at your speed. Once a long rest.')],
    subraces: [['black', 'acid'], ['blue', 'lightning'], ['brass', 'fire'], ['bronze', 'lightning'], ['copper', 'acid'],
      ['gold', 'fire'], ['green', 'poison'], ['red', 'fire'], ['silver', 'cold'], ['white', 'cold']]
      .map(([c, dmg]) => sub(`${c}-dragon`, `${c[0].toUpperCase()}${c.slice(1)} dragon (${dmg})`)) },
  { id: 'dwarf', name: 'Dwarf', speed: 30, size: 'Medium', darkvision: 120, ability_bonuses: [],
    traits: [T('Darkvision', 'You see in darkness within 120 ft as if it were dim light.'),
      T('Dwarven Resilience', 'Resistance to poison damage, and advantage on saves against being poisoned.'),
      T('Dwarven Toughness', 'One extra hit point now and one more every level.'),
      T('Stonecunning', 'As a bonus action, sense through stone within 60 ft (tremorsense) for 10 minutes. Proficiency-bonus uses a long rest.')], subraces: [] },
  { id: 'elf', name: 'Elf', speed: 30, size: 'Medium', darkvision: 60, ability_bonuses: [],
    traits: [T('Darkvision', 'You see in darkness within 60 ft as if it were dim light.'), T('Elven Lineage', 'Your lineage gives you a cantrip now and a spell at levels 3 and 5.'),
      T('Fey Ancestry', 'Advantage on saves against being charmed.'), T('Keen Senses', 'Proficient in Insight, Perception or Survival.'),
      T('Trance', 'You do not sleep; a long rest takes 4 hours of trance.')],
    subraces: [sub('drow', 'Drow', [T('Drow Lineage', 'Darkvision to 120 ft and the Dancing Lights cantrip; Faerie Fire at 3, Darkness at 5.')]),
      sub('high-elf', 'High Elf', [T('High Elf Lineage', 'The Prestidigitation cantrip (swap it for another wizard cantrip after a long rest); Detect Magic at 3, Misty Step at 5.')]),
      sub('wood-elf', 'Wood Elf', [T('Wood Elf Lineage', 'Speed 35 ft and the Druidcraft cantrip; Longstrider at 3, Pass without Trace at 5.')], { speed: 35 })] },
  { id: 'gnome', name: 'Gnome', speed: 30, size: 'Small', darkvision: 60, ability_bonuses: [],
    traits: [T('Darkvision', 'You see in darkness within 60 ft as if it were dim light.'), T('Gnomish Cunning', 'Advantage on Intelligence, Wisdom and Charisma saves.')],
    subraces: [sub('forest-gnome', 'Forest Gnome', [T('Forest Gnome Lineage', 'The Minor Illusion cantrip, and Speak with Animals without a slot proficiency-bonus times a long rest.')]),
      sub('rock-gnome', 'Rock Gnome', [T('Rock Gnome Lineage', 'The Mending and Prestidigitation cantrips; build tiny clockwork toys.')])] },
  { id: 'goliath', name: 'Goliath', speed: 35, size: 'Medium', darkvision: 0, ability_bonuses: [],
    traits: [T('Giant Ancestry', 'A boon from your giant forebears, usable proficiency-bonus times a long rest.'),
      T('Large Form', 'From level 5, grow to Large for 10 minutes as a bonus action: advantage on Strength checks, +10 ft speed. Once a long rest.'),
      T('Powerful Build', 'Advantage on checks to escape a grapple; you carry as if one size larger.')],
    subraces: [sub('cloud-giant', 'Cloud giant', [T("Cloud's Jaunt", 'Bonus action: teleport up to 30 ft to a space you can see.')]),
      sub('fire-giant', 'Fire giant', [T("Fire's Burn", 'When you hit and deal damage, add 1d10 fire damage.')]),
      sub('frost-giant', 'Frost giant', [T("Frost's Chill", 'When you hit and deal damage, add 1d6 cold and slow the target by 10 ft.')]),
      sub('hill-giant', 'Hill giant', [T("Hill's Tumble", 'When you hit a Large or smaller creature and deal damage, knock it prone.')]),
      sub('stone-giant', 'Stone giant', [T("Stone's Endurance", 'Reaction when you take damage: reduce it by 1d12 + your Constitution modifier.')]),
      sub('storm-giant', 'Storm giant', [T("Storm's Thunder", 'Reaction when a creature within 60 ft damages you: deal it 1d8 thunder.')])] },
  { id: 'halfling', name: 'Halfling', speed: 30, size: 'Small', darkvision: 0, ability_bonuses: [],
    traits: [T('Brave', 'Advantage on saves against being frightened.'), T('Halfling Nimbleness', 'Move through the space of any creature bigger than you.'),
      T('Luck', 'When you roll a 1 on a d20 test, roll again and use the new roll.'), T('Naturally Stealthy', 'You can hide behind a creature bigger than you.')], subraces: [] },
  { id: 'human', name: 'Human', speed: 30, size: 'Medium', darkvision: 0, ability_bonuses: [],
    traits: [T('Resourceful', 'You gain Heroic Inspiration whenever you finish a long rest.'), T('Skillful', 'Proficient in one more skill of your choice.'),
      T('Versatile', 'An extra origin feat of your choice (Skilled is a good one).')], subraces: [] },
  { id: 'orc', name: 'Orc', speed: 30, size: 'Medium', darkvision: 120, ability_bonuses: [],
    traits: [T('Adrenaline Rush', 'Dash as a bonus action and gain temporary hit points equal to your proficiency bonus; proficiency-bonus uses a short or long rest.'),
      T('Darkvision', 'You see in darkness within 120 ft as if it were dim light.'),
      T('Relentless Endurance', 'When you drop to 0 hit points but are not killed outright, drop to 1 instead. Once a long rest.')], subraces: [] },
  { id: 'tiefling', name: 'Tiefling', speed: 30, size: 'Medium', darkvision: 60, ability_bonuses: [],
    traits: [T('Darkvision', 'You see in darkness within 60 ft as if it were dim light.'), T('Fiendish Legacy', 'Your legacy gives a resistance and a cantrip now, and spells at levels 3 and 5.'),
      T('Otherworldly Presence', 'You know the Thaumaturgy cantrip.')],
    subraces: [sub('abyssal', 'Abyssal', [T('Abyssal Legacy', 'Resistance to poison and the Poison Spray cantrip; Ray of Sickness at 3, Hold Person at 5.')]),
      sub('chthonic', 'Chthonic', [T('Chthonic Legacy', 'Resistance to necrotic damage and the Chill Touch cantrip; False Life at 3, Ray of Enfeeblement at 5.')]),
      sub('infernal', 'Infernal', [T('Infernal Legacy', 'Resistance to fire and the Fire Bolt cantrip; Hellish Rebuke at 3, Darkness at 5.')])] },
];

export const ORIGIN_FEATS = {
  alert: { name: 'Alert', desc: 'Add your proficiency bonus to initiative, and you may swap your initiative with a willing ally.' },
  'magic-initiate-cleric': { name: 'Magic Initiate (Cleric)', desc: 'Two cleric cantrips and one level-1 cleric spell, castable once a long rest without a slot.' },
  'magic-initiate-wizard': { name: 'Magic Initiate (Wizard)', desc: 'Two wizard cantrips and one level-1 wizard spell, castable once a long rest without a slot.' },
  'savage-attacker': { name: 'Savage Attacker', desc: 'Once a turn when you hit with a weapon, roll its damage dice twice and use either roll.' },
  skilled: { name: 'Skilled', desc: 'Proficiency in any three skills or tools of your choice.' },
};

const bg = (id, name, abilities, feat, skills, tool, kit, gold) => ({
  id, name, abilities, feat, tool, kit, kitGold: gold,
  starting_proficiencies: skills.map(s => `Skill: ${s}`),
  // `feature` is what the Forge's background card and the sheet's features list show.
  feature: { name: `${ORIGIN_FEATS[feat].name} (origin feat)`, desc: ORIGIN_FEATS[feat].desc },
});

/** The four SRD 5.2.1 backgrounds. Kits are the "A" choice; "B" is 50 gold instead. */
export const BACKGROUNDS_2024 = [
  bg('acolyte', 'Acolyte', ['int', 'wis', 'cha'], 'magic-initiate-cleric', ['Insight', 'Religion'], "Calligrapher's Supplies",
    ["Calligrapher's Supplies", 'Book (prayers)', 'Holy Symbol', 'Parchment (10 sheets)', 'Robe'], 8),
  bg('criminal', 'Criminal', ['dex', 'con', 'int'], 'alert', ['Sleight of Hand', 'Stealth'], "Thieves' Tools",
    ['Dagger', 'Dagger', "Thieves' Tools", 'Crowbar', 'Pouch', 'Pouch', "Traveler's Clothes"], 16),
  bg('sage', 'Sage', ['con', 'int', 'wis'], 'magic-initiate-wizard', ['Arcana', 'History'], "Calligrapher's Supplies",
    ['Quarterstaff', "Calligrapher's Supplies", 'Book (history)', 'Parchment (8 sheets)', 'Robe'], 8),
  bg('soldier', 'Soldier', ['str', 'dex', 'con'], 'savage-attacker', ['Athletics', 'Intimidation'], 'Gaming Set (your choice)',
    ['Spear', 'Shortbow', 'Arrows (20)', 'Gaming Set', "Healer's Kit", 'Quiver', "Traveler's Clothes"], 14),
];

/**
 * The background's increases for a draft: `bgBonus` = { plus2, plus1 } (two different abilities of the background) or
 * { all: true } (+1 to each of its three). Anything else → none. { str: 2, … }; no score is raised above 20 (applied
 * by bgBonusScores).
 */
export function bgIncreases(background, bgBonus) {
  const abs = background?.abilities || [];
  if (!abs.length || !bgBonus) return {};
  if (bgBonus.all) return Object.fromEntries(abs.map(a => [a, 1]));
  const { plus2, plus1 } = bgBonus;
  if (!abs.includes(plus2) || !abs.includes(plus1) || plus2 === plus1) return {};
  return { [plus2]: 2, [plus1]: 1 };
}

export function bgBonusScores(scores, background, bgBonus) {
  const out = { ...scores };
  for (const [a, n] of Object.entries(bgIncreases(background, bgBonus))) out[a] = Math.min(20, (out[a] || 0) + n);
  return out;
}

/** A good default: +2 to the class's first ability the background offers, +1 to the next; else +1 to all three. */
export function suggestBgBonus(background, priority) {
  const abs = background?.abilities || [];
  const mine = (priority || []).filter(a => abs.includes(a));
  return mine.length >= 2 ? { plus2: mine[0], plus1: mine[1] } : { all: true };
}

// The background that suits each class: one offering the class's main ability, and the life it would likely have led.
const CLASS_BACKGROUND = {
  barbarian: 'soldier', bard: 'acolyte', cleric: 'acolyte', druid: 'sage', fighter: 'soldier', monk: 'criminal',
  paladin: 'soldier', ranger: 'soldier', rogue: 'criminal', sorcerer: 'acolyte', warlock: 'acolyte', wizard: 'sage',
};
export const suggestBackground = classId => CLASS_BACKGROUND[classId] || 'soldier';

/** Extra skills a 2024 species lets you choose (Human: one). */
export const extraSkillsFor = raceId => (raceId === 'human' ? 1 : 0);

/** Alert (origin feat): the hero's proficiency bonus on initiative; 0 without it. */
export function alertBonus(c) {
  const has = (c?.features || []).some(f => /^alert\b/i.test(typeof f === 'string' ? f : f?.name || ''));
  return has ? Math.ceil(1 + Math.max(1, c.level || 1) / 4) : 0;
}
