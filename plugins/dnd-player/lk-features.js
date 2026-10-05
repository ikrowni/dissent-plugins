// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-features.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-features.js' directly would make the plugin unmirrorable.

// lk-features.js — what a hero's features DO, in a sentence each.
//
// ⚠️ SOURCE; vendored into dnd-player (scripts/vendor-shared.mjs).
//
// The sheet listed feature names with nothing under them: the SRD data has no text for racial traits or class
// features, and the sheet's own table covered a third of them (owner, 2026-10-05). Names are SRD 5.1 names; every
// description is original. Never write the trademark in user-facing text.
import { SRD_SUBCLASS_DESC, FIGHTING_STYLES, PACT_BOONS } from './lk-levelling.js';

const RACE_TRAITS = {
  'darkvision': 'You see in dim light within 60 ft as if it were bright, and in darkness as if it were dim (no colours, only shades of grey).',
  'dwarven resilience': 'Advantage on saving throws against poison, and resistance to poison damage.',
  'dwarven combat training': 'Proficient with battleaxes, handaxes, light hammers and warhammers.',
  'dwarven toughness': 'One extra hit point at 1st level and one more every level after.',
  'stonecunning': 'Double your proficiency bonus on History checks about how stonework was made.',
  'tool proficiency': 'Proficient with one set of artisan’s tools of your choice.',
  'keen senses': 'Proficient in Perception.',
  'fey ancestry': 'Advantage on saves against being charmed, and magic cannot put you to sleep.',
  'trance': 'Instead of sleeping you meditate for 4 hours, and get the rest a human gets from 8.',
  'elf weapon training': 'Proficient with longswords, shortswords, shortbows and longbows.',
  'cantrip': 'You know one wizard cantrip of your choice; Intelligence is your casting ability for it.',
  'extra language': 'You speak, read and write one extra language of your choice.',
  'lucky': 'When you roll a 1 on the d20 for an attack, check or save, roll again and use the new roll.',
  'brave': 'Advantage on saving throws against being frightened.',
  'halfling nimbleness': 'You can move through the space of any creature bigger than you.',
  'naturally stealthy': 'You can try to hide even when only a creature bigger than you is in the way.',
  'draconic ancestry': 'Your dragon ancestor sets the element of your breath weapon and of your damage resistance.',
  'breath weapon': 'Use your action to breathe your ancestry’s element in an area; creatures in it save or take damage that grows with your level. Once per short or long rest.',
  'damage resistance': 'Resistance to the damage type of your draconic ancestry.',
  'gnome cunning': 'Advantage on Intelligence, Wisdom and Charisma saves against magic.',
  "artificer's lore": 'Double your proficiency bonus on History checks about magic items, alchemical objects and technology.',
  'tinker': 'With tinker’s tools, spend an hour and 10 gp to build a tiny clockwork toy, fire starter or music box.',
  'skill versatility': 'Proficient in two skills of your choice.',
  'menacing': 'Proficient in Intimidation.',
  'relentless endurance': 'When you drop to 0 hit points but are not killed outright, drop to 1 instead. Once per long rest.',
  'savage attacks': 'On a critical hit with a melee weapon, roll one of the weapon’s damage dice once more and add it.',
  'hellish resistance': 'Resistance to fire damage.',
  'infernal legacy': 'You know the thaumaturgy cantrip, and as you level you learn to cast hellish rebuke and darkness once a day.',
};

const CLASS_FEATURES = {
  // Barbarian
  'rage': 'Bonus action: rage for a minute. Advantage on Strength checks and saves, extra damage with Strength melee attacks, and resistance to bludgeoning, piercing and slashing. A few times per long rest.',
  'unarmored defense': 'Without armour your AC is 10 + Dexterity + Constitution (barbarian) or 10 + Dexterity + Wisdom (monk).',
  'reckless attack': 'Throw caution away: advantage on your Strength melee attacks this turn, but attacks against you have advantage until your next turn.',
  'danger sense': 'Advantage on Dexterity saves against effects you can see, such as traps and spells.',
  'primal path': 'Choose the path that shapes your rage.',
  'extra attack': 'When you take the Attack action you attack twice instead of once.',
  'fast movement': 'Your speed rises by 10 ft while you are not in heavy armour.',
  'feral instinct': 'Advantage on initiative, and you can act in a surprise round if you rage first.',
  'brutal critical': 'On a critical hit with a melee weapon, roll one more weapon damage die (more at higher levels).',
  'relentless rage': 'If you drop to 0 hit points while raging, a Constitution save keeps you at 1. Each use makes the next harder.',
  'persistent rage': 'Your rage ends early only if you fall unconscious or choose to end it.',
  'primal champion': 'Your Strength and Constitution each rise by 4, to a maximum of 24.',
  // Bard
  'spellcasting': 'You cast spells from your class list, using spell slots that come back when you rest.',
  'bardic inspiration': 'Bonus action: give a creature an inspiration die to add to one check, attack or save in the next 10 minutes.',
  'jack of all trades': 'Add half your proficiency bonus to any ability check that does not already include it.',
  'song of rest': 'After a short rest, allies who heard you perform regain extra hit points.',
  'bard college': 'Choose the college that shapes your bardic gifts.',
  'expertise': 'Double your proficiency bonus with two skills you are proficient in.',
  'font of inspiration': 'Your inspiration dice come back on a short rest as well as a long one.',
  'countercharm': 'Perform to give nearby allies advantage on saves against being frightened or charmed.',
  'magical secrets': 'Learn spells from any class’s list.',
  'superior inspiration': 'If you start a fight with no inspiration dice left, you get one back.',
  // Cleric
  'divine domain': 'Choose the domain of your god; it grants spells and powers as you level.',
  'channel divinity': 'Call on your god for a burst of power, such as turning undead. Comes back on a short or long rest.',
  'destroy undead': 'Undead weak enough that fail against your Turn Undead are destroyed outright.',
  'divine strike': 'Once per turn, your weapon hits carry extra damage from your god.',
  'divine intervention': 'Call on your god for help; on a good roll, your god steps in.',
  // Druid
  'druidic': 'You know Druidic, the secret language of druids, and can leave hidden messages in it.',
  'wild shape': 'Action: turn into a beast you have seen, for hours at a time. Twice per short or long rest.',
  'druid circle': 'Choose the circle of druids you belong to.',
  'beast spells': 'You can cast many of your spells while in beast form.',
  'archdruid': 'Wild Shape as often as you like, and cast spells without simple components.',
  // Fighter
  'fighting style': 'A fighting specialty, such as archery, defence or great weapons.',
  'second wind': 'Bonus action: regain 1d10 + your fighter level in hit points. Once per short or long rest.',
  'action surge': 'Once per short or long rest, take one extra action on your turn.',
  'martial archetype': 'Choose the archetype that shapes your fighting.',
  'indomitable': 'Reroll a saving throw you failed; you must use the new roll. Once per long rest (more at higher levels).',
  // Monk
  'martial arts': 'Unarmed strikes and monk weapons use Dexterity if you like, deal a martial arts die, and you get a bonus unarmed strike.',
  'ki': 'A pool of ki points, back on a short rest, for flurry of blows, patient defence and step of the wind.',
  'unarmored movement': 'Your speed rises while you wear no armour and carry no shield.',
  'monastic tradition': 'Choose the tradition your monastery taught you.',
  'deflect missiles': 'Reaction: knock a ranged weapon attack aside, and throw it back if you catch it.',
  'slow fall': 'Reaction: take much less damage from a fall.',
  'stunning strike': 'Spend ki when you hit: the target saves or is stunned until the end of your next turn.',
  'ki-empowered strikes': 'Your unarmed strikes count as magical.',
  'evasion': 'When a Dexterity save would halve damage, you take none on a success and half on a failure.',
  'stillness of mind': 'Action: end a charm or fear effect on yourself.',
  'purity of body': 'You are immune to disease and poison.',
  'tongue of the sun and moon': 'You understand every spoken language, and every creature that speaks understands you.',
  'diamond soul': 'Proficient in all saving throws, and you can spend ki to reroll one you failed.',
  'timeless body': 'You stop needing food and water, and age far more slowly.',
  'empty body': 'Spend ki to become invisible and resistant to almost every damage for a minute.',
  'perfect self': 'If you start a fight with no ki, you get some back.',
  // Paladin
  'divine sense': 'Sense celestials, fiends and undead nearby, and places made holy or unholy.',
  'lay on hands': 'A pool of healing you can share by touch; it can also cure disease and poison.',
  'divine smite': 'When you hit with a melee weapon, spend a spell slot for extra radiant damage (more against undead and fiends).',
  'divine health': 'You are immune to disease.',
  'sacred oath': 'Swear the oath that guides your paladin powers.',
  'aura of protection': 'You and nearby allies add your Charisma modifier to saving throws.',
  'aura of courage': 'You and nearby allies cannot be frightened while you are conscious.',
  'improved divine smite': 'Every melee weapon hit deals extra radiant damage.',
  'cleansing touch': 'Action: end one spell on yourself or a creature you touch.',
  // Ranger
  'favored enemy': 'Advantage on tracking and recalling lore about one kind of creature you have studied.',
  'natural explorer': 'In your favoured terrain you travel fast, never get lost, and find food easily.',
  'ranger archetype': 'Choose the archetype that shapes your ranging.',
  'primeval awareness': 'Spend a spell slot to sense certain creatures for miles around.',
  'land’s stride': 'Difficult natural terrain costs no extra movement, and plants do not hold you back.',
  "land's stride": 'Difficult natural terrain costs no extra movement, and plants do not hold you back.',
  'hide in plain sight': 'Camouflage yourself and stay hidden while you keep still.',
  'vanish': 'Hide as a bonus action, and you cannot be tracked by ordinary means.',
  'feral senses': 'You can fight creatures you cannot see without disadvantage.',
  'foe slayer': 'Once per turn, add your Wisdom modifier to an attack or damage roll against your favoured enemy.',
  // Rogue
  'sneak attack': 'Once per turn, extra damage when you hit with advantage, or when an ally stands next to your target.',
  "thieves' cant": 'The secret jargon and signs of thieves, for hiding messages in plain sight.',
  'cunning action': 'Bonus action: Dash, Disengage or Hide.',
  'roguish archetype': 'Choose the archetype that shapes your roguery.',
  'uncanny dodge': 'Reaction: halve the damage of an attack from someone you can see.',
  'reliable talent': 'On a skill you are proficient in, any d20 below 10 counts as a 10.',
  'blindsense': 'You know where any hidden or invisible creature within 10 ft is.',
  'slippery mind': 'Proficient in Wisdom saving throws.',
  'elusive': 'No attack roll has advantage against you while you are not incapacitated.',
  'stroke of luck': 'Turn a missed attack into a hit, or a failed check into a 20. Once per short or long rest.',
  // Sorcerer
  'sorcerous origin': 'Choose where your magic comes from; it grants powers as you level.',
  'font of magic': 'Sorcery points you can turn into spell slots, and slots into points.',
  'metamagic': 'Spend sorcery points to twist your spells: farther, quieter, faster, twice over.',
  'sorcerous restoration': 'A short rest gives you back some sorcery points.',
  // Warlock
  'otherworldly patron': 'Choose the being you made your pact with; it grants powers as you level.',
  'pact magic': 'A few spell slots, all of your highest level, that come back on a short rest.',
  'eldritch invocations': 'Fragments of forbidden knowledge that give you lasting magical abilities.',
  'pact boon': 'Your patron’s gift: a familiar, a weapon or a book.',
  'mystic arcanum': 'One powerful spell you can cast once per long rest without a slot.',
  'eldritch master': 'Once per long rest, plead with your patron to get all your spell slots back.',
  // Wizard
  'arcane recovery': 'Once a day, during a short rest, get back some spent spell slots.',
  'arcane tradition': 'Choose the school of magic you specialise in.',
  'spell mastery': 'Cast one 1st-level and one 2nd-level spell at will.',
  'signature spells': 'Two 3rd-level spells you can cast once each per short rest without a slot.',
};

/** Background features (the SRD has one background). */
const BACKGROUND_FEATURES = {
  'shelter of the faithful': 'Temples of your faith give you and your companions healing and care, and their priests will help you.',
};

const norm = s => String(s || '').toLowerCase().replace(/’/g, "'").trim();

/**
 * What a feature does, or '' when we do not know it. Handles the names the level-up adds:
 * "Fighting Style: Archery", "Champion (subclass)", "Feat: Alert", "Pact of the Blade", and suffixes such as
 * "(2)", "(1/rest)", "improvement". `feats` (optional): the SRD feats, [{ name, desc }].
 */
export function featureDesc(name, { feats = [] } = {}) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const style = raw.match(/^Fighting Style:\s*(.+)$/i);
  if (style) return FIGHTING_STYLES.find(s => norm(s.name) === norm(style[1]))?.desc || CLASS_FEATURES['fighting style'];
  const sub = raw.match(/^(.+?)\s*\(subclass\)$/i);
  if (sub) return SRD_SUBCLASS_DESC[norm(sub[1]).replace(/\s+/g, '-')] || SRD_SUBCLASS_DESC[norm(sub[1]).split(' ').pop()] || '';
  const feat = raw.match(/^Feat:\s*(.+)$/i);
  if (feat) return feats.find(f => norm(f.name) === norm(feat[1]))?.desc || '';
  const boon = PACT_BOONS.find(b => norm(b.name) === norm(raw));
  if (boon) return boon.desc;
  const key = norm(raw).replace(/\s*\(.*\)\s*$/, '').replace(/\s+improvement$/, '');
  return RACE_TRAITS[key] || CLASS_FEATURES[key] || BACKGROUND_FEATURES[key] || '';
}
