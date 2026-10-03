// dnd-hub-draft-rules.js — the character creator's rules as pure functions. The full creator's step checks
// and Quick character (dnd-hub-quick.js) both use these, so "a valid hero" means one thing.
import { abilityMod } from './lk-rules5e.js';

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const CANTRIPS_KNOWN = { bard: 2, cleric: 3, druid: 2, sorcerer: 4, warlock: 2, wizard: 3 };
const SPELLS_KNOWN_L1 = { bard: 4, sorcerer: 2, warlock: 2, wizard: 6 }; // wizard: six in the spellbook

/** 1st-level spells a new hero takes. Clerics/druids prepare WIS mod + 1 (min 1); paladins/rangers none until 2. */
export function spellLimitL1(classId, wisScore) {
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

/** Final ability scores: base + race + subrace + a half-elf's two +1s. */
export function draftScores(draft, races) {
  const race = (races || []).find(r => r.id === draft.race);
  const sub = race?.subraces?.find(s => s.id === draft.subrace) || null;
  const out = {};
  for (const a of ABILITY_KEYS) out[a] = (draft.baseScores?.[a] || 0) + bonusFor(race, a) + bonusFor(sub, a);
  if (draft.race === 'half-elf') for (const a of new Set(draft.halfElfBonus || [])) if (a !== 'cha' && a in out) out[a] += 1;
  return out;
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

  if (d.class) {
    const wis = draftScores(d, srd.races).wis;
    if ((d.cantrips || []).length > (CANTRIPS_KNOWN[d.class] ?? 0)) add(5, 'Too many cantrips for your class.');
    if ((d.spells || []).length > spellLimitL1(d.class, wis)) add(5, 'Too many 1st-level spells for your class.');
  }
  if (!String(d.name || '').trim()) add(6, 'Please enter a character name.');
  return out;
}
