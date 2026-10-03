// lk-levelling.js — what each level gives a hero, and applying the player's choices (spec 2026-10-03 growing your hero).
// ⚠️ SOURCE; vendored into dnd-hub, dnd-master and dnd-player (scripts/vendor-shared.mjs). Pure: no DOM, no storage.
// Option names are SRD 5.1 names; every description is original. Never write the trademark in user-facing text.
import { abilityMod, hitDieFor, isAsiLevel, maxSlotsFor } from './lk-rules5e.js';

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const SUBCLASS_AT = { cleric: 1, sorcerer: 1, warlock: 1, druid: 2, wizard: 2 };
export const subclassLevel = cls => SUBCLASS_AT[cls] || 3;

/** One line for each SRD subclass (the SRD data has names only). */
export const SRD_SUBCLASS_DESC = {
  berserker: 'Rage so fiercely you strike again as a bonus action, and shrug off fear and charm.',
  lore: 'Learn extra skills and magic from every tradition; cut enemies down with words.',
  life: 'The healer’s path: your healing spells restore more, and you wear heavy armour.',
  land: 'Draw on one kind of land for extra spells and recover magic when you rest.',
  champion: 'Simple and deadly: you score critical hits more often and grow tougher.',
  'open-hand': 'Your flurry of blows can knock foes down, push them away or stop their reactions.',
  devotion: 'The classic holy knight: blessed weapons and an aura that turns fear and charm aside.',
  hunter: 'A monster slayer’s tricks: extra damage, and defences against hordes and big foes.',
  thief: 'Fast hands: use objects and climb as a bonus action, and act first in an ambush.',
  draconic: 'Dragon blood: tougher skin, more hit points, and one element that burns hotter.',
  fiend: 'Your patron rewards every kill with temporary hit points, and lends you its luck.',
  evocation: 'Blast magic: shape your spells around friends and hit harder with damage spells.',
};

export const FIGHTING_STYLES = [
  { id: 'archery', name: 'Archery', desc: '+2 to hit with ranged weapons.', classes: ['fighter', 'ranger'] },
  { id: 'defense', name: 'Defense', desc: '+1 AC while wearing armour.', classes: ['fighter', 'paladin', 'ranger'] },
  { id: 'dueling', name: 'Dueling', desc: '+2 damage with a one-handed weapon and nothing in the other hand.', classes: ['fighter', 'paladin', 'ranger'] },
  { id: 'great-weapon-fighting', name: 'Great Weapon Fighting', desc: 'Reroll 1s and 2s on damage with two-handed weapons.', classes: ['fighter', 'paladin'] },
  { id: 'protection', name: 'Protection', desc: 'With a shield, impose disadvantage on an attack against an ally next to you.', classes: ['fighter', 'paladin'] },
  { id: 'two-weapon-fighting', name: 'Two-Weapon Fighting', desc: 'Add your ability modifier to the off-hand attack’s damage.', classes: ['fighter', 'ranger'] },
];
const STYLE_AT = { fighter: 1, paladin: 2, ranger: 2 };

export const PACT_BOONS = [
  { id: 'chain', name: 'Pact of the Chain', desc: 'Summon a special familiar: an imp, pseudodragon, quasit or sprite.' },
  { id: 'blade', name: 'Pact of the Blade', desc: 'Conjure a pact weapon in your hand and fight with it.' },
  { id: 'tome', name: 'Pact of the Tome', desc: 'A Book of Shadows with three cantrips from any class.' },
];

export const METAMAGIC = [
  { id: 'careful', name: 'Careful Spell', desc: 'Protect some allies from your own area spell’s save.' },
  { id: 'distant', name: 'Distant Spell', desc: 'Double a spell’s range, or make a touch spell reach 30 ft.' },
  { id: 'empowered', name: 'Empowered Spell', desc: 'Reroll some of a spell’s damage dice.' },
  { id: 'extended', name: 'Extended Spell', desc: 'Make a spell last twice as long.' },
  { id: 'heightened', name: 'Heightened Spell', desc: 'One target has disadvantage on its first save against the spell.' },
  { id: 'quickened', name: 'Quickened Spell', desc: 'Cast an action spell as a bonus action.' },
  { id: 'subtle', name: 'Subtle Spell', desc: 'Cast without words or gestures, so nobody sees it coming.' },
  { id: 'twinned', name: 'Twinned Spell', desc: 'A single-target spell hits a second target too.' },
];
const METAMAGIC_AT = { 3: 2, 10: 1, 17: 1 };

// minLevel = warlock level needed; needs = { cantrip } or { pact }.
export const INVOCATIONS = [
  { id: 'agonizing-blast', name: 'Agonizing Blast', desc: 'Add your Charisma modifier to Eldritch Blast’s damage.', needs: { cantrip: 'eldritch-blast' } },
  { id: 'armor-of-shadows', name: 'Armor of Shadows', desc: 'Cast Mage Armor on yourself at will.' },
  { id: 'ascendant-step', name: 'Ascendant Step', desc: 'Cast Levitate on yourself at will.', minLevel: 9 },
  { id: 'beast-speech', name: 'Beast Speech', desc: 'Cast Speak with Animals at will.' },
  { id: 'beguiling-influence', name: 'Beguiling Influence', desc: 'Become proficient in Deception and Persuasion.' },
  { id: 'bewitching-whispers', name: 'Bewitching Whispers', desc: 'Cast Compulsion once per long rest.', minLevel: 7 },
  { id: 'book-of-ancient-secrets', name: 'Book of Ancient Secrets', desc: 'Write rituals into your Book of Shadows.', needs: { pact: 'tome' } },
  { id: 'chains-of-carceri', name: 'Chains of Carceri', desc: 'Hold a celestial, fiend or elemental with magic chains.', minLevel: 15, needs: { pact: 'chain' } },
  { id: 'devils-sight', name: 'Devil’s Sight', desc: 'See normally in darkness, even magical darkness, to 120 ft.' },
  { id: 'dreadful-word', name: 'Dreadful Word', desc: 'Cast Confusion once per long rest.', minLevel: 7 },
  { id: 'eldritch-sight', name: 'Eldritch Sight', desc: 'Cast Detect Magic at will.' },
  { id: 'eldritch-spear', name: 'Eldritch Spear', desc: 'Eldritch Blast reaches 300 ft.', needs: { cantrip: 'eldritch-blast' } },
  { id: 'eyes-of-the-rune-keeper', name: 'Eyes of the Rune Keeper', desc: 'Read all writing.' },
  { id: 'fiendish-vigor', name: 'Fiendish Vigor', desc: 'Cast False Life on yourself at will.' },
  { id: 'gaze-of-two-minds', name: 'Gaze of Two Minds', desc: 'See and hear through a willing creature’s senses.' },
  { id: 'lifedrinker', name: 'Lifedrinker', desc: 'Your pact weapon deals extra necrotic damage.', minLevel: 12, needs: { pact: 'blade' } },
  { id: 'mask-of-many-faces', name: 'Mask of Many Faces', desc: 'Cast Disguise Self at will.' },
  { id: 'master-of-myriad-forms', name: 'Master of Myriad Forms', desc: 'Cast Alter Self at will.', minLevel: 15 },
  { id: 'minions-of-chaos', name: 'Minions of Chaos', desc: 'Cast Conjure Elemental once per long rest.', minLevel: 9 },
  { id: 'mire-the-mind', name: 'Mire the Mind', desc: 'Cast Slow once per long rest.', minLevel: 5 },
  { id: 'misty-visions', name: 'Misty Visions', desc: 'Cast Silent Image at will.' },
  { id: 'one-with-shadows', name: 'One with Shadows', desc: 'Turn invisible while standing still in dim light or darkness.', minLevel: 5 },
  { id: 'otherworldly-leap', name: 'Otherworldly Leap', desc: 'Cast Jump on yourself at will.', minLevel: 9 },
  { id: 'repelling-blast', name: 'Repelling Blast', desc: 'Eldritch Blast pushes a creature 10 ft away.', needs: { cantrip: 'eldritch-blast' } },
  { id: 'sculptor-of-flesh', name: 'Sculptor of Flesh', desc: 'Cast Polymorph once per long rest.', minLevel: 7 },
  { id: 'sign-of-ill-omen', name: 'Sign of Ill Omen', desc: 'Cast Bestow Curse once per long rest.', minLevel: 5 },
  { id: 'thief-of-five-fates', name: 'Thief of Five Fates', desc: 'Cast Bane once per long rest.' },
  { id: 'thirsting-blade', name: 'Thirsting Blade', desc: 'Attack twice with your pact weapon.', minLevel: 5, needs: { pact: 'blade' } },
  { id: 'visions-of-distant-realms', name: 'Visions of Distant Realms', desc: 'Cast Arcane Eye at will.', minLevel: 15 },
  { id: 'voice-of-the-chain-master', name: 'Voice of the Chain Master', desc: 'Speak and sense through your familiar at any distance.', needs: { pact: 'chain' } },
  { id: 'whispers-of-the-grave', name: 'Whispers of the Grave', desc: 'Cast Speak with Dead at will.', minLevel: 9 },
  { id: 'witch-sight', name: 'Witch Sight', desc: 'See the true form of shapechangers and illusions within 30 ft.', minLevel: 15 },
];
// Invocations known by warlock level (index = level).
const INVOCATIONS_KNOWN = [0, 0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8];

const EXPERTISE_AT = { rogue: [1, 6], bard: [3, 10] };

// Cantrips known (index = level).
const CANTRIPS = {
  bard: [0, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  cleric: [0, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  druid: [0, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  sorcerer: [0, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  warlock: [0, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  wizard: [0, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
};
// Spells known for the classes that learn a fixed list (index = level).
const SPELLS_KNOWN = {
  bard: [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  ranger: [0, 0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
  sorcerer: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  warlock: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
};

/** What each class gains at each level, one line per feature (moved from the old player level-up). */
export const CLASS_FEATURES = {
  barbarian: { 2: 'Reckless Attack, Danger Sense', 3: 'Primal Path', 5: 'Extra Attack, Fast Movement', 7: 'Feral Instinct', 9: 'Brutal Critical', 11: 'Relentless Rage', 15: 'Persistent Rage', 20: 'Primal Champion' },
  bard: { 2: 'Jack of All Trades, Song of Rest', 3: 'Bard College, Expertise', 5: 'Font of Inspiration', 6: 'Countercharm', 10: 'Magical Secrets', 20: 'Superior Inspiration' },
  cleric: { 2: 'Channel Divinity (1/rest)', 5: 'Destroy Undead', 6: 'Channel Divinity (2/rest)', 8: 'Divine Strike', 10: 'Divine Intervention', 20: 'Divine Intervention improvement' },
  druid: { 2: 'Wild Shape, Druid Circle', 4: 'Wild Shape improvement', 8: 'Wild Shape improvement', 20: 'Beast Spells, Archdruid' },
  fighter: { 2: 'Action Surge', 3: 'Martial Archetype', 5: 'Extra Attack', 9: 'Indomitable', 11: 'Extra Attack (2)', 13: 'Indomitable (2)', 17: 'Action Surge (2), Indomitable (3)', 20: 'Extra Attack (3)' },
  monk: { 2: 'Ki, Unarmored Movement', 3: 'Monastic Tradition, Deflect Missiles', 4: 'Slow Fall', 5: 'Extra Attack, Stunning Strike', 6: 'Ki-Empowered Strikes', 7: 'Evasion, Stillness of Mind', 10: 'Purity of Body', 13: 'Tongue of the Sun and Moon', 14: 'Diamond Soul', 15: 'Timeless Body', 18: 'Empty Body', 20: 'Perfect Self' },
  paladin: { 2: 'Divine Smite, Fighting Style, Spellcasting', 3: 'Divine Health, Sacred Oath', 5: 'Extra Attack', 6: 'Aura of Protection', 10: 'Aura of Courage', 11: 'Improved Divine Smite', 14: 'Cleansing Touch' },
  ranger: { 2: 'Fighting Style, Spellcasting', 3: 'Ranger Archetype, Primeval Awareness', 5: 'Extra Attack', 8: 'Land’s Stride', 10: 'Hide in Plain Sight', 14: 'Vanish', 18: 'Feral Senses', 20: 'Foe Slayer' },
  rogue: { 2: 'Cunning Action', 3: 'Roguish Archetype', 5: 'Uncanny Dodge', 6: 'Expertise', 7: 'Evasion', 11: 'Reliable Talent', 14: 'Blindsense', 15: 'Slippery Mind', 18: 'Elusive', 20: 'Stroke of Luck' },
  sorcerer: { 2: 'Font of Magic', 3: 'Metamagic', 10: 'Metamagic', 17: 'Metamagic', 20: 'Sorcerous Restoration' },
  warlock: { 2: 'Eldritch Invocations', 3: 'Pact Boon', 11: 'Mystic Arcanum (6th)', 13: 'Mystic Arcanum (7th)', 15: 'Mystic Arcanum (8th)', 17: 'Mystic Arcanum (9th)', 20: 'Eldritch Master' },
  wizard: { 2: 'Arcane Tradition', 18: 'Spell Mastery', 20: 'Signature Spells' },
};

const PREPARES = ['cleric', 'druid', 'paladin'];
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const highestSlot = (cls, level) => { const m = maxSlotsFor(cls, level); for (let l = 9; l >= 1; l--) if (m[l] > 0) return l; return 0; };
const meets = (hero, prereqs) => (prereqs || []).every(p => (hero[String(p.ability || '').toLowerCase()] ?? 0) >= (p.minimum ?? 0));

function subclassOptions(hero, ctx) {
  const srdCls = (ctx.srd.classes || []).find(c => c.id === hero.class);
  const srd = (srdCls?.subclasses || []).map(s => ({ id: s.id, name: s.name, desc: SRD_SUBCLASS_DESC[s.id] || '', homebrew: false }));
  const mine = Object.values(ctx.library?.subclasses || {}).filter(s => s.classId === hero.class)
    .map(s => ({ id: s.id, name: s.name, desc: s.description || '', levels: s.levels || '', homebrew: true }));
  return [...srd, ...mine];
}

function featOptions(hero, ctx) {
  if (!ctx.featsAllowed) return [];
  const have = new Set(hero.feats || []);
  const srd = (ctx.srd.feats || []).filter(f => meets(hero, f.prerequisites))
    .map(f => ({ id: f.id, name: f.name, desc: f.desc || '', homebrew: false }));
  const mine = Object.values(ctx.library?.feats || {})
    .map(f => ({ id: f.id, name: f.name, desc: f.description || '', prerequisite: f.prerequisite || '', homebrew: true }));
  return [...srd, ...mine].filter(f => !have.has(f.id));
}

function spellsStep(hero, level, ctx) {
  const cls = hero.class;
  const cantrips = (CANTRIPS[cls]?.[level] ?? 0) - (CANTRIPS[cls]?.[level - 1] ?? 0);
  const spells = cls === 'wizard' ? (level > 1 ? 2 : 0) : PREPARES.includes(cls) ? 0
    : (SPELLS_KNOWN[cls]?.[level] ?? 0) - (SPELLS_KNOWN[cls]?.[level - 1] ?? 0);
  if (cantrips <= 0 && spells <= 0) return null;
  const maxLevel = highestSlot(cls, level);
  const known = new Set(hero.spells || []);
  const ofClass = (ctx.srd.spells || []).filter(s => (s.classes || []).includes(cap(cls)) && !known.has(s.id));
  return {
    kind: 'spells', cantrips: Math.max(0, cantrips), spells: Math.max(0, spells), maxLevel,
    options: {
      cantrips: ofClass.filter(s => s.level === 0).map(s => ({ id: s.id, name: s.name, level: 0 })),
      spells: ofClass.filter(s => s.level >= 1 && s.level <= maxLevel).map(s => ({ id: s.id, name: s.name, level: s.level })),
    },
  };
}

/** The choice steps of `level` for `hero` (no hit points, spells or feature list). */
function pickSteps(hero, level, ctx) {
  const cls = hero.class, steps = [];
  if (level === subclassLevel(cls) && !hero.subclass) steps.push({ kind: 'subclass', options: subclassOptions(hero, ctx) });
  if (STYLE_AT[cls] === level && !hero.fightingStyle) {
    steps.push({ kind: 'fightingStyle', options: FIGHTING_STYLES.filter(s => s.classes.includes(cls)) });
  }
  if ((EXPERTISE_AT[cls] || []).includes(level)) {
    const options = Object.entries(hero.skills || {}).filter(([, v]) => v === 'proficient').map(([k]) => k);
    steps.push({ kind: 'expertise', count: Math.min(2, options.length), options });
  }
  if (cls === 'warlock') {
    if (level === 3 && !hero.pactBoon) steps.push({ kind: 'pactBoon', options: PACT_BOONS });
    const gain = INVOCATIONS_KNOWN[level] - INVOCATIONS_KNOWN[level - 1];
    if (gain > 0) {
      const have = new Set(hero.invocations || []);
      const ok = i => !have.has(i.id) && (i.minLevel || 0) <= level
        && (!i.needs?.cantrip || (hero.spells || []).includes(i.needs.cantrip))
        && (!i.needs?.pact || hero.pactBoon === i.needs.pact);
      steps.push({ kind: 'invocations', count: gain, options: INVOCATIONS.filter(ok) });
    }
  }
  if (cls === 'sorcerer' && METAMAGIC_AT[level]) {
    const have = new Set(hero.metamagic || []);
    steps.push({ kind: 'metamagic', count: METAMAGIC_AT[level], options: METAMAGIC.filter(m => !have.has(m.id)) });
  }
  return steps;
}

/**
 * What the next level offers `hero`, in the order the scene asks: hp, subclass, class picks, asi, spells, features.
 * ctx = { srd: { classes, feats, spells }, library: { subclasses, feats }, featsAllowed }. Null at level 20.
 */
export function levelPlan(hero, ctx) {
  const level = (hero.level || 1) + 1;
  if (level > 20) return null;
  const die = hitDieFor(hero.class);
  const steps = [{ kind: 'hp', die, average: Math.floor(die / 2) + 1, conMod: abilityMod(hero.con), hillDwarf: hero.subrace === 'hill-dwarf' }];
  steps.push(...pickSteps(hero, level, ctx));
  if (isAsiLevel(hero.class, level)) steps.push({ kind: 'asi', feats: featOptions(hero, ctx) });
  const sp = spellsStep(hero, level, ctx);
  if (sp) steps.push(sp);
  const feat = CLASS_FEATURES[hero.class]?.[level];
  steps.push({ kind: 'features', list: feat ? feat.split(', ') : [] });
  return { level, steps };
}

/** The choices a brand-new level-1 hero makes (Forge, build-your-own). */
export function firstLevelPicks(hero, ctx) {
  return { level: 1, steps: pickSteps({ ...hero, level: 1 }, 1, ctx) };
}
