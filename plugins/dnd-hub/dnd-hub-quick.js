// dnd-hub-quick.js — Quick character: a complete, rules-valid draft from a race and a class (spec 2026-10-03 §2).
// Pure: data in, draft out. The page is the Hero Forge (dnd-hub-forge.js); saving is the creator's own path.
import { ABILITY_KEYS, CANTRIPS_KNOWN, classSkillChoice, draftScores, spellLimitL1 } from './dnd-hub-draft-rules.js';
import { armorClass, weaponProfile, hitDieFor, abilityMod, isWeaponId } from './lk-rules5e.js';

const ARRAY = [15, 14, 13, 12, 10, 8];

// Which ability gets which standard-array score, best first.
export const CLASS_PRIORITY = {
  barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'], bard: ['cha', 'dex', 'con', 'wis', 'int', 'str'],
  cleric: ['wis', 'con', 'str', 'dex', 'cha', 'int'], druid: ['wis', 'con', 'dex', 'int', 'cha', 'str'],
  fighter: ['str', 'con', 'dex', 'wis', 'cha', 'int'], monk: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  paladin: ['str', 'cha', 'con', 'wis', 'dex', 'int'], ranger: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  rogue: ['dex', 'con', 'wis', 'int', 'cha', 'str'], sorcerer: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  warlock: ['cha', 'con', 'dex', 'wis', 'int', 'str'], wizard: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
};

// Skills a class's hero usually wants, best first. Only legal picks are taken (the class list decides).
const SKILL_PREF = {
  barbarian: ['Perception', 'Athletics', 'Survival', 'Intimidation'],
  bard: ['Persuasion', 'Performance', 'Deception', 'Perception', 'Stealth'],
  cleric: ['Medicine', 'Persuasion', 'History'],
  druid: ['Perception', 'Nature', 'Medicine', 'Survival'],
  fighter: ['Athletics', 'Perception', 'Intimidation', 'Survival'],
  monk: ['Acrobatics', 'Stealth', 'Athletics'],
  paladin: ['Athletics', 'Persuasion', 'Intimidation'],
  ranger: ['Perception', 'Stealth', 'Survival', 'Nature'],
  rogue: ['Stealth', 'Perception', 'Acrobatics', 'Investigation', 'Sleight of Hand', 'Deception'],
  sorcerer: ['Arcana', 'Persuasion', 'Deception'],
  warlock: ['Arcana', 'Deception', 'Intimidation'],
  wizard: ['Arcana', 'Investigation', 'History'],
};
const ANY_SKILL_PREF = ['Perception', 'Stealth', 'Athletics', 'Acrobatics', 'Persuasion', 'Arcana', 'Investigation',
  'Survival', 'Medicine', 'Deception', 'Intimidation', 'Performance', 'History', 'Nature', 'Animal Handling',
  'Sleight of Hand'];
const BACKGROUND_SKILLS = ['Insight', 'Religion']; // Acolyte, the only SRD 5.1 background
const RACE_SKILLS = { elf: ['Perception'], 'half-orc': ['Intimidation'] };

// SRD-style starting kits, ids from equipment.json (audit A11). Armour and shields are worn when saved.
export const STARTING_KITS = {
  barbarian: ['greataxe', 'handaxe', 'javelin', 'explorers-pack'],
  bard: ['rapier', 'leather-armor', 'dagger', 'lute', 'entertainers-pack'],
  cleric: ['mace', 'scale-mail', 'shield', 'crossbow-light', 'emblem', 'priests-pack'],
  druid: ['scimitar', 'leather-armor', 'shield', 'sprig-of-mistletoe', 'explorers-pack'],
  fighter: ['longsword', 'chain-mail', 'shield', 'crossbow-light', 'dungeoneers-pack'],
  monk: ['shortsword', 'dart', 'explorers-pack'],
  paladin: ['longsword', 'chain-mail', 'shield', 'javelin', 'emblem', 'priests-pack'],
  ranger: ['shortsword', 'scale-mail', 'longbow', 'quiver', 'explorers-pack'],
  rogue: ['rapier', 'shortbow', 'quiver', 'leather-armor', 'dagger', 'thieves-tools', 'burglars-pack'],
  sorcerer: ['crossbow-light', 'dagger', 'component-pouch', 'explorers-pack'],
  warlock: ['crossbow-light', 'dagger', 'leather-armor', 'component-pouch', 'explorers-pack'],
  wizard: ['quarterstaff', 'dagger', 'component-pouch', 'spellbook', 'scholars-pack'],
};

// Good first spells, best first; trimmed to the class's limits.
export const RECOMMENDED_SPELLS = {
  bard: { cantrips: ['vicious-mockery', 'minor-illusion'], spells: ['healing-word', 'charm-person', 'sleep', 'heroism'] },
  cleric: { cantrips: ['sacred-flame', 'guidance', 'spare-the-dying'],
    spells: ['bless', 'cure-wounds', 'guiding-bolt', 'healing-word', 'shield-of-faith', 'sanctuary'] },
  druid: { cantrips: ['produce-flame', 'guidance'], spells: ['cure-wounds', 'entangle', 'faerie-fire', 'healing-word', 'thunderwave', 'goodberry'] },
  sorcerer: { cantrips: ['fire-bolt', 'ray-of-frost', 'mage-hand', 'prestidigitation'], spells: ['magic-missile', 'shield'] },
  warlock: { cantrips: ['eldritch-blast', 'minor-illusion'], spells: ['hellish-rebuke', 'charm-person'] },
  wizard: { cantrips: ['fire-bolt', 'mage-hand', 'light'],
    spells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'detect-magic', 'thunderwave'] },
};

export const READY_HEROES = [
  { id: 'dwarf-fighter', race: 'dwarf', class: 'fighter', name: 'Thora Ironbrand', label: 'Brave dwarf fighter', picks: { fightingStyle: 'defense' },
    blurb: 'Heavy armour, a sword and shield. Stands in front and keeps friends safe.' },
  { id: 'elf-wizard', race: 'elf', class: 'wizard', name: 'Aelin Starwhisper', label: 'Clever elf wizard',
    blurb: 'Fragile but powerful: magic missiles, sleep spells and a spellbook full of answers.' },
  { id: 'halfling-rogue', race: 'halfling', class: 'rogue', name: 'Pip Underbough', label: 'Sneaky halfling rogue', picks: { expertise: ['Stealth', 'Perception'] },
    blurb: 'Quiet, quick and lucky. Opens locks, finds traps, strikes from the shadows.' },
  { id: 'human-cleric', race: 'human', class: 'cleric', name: 'Brother Aldric', label: 'Kind human cleric', picks: { subclass: 'life' },
    blurb: 'Armoured healer. Keeps the party standing and smites what threatens it.' },
  { id: 'half-orc-barbarian', race: 'half-orc', class: 'barbarian', name: 'Grusk the Bold', label: 'Fierce half-orc barbarian',
    blurb: 'Rages, hits hard and shrugs off blows that would drop anyone else.' },
  { id: 'half-elf-bard', race: 'half-elf', class: 'bard', name: 'Lyra Songweaver', label: 'Charming half-elf bard',
    blurb: 'Talks the party out of trouble, heals with a song, and knows a bit of everything.' },
];

export const RACE_BLURBS = {
  dwarf: 'Tough and steady; sees in the dark.', elf: 'Graceful and keen-eyed; sees in the dark.',
  halfling: 'Small, nimble and lucky.', human: 'Adaptable: a little better at everything.',
  dragonborn: 'Proud dragon-blooded warriors with a breath weapon.', gnome: 'Small, curious and clever; sees in the dark.',
  'half-elf': 'Charming and versatile; two extra skills.', 'half-orc': 'Strong and hard to put down.',
  tiefling: 'Fiend-touched; resists fire and knows a little magic.',
};
export const CLASS_BLURBS = {
  barbarian: 'Rage and raw strength.', bard: 'Music, magic and a silver tongue.', cleric: 'Armoured healer of a god.',
  druid: 'Nature magic and healing.', fighter: 'Armour, weapons, stands in front.', monk: 'Fast unarmed fighter.',
  paladin: 'Holy knight: armour, sword and healing.', ranger: 'Archer and tracker of the wilds.',
  rogue: 'Stealth, traps and sneak attacks.', sorcerer: 'Born with raw magic.', warlock: 'Magic from a pact.',
  wizard: 'Studied magic; the biggest spell list.',
};
const NAMES = {
  dwarf: ['Bruni Stonefist', 'Dagna Coalbeard', 'Rurik Hammerfall'], elf: ['Sylvar Leafsong', 'Ithil Moonbrook', 'Nimue Ashgrove'],
  halfling: ['Merry Tealeaf', 'Rosie Goodbarrel', 'Tobin Hillfoot'], human: ['Mara Holt', 'Edric Vane', 'Tamsin Reed'],
  dragonborn: ['Arjhan Flamescale', 'Sora Brightclaw', 'Kriv Ember'], gnome: ['Fizz Copperpot', 'Nim Tinkerley', 'Wren Gearwhistle'],
  'half-elf': ['Kael Dawnmere', 'Isla Fairwind', 'Rowan Vale'], 'half-orc': ['Shura Redtusk', 'Durg Ironhide', 'Mok Ashjaw'],
  tiefling: ['Vex Morrow', 'Ria Cinder', 'Lucan Hollow'],
};

/** A complete creator draft for `raceId` + `classId`. `rng` picks the name; `name` overrides it. */
export function quickBuild(srd, raceId, classId, rng = Math.random, name = null, picks = {}) {
  const race = (srd.races || []).find(r => r.id === raceId);
  const prio = CLASS_PRIORITY[classId] || ABILITY_KEYS;
  const baseScores = Object.fromEntries(prio.map((a, i) => [a, ARRAY[i]]));
  const halfElfBonus = raceId === 'half-elf' ? prio.filter(a => a !== 'cha').slice(0, 2) : [];

  const { choose, from } = classSkillChoice(srd.classes, classId);
  const taken = new Set([...BACKGROUND_SKILLS, ...(RACE_SKILLS[raceId] || [])]);
  const wanted = [...(SKILL_PREF[classId] || []), ...from];
  const proficiencyChoices = [...new Set(wanted)].filter(s => from.includes(s) && !taken.has(s)).slice(0, choose);
  const extraSkills = raceId === 'half-elf'
    ? ANY_SKILL_PREF.filter(s => !taken.has(s) && !proficiencyChoices.includes(s)).slice(0, 2) : [];

  const draft = {
    race: raceId, subrace: race?.subraces?.[0]?.id || null, class: classId, subclass: null, level: 1,
    background: 'acolyte', abilityMethod: 'standard-array', baseScores, halfElfBonus,
    proficiencyChoices, extraSkills, equipment: [...(STARTING_KITS[classId] || [])], useStartingGold: false,
    cantrips: [], spells: [], alignment: 'Neutral Good', deity: '', portraitUrl: '', portraitFileId: '',
    personalityTraits: '', ideals: '', bonds: '', flaws: '', appearance: '', backstory: '',
  };
  const rec = RECOMMENDED_SPELLS[classId];
  if (rec) {
    draft.cantrips = rec.cantrips.slice(0, CANTRIPS_KNOWN[classId] ?? 0);
    draft.spells = rec.spells.slice(0, spellLimitL1(classId, draftScores(draft, srd.races).wis));
  }
  const pool = NAMES[raceId] || ['Hero'];
  draft.name = name || pool[Math.floor(rng() * pool.length) % pool.length];
  // A ready-made hero's level-1 picks (subclass, fighting style, expertise): growing-your-hero spec §1.
  Object.assign(draft, picks);
  return draft;
}

/** What the "Here's your hero" card shows: HP, AC and the main attack, by the same rules the save uses. */
export function previewStats(srd, draft) {
  const scores = draftScores(draft, srd.races);
  const hero = { class: draft.class, level: 1, ...scores };
  const worn = (draft.equipment || []).filter(id => (srd.equipment || []).find(e => e.id === id)?.category === 'Armor');
  const firstArmor = worn.find(id => id !== 'shield');
  const ac = armorClass(hero, [...(firstArmor ? [firstArmor] : []), ...worn.filter(id => id === 'shield')]);
  const hp = Math.max(1, hitDieFor(draft.class) + abilityMod(scores.con)) + (draft.subrace === 'hill-dwarf' ? 1 : 0);
  const weaponId = (draft.equipment || []).find(id => isWeaponId(id));
  const w = weaponId ? weaponProfile({ id: weaponId }, hero) : null;
  const weaponName = weaponId ? ((srd.equipment || []).find(e => e.id === weaponId)?.name || weaponId) : null;
  return { hp, ac, attack: w ? { name: weaponName, toHit: w.toHit, damage: w.damage, damageType: w.damageType } : null };
}

/** The reveal card's numbers for a saved hero (level-up). */
export function previewStatsOfHero(h) {
  const weapon = (h.equipment || []).find(e => e.type === 'weapon' && e.equipped);
  const w = weapon ? weaponProfile({ id: weapon.id }, h) : null;
  return { hp: h.hpMax, ac: h.ac, attack: w ? { name: weapon.name, toHit: w.toHit, damage: w.damage, damageType: w.damageType } : null };
}
