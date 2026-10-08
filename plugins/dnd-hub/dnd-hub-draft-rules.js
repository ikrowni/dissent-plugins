// dnd-hub-draft-rules.js — the character creator's rules as pure functions. The full creator's step checks
// and Quick character (dnd-hub-quick.js) both use these, so "a valid hero" means one thing.
import { abilityMod } from './lk-rules5e.js';
import { bgBonusScores, bgIncreases, extraSkillsFor } from './lk-origins2024.js';
import { PREPARED_2024 } from './lk-classes2024.js';

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const CANTRIPS_KNOWN = { bard: 2, cleric: 3, druid: 2, sorcerer: 4, warlock: 2, wizard: 3 };
const SPELLS_KNOWN_L1 = { bard: 4, sorcerer: 2, warlock: 2, wizard: 6 }; // wizard: six in the spellbook

/**
 * 1st-level spells a new hero takes. 2014: clerics/druids prepare WIS mod + 1 (min 1); paladins/rangers none until 2.
 * 2024 (`rules2024`): the class table's prepared spells at level 1 (a wizard still writes six into the book).
 */
export function spellLimitL1(classId, wisScore, rules2024 = false) {
  if (rules2024 && classId !== 'wizard' && PREPARED_2024[classId]) return PREPARED_2024[classId][1];
  if (SPELLS_KNOWN_L1[classId] != null) return SPELLS_KNOWN_L1[classId];
  if (classId === 'cleric' || classId === 'druid') return Math.max(1, abilityMod(wisScore) + 1);
  return 0;
}

/** The class's "choose N skills" from classes.json. */
export function classSkillChoice(classes, classId) {
  const cls = (classes || []).find(c => c.id === classId);
  const pc = (cls?.proficiency_choices || []).find(p => (p.from || []).some(f => String(f).startsWith('Skill: ')));
  return pc ? { choose: pc.choose, from: pc.from.filter(f => f.startsWith('Skill: ')).map(f => f.slice(7)) } : { choose: 0, from: [] };
}

const bonusFor = (r, ab) => (r?.ability_bonuses || [])
  .filter(b => String(b.ability || '').toUpperCase() === ab.toUpperCase())
  .reduce((n, b) => n + (b.bonus || 0), 0);

/**
 * Final ability scores: base + race + subrace + a half-elf's two +1s; with 2024 origins (a background that lists
 * abilities, lk-origins2024.js) the background's +2/+1 or +1/+1/+1 instead (2024 species give none).
 */
export function draftScores(draft, races, backgrounds = null) {
  const race = (races || []).find(r => r.id === draft.race);
  const sub = race?.subraces?.find(s => s.id === draft.subrace) || null;
  const out = {};
  for (const a of ABILITY_KEYS) out[a] = (draft.baseScores?.[a] || 0) + bonusFor(race, a) + bonusFor(sub, a);
  if (draft.race === 'half-elf') for (const a of new Set(draft.halfElfBonus || [])) if (a !== 'cha' && a in out) out[a] += 1;
  const bg = (backgrounds || []).find(b => b.id === draft.background);
  return bg?.abilities ? bgBonusScores(out, bg, draft.bgBonus) : out;
}

/** Every unmet choice, as { step, message } — step = the creator step that fixes it (0 race … 6 description). */
export function validateDraft(d, srd) {
  const out = [];
  const add = (step, message) => out.push({ step, message });
  const race = (srd.races || []).find(r => r.id === d.race);
  if (!race) add(0, 'Please select a race.');
  else if (race.subraces?.length && !race.subraces.some(s => s.id === d.subrace)) add(0, `Please choose your ${race.name} subrace.`);

  const { choose, from } = classSkillChoice(srd.classes, d.class);
  if (!d.class) add(1, 'Please select a class.');
  else if ((d.proficiencyChoices || []).length !== choose || (d.proficiencyChoices || []).some(s => !from.includes(s))) {
    add(1, `Please choose ${choose} skills.`);
  } else if (d.race === 'half-elf' && new Set(d.extraSkills || []).size !== 2) add(1, 'Half-elves choose two more skills.');
  else if (origins2024(srd) && extraSkillsFor(d.race) && new Set(d.extraSkills || []).size !== extraSkillsFor(d.race)) add(1, 'Humans choose one more skill.');

  const b = d.baseScores || {};
  if (d.abilityMethod === 'standard-array') {
    const vals = ABILITY_KEYS.map(a => b[a]);
    if (vals.some(v => !v) || [...vals].sort((x, y) => x - y).join() !== '8,10,12,13,14,15') {
      add(2, 'Assign each of 15, 14, 13, 12, 10 and 8 to one ability.');
    }
  }
  if (out.every(p => p.step !== 2) && d.race === 'half-elf') {
    const he = d.halfElfBonus || [];
    if (!he[0] || !he[1] || he[0] === he[1] || he.includes('cha')) add(2, 'Half-elves choose two different abilities (not Charisma) for +1.');
  }

  // 2024 origins: the background's ability increases are part of the abilities step.
  const bg = (srd.backgrounds || []).find(b => b.id === d.background);
  if (bg?.abilities && !Object.keys(bgIncreases(bg, d.bgBonus)).length) add(2, `Choose your ${bg.name} increases: +2 and +1, or +1 to all three.`);

  if (d.class) {
    const wis = draftScores(d, srd.races, srd.backgrounds).wis;
    if ((d.cantrips || []).length > (CANTRIPS_KNOWN[d.class] ?? 0)) add(5, 'Too many cantrips for your class.');
    if ((d.spells || []).length > spellLimitL1(d.class, wis, origins2024(srd))) add(5, 'Too many 1st-level spells for your class.');
  }
  if (!String(d.name || '').trim()) add(6, 'Please enter a character name.');
  return out;
}

/** The 2024 origins are in play when the backgrounds offered list their abilities (lk-origins2024.js). */
export const origins2024 = srd => !!(srd?.backgrounds || []).some(b => b.abilities);
