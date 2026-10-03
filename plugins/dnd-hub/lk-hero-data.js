// lk-hero-data.js — how the Hero Forge presents each race and class (spec 2026-10-03 hero forge §2).
// Words and colours only. Rules numbers (bonuses, speed, hit die) come from the bundled SRD, never typed here.
// All lore is original. Never write the trademark in user-facing text.
import { RACE_BLURBS, CLASS_BLURBS } from './dnd-hub-quick.js';

export const ROLES = ['Front line', 'Ranged', 'Healer', 'Magic', 'Sneaky', 'Support'];
export const DIFFICULTIES = ['Easy', 'Medium', 'Tricky'];

// The Forge's background for each race and class: [light from below, haze from above]. Owner, 2026-10-03: the race
// colours alone were too close to tell apart (most are warm golds), so each gets its own atmosphere.
export const AURAS = {
  dwarf: ['#ff6a1a', '#7a2e0e'], elf: ['#3ddc97', '#1e4d8c'], halfling: ['#ffc94a', '#5e8f2f'], human: ['#e8b54a', '#2f4fa8'],
  dragonborn: ['#ff3d2e', '#c9a227'], gnome: ['#29e0d0', '#7b4dff'], 'half-elf': ['#ff8fb3', '#7a5cd6'],
  'half-orc': ['#d4351c', '#6b4a2a'], tiefling: ['#ff2a6d', '#5b1a8c'],
  barbarian: ['#ff3b1f', '#8a1c0c'], bard: ['#ff5fd2', '#ffb347'], cleric: ['#fff1b8', '#d9a520'], druid: ['#7ddc3d', '#2f6b3a'],
  fighter: ['#7fa7d9', '#3b4a63'], monk: ['#ffae35', '#d9480f'], paladin: ['#ffe27a', '#8fb4ff'], ranger: ['#4caf50', '#8d6e3f'],
  rogue: ['#8a5cff', '#1a1033'], sorcerer: ['#ff4d4d', '#a64dff'], warlock: ['#7cff4d', '#6a00a8'], wizard: ['#3d7bff', '#7f5af0'],
};
const DEFAULT_AURA = ['#e0b552', '#3a2410'];

// art: true once dnd-hub/art/<id>.webp exists (owner-generated paintings; see the art prompts doc).
export const RACE_INFO = {
  dwarf: { colour: '#d9772b', signature: 'Shrugs off poison', art: true,
    lore: 'Mountain folk who carve their halls into the roots of the world. Slow to trust, slower to forget, and very hard to knock down.' },
  elf: { colour: '#9fd3b4', signature: 'Never needs sleep', art: true,
    lore: 'An old people of starlit forests who rest in a few hours of quiet trance. Their eyes catch what others miss.' },
  halfling: { colour: '#e0a84a', signature: 'Lucky: rerolls a 1', art: true,
    lore: 'Small, cheerful folk who love a full pantry and a warm hearth, and keep surviving things nobody should survive.' },
  human: { colour: '#e0b552', signature: 'Good at everything', art: true,
    lore: 'The youngest and most restless people, found everywhere, ambitious beyond their short years.' },
  dragonborn: { colour: '#c08a4a', signature: 'Breathes fire, ice or lightning', art: true,
    lore: 'Tall, scaled descendants of dragons who carry their ancestors’ fury in their breath.' },
  gnome: { colour: '#4fb3a6', signature: 'Hard to fool with magic', art: true,
    lore: 'Tiny, endlessly curious tinkerers and illusion-makers whose minds slip out of a spell’s grip.' },
  'half-elf': { colour: '#e39a9a', signature: 'Two extra skills', art: true,
    lore: 'Born between two worlds and belonging fully to neither: charming, adaptable, welcome almost anywhere.' },
  'half-orc': { colour: '#b5523b', signature: 'Refuses to fall once', art: true,
    lore: 'Strong and fierce, with an orc’s fury and a human’s will. When they should go down, they often don’t.' },
  tiefling: { colour: '#d4413b', signature: 'Resists fire', art: true,
    lore: 'Marked by an old infernal bargain: horns, a tail, eyes like coals, and a little hellfire in the blood.' },
};

export const CLASS_INFO = {
  barbarian: { role: 'Front line', difficulty: 'Easy', main: 'str', art: true, plays: 'Rage to hit harder and shrug off blows. Wade in and swing.' },
  bard: { role: 'Support', difficulty: 'Tricky', main: 'cha', art: true, plays: 'Inspire friends, heal them, and talk or trick your way past trouble.' },
  cleric: { role: 'Healer', difficulty: 'Medium', main: 'wis', art: true, plays: 'Heal the party and smite foes with holy magic, in heavy armour.' },
  druid: { role: 'Magic', difficulty: 'Tricky', main: 'wis', art: true, plays: 'Nature magic and healing; later you can turn into animals.' },
  fighter: { role: 'Front line', difficulty: 'Easy', main: 'str', art: true, plays: 'The best with weapons and armour. Simple, sturdy and reliable.' },
  monk: { role: 'Front line', difficulty: 'Medium', main: 'dex', art: true, plays: 'Fast unarmed strikes and acrobatics; no armour needed.' },
  paladin: { role: 'Front line', difficulty: 'Medium', main: 'str', art: true, plays: 'A holy knight: heavy armour, smiting blows and some healing.' },
  ranger: { role: 'Ranged', difficulty: 'Medium', main: 'dex', art: true, plays: 'Archer and tracker: a bow, wilderness skills and a little nature magic.' },
  rogue: { role: 'Sneaky', difficulty: 'Medium', main: 'dex', art: true, plays: 'Strike from the shadows for big damage; picks locks and finds traps.' },
  sorcerer: { role: 'Magic', difficulty: 'Medium', main: 'cha', art: true, plays: 'Magic in the blood: few spells, bent and twisted to your will.' },
  warlock: { role: 'Magic', difficulty: 'Medium', main: 'cha', art: true, plays: 'A pact grants a few strong spells that return after a short rest.' },
  wizard: { role: 'Magic', difficulty: 'Tricky', main: 'int', art: true, plays: 'The biggest spell list, studied from a spellbook. Fragile but full of answers.' },
};

/** The hit die in words a new player understands. */
export function sturdiness(hitDie) {
  return hitDie >= 12 ? 'Very sturdy' : hitDie >= 10 ? 'Sturdy' : hitDie >= 8 ? 'Steady' : 'Fragile';
}

/** What scene 1 shows for one SRD race. */
export function raceView(r) {
  const info = RACE_INFO[r.id] || {};
  const bonuses = r.ability_bonuses || [];
  const bonusText = bonuses.length >= 6 ? ['+1 to every ability'] : bonuses.map(b => `${b.ability} +${b.bonus}`);
  return {
    id: r.id, name: r.name, blurb: RACE_BLURBS[r.id] || '', lore: info.lore || '', colour: info.colour || '#e0b552',
    aura: AURAS[r.id] || DEFAULT_AURA,
    badges: [...bonusText, `${r.speed} ft`, ...(r.darkvision ? ['Darkvision'] : []), ...(info.signature ? [info.signature] : [])],
    emblem: `race-${r.id}`, art: info.art ? `art/${r.id}.webp` : null,
  };
}

/** What scene 2 shows for one SRD class. */
export function classView(c) {
  const info = CLASS_INFO[c.id] || {};
  return {
    id: c.id, name: c.name, blurb: CLASS_BLURBS[c.id] || '', role: info.role, difficulty: info.difficulty,
    main: String(info.main || '').toUpperCase(), sturdy: sturdiness(c.hit_die), plays: info.plays || '',
    emblem: `class-${c.id}`, art: info.art ? `art/${c.id}.webp` : null, aura: AURAS[c.id] || DEFAULT_AURA,
  };
}
