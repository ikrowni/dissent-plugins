// lk-classes2024.js — the twelve classes under the 2024 fifth-edition rules: what each level gives, for heroes made
// under Table rules → Rules: 2024 (owner, 2026-10-08). Heroes made under 2014 keep the 2014 tables (lk-levelling.js).
//
// ⚠️ SOURCE; vendored into dnd-hub, dnd-master and dnd-player (scripts/vendor-shared.mjs). Pure data and helpers.
//
// Facts (levels, counts) from the System Reference Document 5.2.1 class tables (CC-BY-4.0); every description is our
// own wording. Differences from 2014 that the levelling engine needs: every subclass at level 3; an Epic Boon (a
// feat) at 19; every caster prepares a set number of spells; paladins and rangers cast from level 1; warlock pact
// boons are invocations; clerics and druids choose an Order at level 1.

// Features by level (names as the SRD gives them). "Subclass feature" levels are left out: the subclass says.
const F = {
  barbarian: { 1: 'Rage, Unarmored Defense, Weapon Mastery', 2: 'Danger Sense, Reckless Attack', 3: 'Primal Knowledge',
    5: 'Extra Attack, Fast Movement', 7: 'Feral Instinct, Instinctive Pounce', 9: 'Brutal Strike', 11: 'Relentless Rage',
    13: 'Improved Brutal Strike', 15: 'Persistent Rage', 17: 'Improved Brutal Strike', 18: 'Indomitable Might', 20: 'Primal Champion' },
  bard: { 1: 'Bardic Inspiration, Spellcasting', 2: 'Expertise, Jack of All Trades', 5: 'Font of Inspiration', 7: 'Countercharm',
    9: 'Expertise', 10: 'Magical Secrets', 18: 'Superior Inspiration', 20: 'Words of Creation' },
  cleric: { 1: 'Spellcasting, Divine Order', 2: 'Channel Divinity', 5: 'Sear Undead', 7: 'Blessed Strikes', 10: 'Divine Intervention',
    14: 'Improved Blessed Strikes', 20: 'Greater Divine Intervention' },
  druid: { 1: 'Spellcasting, Druidic, Primal Order', 2: 'Wild Shape, Wild Companion', 5: 'Wild Resurgence', 7: 'Elemental Fury',
    15: 'Improved Elemental Fury', 18: 'Beast Spells', 20: 'Archdruid' },
  fighter: { 1: 'Fighting Style, Second Wind, Weapon Mastery', 2: 'Action Surge, Tactical Mind', 5: 'Extra Attack, Tactical Shift',
    9: 'Indomitable, Tactical Master', 11: 'Two Extra Attacks', 13: 'Indomitable (two uses), Studied Attacks',
    17: 'Action Surge (two uses), Indomitable (three uses)', 20: 'Three Extra Attacks' },
  monk: { 1: 'Martial Arts, Unarmored Defense', 2: "Monk's Focus, Unarmored Movement, Uncanny Metabolism", 3: 'Deflect Attacks',
    4: 'Slow Fall', 5: 'Extra Attack, Stunning Strike', 6: 'Empowered Strikes', 7: 'Evasion', 9: 'Acrobatic Movement',
    10: 'Heightened Focus, Self-Restoration', 13: 'Deflect Energy', 14: 'Disciplined Survivor', 15: 'Perfect Focus',
    18: 'Superior Defense', 20: 'Body and Mind' },
  paladin: { 1: 'Lay On Hands, Spellcasting, Weapon Mastery', 2: "Fighting Style, Paladin's Smite", 3: 'Channel Divinity',
    5: 'Extra Attack, Faithful Steed', 6: 'Aura of Protection', 9: 'Abjure Foes', 10: 'Aura of Courage', 11: 'Radiant Strikes',
    14: 'Restoring Touch', 18: 'Aura Expansion' },
  ranger: { 1: 'Spellcasting, Favored Enemy, Weapon Mastery', 2: 'Deft Explorer, Fighting Style', 5: 'Extra Attack', 6: 'Roving',
    9: 'Expertise', 10: 'Tireless', 13: 'Relentless Hunter', 14: "Nature's Veil", 17: 'Precise Hunter', 18: 'Feral Senses', 20: 'Foe Slayer' },
  rogue: { 1: "Expertise, Sneak Attack, Thieves' Cant, Weapon Mastery", 2: 'Cunning Action', 3: 'Steady Aim', 5: 'Cunning Strike, Uncanny Dodge',
    6: 'Expertise', 7: 'Evasion, Reliable Talent', 11: 'Improved Cunning Strike', 14: 'Devious Strikes', 15: 'Slippery Mind',
    18: 'Elusive', 20: 'Stroke of Luck' },
  sorcerer: { 1: 'Spellcasting, Innate Sorcery', 2: 'Font of Magic, Metamagic', 5: 'Sorcerous Restoration', 7: 'Sorcery Incarnate',
    10: 'Metamagic', 17: 'Metamagic', 20: 'Arcane Apotheosis' },
  warlock: { 1: 'Eldritch Invocations, Pact Magic', 2: 'Magical Cunning', 9: 'Contact Patron', 11: 'Mystic Arcanum (level 6 spell)',
    13: 'Mystic Arcanum (level 7 spell)', 15: 'Mystic Arcanum (level 8 spell)', 17: 'Mystic Arcanum (level 9 spell)', 20: 'Eldritch Master' },
  wizard: { 1: 'Spellcasting, Ritual Adept, Arcane Recovery', 2: 'Scholar', 5: 'Memorize Spell', 18: 'Spell Mastery', 20: 'Signature Spells' },
};

/** The features a 2024 hero of `cls` gains at `level` (no ability increases, subclass or Epic Boon: those are steps). */
export const features2024 = (cls, level) => (F[cls]?.[level] ? F[cls][level].split(/,\s*(?![^(]*\))/) : []);

export const SUBCLASS_LEVEL_2024 = 3;
const ASI_2024 = { fighter: [4, 6, 8, 12, 14, 16], rogue: [4, 8, 10, 12, 16] };
export const isAsiLevel2024 = (cls, level) => (ASI_2024[cls] || [4, 8, 12, 16]).includes(level);
export const EPIC_BOON_LEVEL = 19;
/** Skills raised to expertise at a level: { level: count }. A wizard's Scholar picks from a short list. */
export const EXPERTISE_2024 = { rogue: { 1: 2, 6: 2 }, bard: { 2: 2, 9: 2 }, ranger: { 2: 1, 9: 2 }, wizard: { 2: 1 } };
export const SCHOLAR_SKILLS = ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Religion'];
export const STYLE_AT_2024 = { fighter: 1, paladin: 2, ranger: 2 };
/** Sorcerer metamagic picks by level. */
export const METAMAGIC_AT_2024 = { 2: 2, 10: 2, 17: 2 };
/** Warlock invocations known, index = level. Pact of the Blade / Chain / Tome are invocations now. */
export const INVOCATIONS_2024 = [0, 1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10];

const up = (base) => [0, ...Array.from({ length: 20 }, (_, i) => base + (i + 1 >= 4 ? 1 : 0) + (i + 1 >= 10 ? 1 : 0))];
/** Cantrips known, index = level: the class's base, +1 at 4 and at 10. */
export const CANTRIPS_2024 = { bard: up(2), cleric: up(3), druid: up(2), sorcerer: up(4), warlock: up(2), wizard: up(3) };
const FULL_PREP = [0, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const HALF_PREP = [0, 2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];
/** Spells a 2024 caster has prepared (level 1+), index = level. */
export const PREPARED_2024 = {
  bard: FULL_PREP, cleric: FULL_PREP, druid: FULL_PREP, paladin: HALF_PREP, ranger: HALF_PREP,
  sorcerer: [0, 2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  warlock: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  wizard: [0, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25],
};

/** Level-1 choices that are new in 2024. */
export const DIVINE_ORDERS = [
  { id: 'protector', name: 'Protector', desc: 'Trained for battle: martial weapons and heavy armour.' },
  { id: 'thaumaturge', name: 'Thaumaturge', desc: 'One extra cleric cantrip, and your Wisdom adds to Arcana and Religion checks.' },
];
export const PRIMAL_ORDERS = [
  { id: 'magician', name: 'Magician', desc: 'One extra druid cantrip, and your Wisdom adds to Arcana and Nature checks.' },
  { id: 'warden', name: 'Warden', desc: 'Trained for battle: martial weapons and medium armour.' },
];

/** Pact boons are invocations in 2024 (taken from level 1). */
export const PACT_INVOCATIONS = [
  { id: 'pact-of-the-blade', name: 'Pact of the Blade', desc: 'Conjure a pact weapon and fight with it, using Charisma.' },
  { id: 'pact-of-the-chain', name: 'Pact of the Chain', desc: 'Find Familiar, with special forms such as an imp or sprite.' },
  { id: 'pact-of-the-tome', name: 'Pact of the Tome', desc: 'A Book of Shadows with three cantrips and two rituals of your choice.' },
];

/** Level 19: an Epic Boon (or another feat). Each raises one of `plus1` by 1, up to 30. */
const ANY = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const EPIC_BOONS = [
  { id: 'boon-of-combat-prowess', name: 'Boon of Combat Prowess', plus1: ANY, desc: 'Once a turn, turn a missed attack into a hit.' },
  { id: 'boon-of-dimensional-travel', name: 'Boon of Dimensional Travel', plus1: ANY, desc: 'After the Attack or Magic action, teleport up to 30 ft.' },
  { id: 'boon-of-fate', name: 'Boon of Fate', plus1: ANY, desc: 'When anyone within 60 ft makes a d20 test, add or subtract 2d4 (once per initiative or rest).' },
  { id: 'boon-of-irresistible-offense', name: 'Boon of Irresistible Offense', plus1: ['str', 'dex'], desc: 'Your weapon damage ignores resistance, and a natural 20 adds extra damage.' },
  { id: 'boon-of-spell-recall', name: 'Boon of Spell Recall', plus1: ['int', 'wis', 'cha'], needsCasting: true, desc: 'Casting with a level 1–4 slot, roll 1d4: on the slot\'s level, it is not spent.' },
  { id: 'boon-of-the-night-spirit', name: 'Boon of the Night Spirit', plus1: ANY, desc: 'Turn invisible in dim light or darkness as a bonus action, and resist most damage there.' },
  { id: 'boon-of-truesight', name: 'Boon of Truesight', plus1: ANY, desc: 'Truesight out to 60 ft.' },
];

/** What a 2024 class feature does, in a sentence (the sheet's features list; lk-features.js falls back to this). */
export const FEATURE_DESC_2024 = {
  'weapon mastery': 'Use the mastery property (Graze, Vex, Topple…) of the weapons you have chosen.',
  'primal knowledge': 'An extra barbarian skill, and while raging you may use Strength for some checks.',
  'instinctive pounce': 'When you enter your rage, move up to half your speed.',
  'brutal strike': 'Give up advantage from Reckless Attack to hit harder and knock, hamstring or stagger the target.',
  'improved brutal strike': 'Your Brutal Strike grows stronger and gains new effects.',
  'indomitable might': 'A Strength check or save below your Strength score uses your Strength score instead.',
  'expertise': 'Double your proficiency bonus with the chosen skills.',
  'words of creation': 'Power Word Heal and Power Word Kill are always prepared, and can target a second creature.',
  'divine order': 'Choose a calling: Protector (arms and heavy armour) or Thaumaturge (more magic and lore).',
  'channel divinity': 'Use divine power: Divine Spark heals or harms; Turn Undead drives undead away. Uses return on rests.',
  'sear undead': 'Undead you turn also take radiant damage.',
  'blessed strikes': 'Your cantrips or weapon hits deal extra radiant or necrotic damage, or you heal with a cantrip.',
  'improved blessed strikes': 'Blessed Strikes hit harder.',
  'greater divine intervention': 'Call on your god for any spell, including Wish, once in a long while.',
  'druidic': 'You speak the secret language of druids, and always have Speak with Animals prepared.',
  'primal order': 'Choose a calling: Magician (more magic and lore) or Warden (martial weapons and medium armour).',
  'wild companion': 'Spend a Wild Shape use or a spell slot to summon a fey spirit familiar.',
  'wild resurgence': 'Trade a spell slot for a Wild Shape use, or a Wild Shape use for a level 1 slot.',
  'elemental fury': 'Your cantrips or weapon hits gain elemental power.',
  'improved elemental fury': 'Elemental Fury grows stronger.',
  'tactical mind': 'When you fail an ability check, spend a Second Wind use to add 1d10.',
  'tactical shift': 'When you use Second Wind, move up to half your speed without provoking.',
  'tactical master': 'Swap a weapon\'s mastery for Push, Sap or Slow on an attack.',
  'two extra attacks': 'Attack three times when you take the Attack action.',
  'three extra attacks': 'Attack four times when you take the Attack action.',
  'studied attacks': 'When you miss a creature, your next attack against it has advantage.',
  "monk's focus": 'Focus points fuel Flurry of Blows, Patient Defense and Step of the Wind. They return on a rest.',
  'uncanny metabolism': 'When you roll initiative, regain all focus points and some hit points (once a long rest).',
  'deflect attacks': 'Use your reaction to reduce damage from an attack; reduce it to nothing and you may redirect it.',
  'empowered strikes': 'Your unarmed strikes can deal force damage.',
  'acrobatic movement': 'Run along walls and across liquids on your turn.',
  'heightened focus': 'Your focus abilities grow stronger.',
  'self-restoration': 'End charm, fear or poison on yourself at the end of your turn; skipping food and drink tires you less.',
  'deflect energy': 'Deflect Attacks works against any damage type.',
  'disciplined survivor': 'Proficient in every saving throw; spend a focus point to reroll a failed save.',
  'perfect focus': 'When you roll initiative with few focus points, regain some.',
  'superior defense': 'Spend focus points to resist all damage but force for a minute.',
  'body and mind': 'Your Dexterity and Wisdom rise by 4 (to a maximum of 25).',
  "paladin's smite": 'Divine Smite is always prepared, and once a long rest you can cast it without a slot.',
  'faithful steed': 'Find Steed is always prepared, and once a long rest you can cast it without a slot.',
  'abjure foes': 'Channel Divinity to frighten foes around you.',
  'radiant strikes': 'Your weapon and unarmed hits deal extra radiant damage.',
  'restoring touch': 'Lay On Hands can also end conditions such as blinded or poisoned.',
  'aura expansion': 'Your auras reach 30 feet.',
  'favored enemy': 'Hunter\'s Mark is always prepared, and you can cast it without a slot a few times a long rest.',
  'deft explorer': 'Expertise in one skill and two more languages.',
  'roving': 'Your speed rises by 10 ft, and you gain climbing and swimming speeds.',
  'tireless': 'Gain temporary hit points as an action, and a short rest lifts exhaustion.',
  'relentless hunter': 'Damage cannot break your concentration on Hunter\'s Mark.',
  "nature's veil": 'Turn invisible until the end of your next turn, a few times a long rest.',
  'precise hunter': 'Advantage on attacks against the target of your Hunter\'s Mark.',
  'steady aim': 'As a bonus action, if you have not moved, gain advantage on your next attack.',
  'cunning strike': 'Trade Sneak Attack dice to poison, trip or slip away from the target.',
  'improved cunning strike': 'Use two Cunning Strike effects at once.',
  'devious strikes': 'New Cunning Strike effects: daze, knock out or obscure.',
  'innate sorcery': 'As a bonus action, unleash your magic for a minute: higher save DCs and advantage on spell attacks.',
  'sorcery incarnate': 'Fuel Innate Sorcery with sorcery points, and use two Metamagic options on one spell.',
  'arcane apotheosis': 'While Innate Sorcery is active, one Metamagic each turn costs nothing.',
  'eldritch invocations': 'Occult gifts that change how your magic and pact work.',
  'magical cunning': 'Once a long rest, regain half your Pact Magic slots in a minute of ritual.',
  'contact patron': 'Contact Other Plane is always prepared and always works when you reach your patron.',
  'ritual adept': 'Cast any ritual from your spellbook without preparing it.',
  'arcane recovery': 'Once a day, regain some spell slots during a short rest.',
  'scholar': 'Expertise in one of Arcana, History, Investigation, Medicine, Nature or Religion.',
  'memorize spell': 'After a short rest, swap one prepared spell for another in your spellbook.',
  'epic boon': 'A powerful feat at level 19.',
};

/** Hit points, saves and proficiencies are as in 2014; these are the per-level tables the engine reads. */
export const has2024 = cls => !!F[cls];
