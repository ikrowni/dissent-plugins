// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-mastery.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-mastery.js' directly would make the plugin unmirrorable.

// lk-mastery.js — weapon mastery, the 2024 rule (SRD 5.2.1, CC-BY-4.0): each weapon has a mastery property that a
// hero with the Weapon Mastery feature can use with the weapons they have chosen (owner, 2026-10-07: an optional
// Table rule). Facts from the SRD 5.2.1 weapons table and class tables; every description here is our own wording.
//
// ⚠️ SOURCE; vendored into dnd-hub and dnd-player (scripts/vendor-shared.mjs). Pure.
import { profBonus, weaponProfile } from './lk-rules5e.js';

/** Weapon id (lk-rules5e.js WEAPONS) → its mastery. */
export const MASTERY_OF = {
  club: 'slow', dagger: 'nick', greatclub: 'push', handaxe: 'vex', javelin: 'slow', 'light-hammer': 'nick', mace: 'sap',
  quarterstaff: 'topple', sickle: 'nick', spear: 'sap',
  dart: 'vex', 'crossbow-light': 'slow', shortbow: 'vex', sling: 'slow',
  battleaxe: 'topple', flail: 'sap', glaive: 'graze', greataxe: 'cleave', greatsword: 'graze', halberd: 'cleave', lance: 'topple',
  longsword: 'sap', maul: 'topple', morningstar: 'sap', pike: 'push', rapier: 'vex', scimitar: 'nick', shortsword: 'vex',
  trident: 'topple', warhammer: 'push', 'war-pick': 'sap', whip: 'slow',
  blowgun: 'vex', 'crossbow-hand': 'vex', 'crossbow-heavy': 'push', longbow: 'slow',
  // (the 2024 firearms are not in our weapon list)
};

export const MASTERIES = {
  cleave: { name: 'Cleave', desc: 'On a melee hit, once a turn, swing again at a second creature within 5 feet of the first (no ability modifier on that damage).' },
  graze:  { name: 'Graze',  desc: 'A miss still deals damage equal to the attack\'s ability modifier.' },
  nick:   { name: 'Nick',   desc: 'The extra attack from a Light weapon is part of the Attack action, not a Bonus Action (once a turn).' },
  push:   { name: 'Push',   desc: 'On a hit, push a Large or smaller creature up to 10 feet straight away from you.' },
  sap:    { name: 'Sap',    desc: 'On a hit, the creature has Disadvantage on its next attack before your next turn.' },
  slow:   { name: 'Slow',   desc: 'On a hit that deals damage, the creature\'s Speed drops by 10 feet until your next turn.' },
  topple: { name: 'Topple', desc: 'On a hit, the creature makes a Constitution save (DC 8 + your modifier + Proficiency Bonus) or falls Prone.' },
  vex:    { name: 'Vex',    desc: 'On a hit that deals damage, you have Advantage on your next attack against that creature before your next turn ends.' },
};

// class → [[from level, count], …] (SRD 5.2.1 class tables; Paladin, Ranger and Rogue choose two kinds)
const COUNTS = {
  barbarian: [[1, 2], [4, 3], [10, 4]], fighter: [[1, 3], [4, 4], [10, 5], [16, 6]],
  paladin: [[1, 2]], ranger: [[1, 2]], rogue: [[1, 2]],
};

/** How many kinds of weapon a hero of this class and level masters (0 for a class without Weapon Mastery). */
export function masteryCount(cls, level = 1) {
  const rows = COUNTS[String(cls || '').toLowerCase()] || [];
  return rows.filter(([from]) => (level || 1) >= from).pop()?.[1] || 0;
}

/** A new hero's masteries: the weapons in their pack, in order, as many as they may master. */
export function defaultMasteries(hero, equipmentIds) {
  const n = masteryCount(hero.class, hero.level);
  return [...new Set((equipmentIds || []).filter(id => MASTERY_OF[id]))].slice(0, n);
}

/** The mastery this attack carries: { kind, name, mod, dc }, or null (table rule off, or not a mastered weapon). */
export function masteryFor(hero, item, enabled) {
  const kind = enabled && item?.id && (hero?.masteries || []).includes(item.id) ? MASTERY_OF[item.id] : null;
  if (!kind) return null;
  // The attack's ability modifier is the one on its damage ("1d8+3"): STR, DEX for finesse or ranged, as lk-rules5e chose.
  const dmg = weaponProfile({ id: item.id }, hero)?.damage || '';
  const mod = Number(dmg.match(/([+-]\d+)$/)?.[1] || 0);
  return { kind, name: MASTERIES[kind].name, mod, dc: 8 + mod + profBonus(hero.level) };
}

/**
 * What the mastery does to this attack, or null: `{ text, damage? , vex? }`. Graze deals damage on a miss; Vex gives
 * the attacker advantage next time; the rest are said to the table for the DM to apply.
 */
export function masteryOutcome(m, { hit, targetName = 'the target' }) {
  if (!m) return null;
  if (m.kind === 'graze') return !hit && m.mod > 0 ? { damage: m.mod, text: `Graze: the miss still deals ${m.mod} damage to ${targetName}.` } : null;
  if (!hit) return null;
  switch (m.kind) {
    case 'vex': return { vex: true, text: `Vex: advantage on your next attack against ${targetName}.` };
    case 'topple': return { text: `Topple: ${targetName} makes a DC ${m.dc} Constitution save or falls Prone.` };
    case 'sap': return { text: `Sap: ${targetName} has disadvantage on its next attack.` };
    case 'slow': return { text: `Slow: ${targetName}'s speed drops by 10 ft until your next turn.` };
    case 'push': return { text: `Push: you may push ${targetName} up to 10 ft away.` };
    case 'cleave': return { text: 'Cleave: you may swing at a second creature next to it (once a turn).' };
    case 'nick': return { text: 'Nick: your off-hand attack is part of this Attack action.' };
    default: return null;
  }
}
