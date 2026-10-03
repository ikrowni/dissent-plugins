// dnd-hub-forge-shape.js — the Hero Forge's guided steps after race and class (owner, 2026-10-03: "after choosing
// race and class it guides the user through building the rest"). Pure: which steps apply and the small rules each
// step needs. The draft starts as Quick character's suggestion (dnd-hub-quick.js quickBuild), so every step opens
// with a sensible choice already made; dnd-hub-forge.js shows them, dnd-hub-forge-shape-view.js draws them.
import { ABILITY_KEYS, CANTRIPS_KNOWN, classSkillChoice, draftScores, spellLimitL1 } from './dnd-hub-draft-rules.js';
import { skillProficiencies } from './lk-rules5e.js';

/** The guided steps for this draft, in order. A choice with one option is not a step. */
export function shapeSteps(draft, srd) {
  const race = (srd.races || []).find(r => r.id === draft.race);
  const out = [];
  if ((race?.subraces || []).length > 1) out.push('heritage');
  out.push('abilities');
  if (classSkillChoice(srd.classes, draft.class).choose > 0 || draft.race === 'half-elf') out.push('skills');
  if ((srd.backgrounds || []).length > 1) out.push('background');
  out.push('gear');
  const sp = spellStep(draft, srd);
  if (sp.cantrips > 0 || sp.spells > 0) out.push('spells');
  out.push('details');
  return out;
}

/** Give `ability` the score `value`; whichever ability had that value takes this one's old score. */
export function swapScore(base, ability, value) {
  const out = { ...base };
  const other = ABILITY_KEYS.find(a => a !== ability && out[a] === value);
  if (other) out[other] = out[ability];
  out[ability] = value;
  return out;
}

/** Six scores of 4d6 drop the lowest, best first into `priority` (the class's abilities, best first). */
export function rollScores(priority, rng = Math.random) {
  const d6 = () => 1 + Math.floor(rng() * 6);
  const one = () => { const r = [d6(), d6(), d6(), d6()].sort((a, b) => a - b); return r[1] + r[2] + r[3]; };
  const rolls = Array.from({ length: 6 }, one).sort((a, b) => b - a);
  const order = [...priority, ...ABILITY_KEYS.filter(a => !priority.includes(a))];
  return Object.fromEntries(order.slice(0, 6).map((a, i) => [a, rolls[i]]));
}

/** Add `id` (up to `max`) or take it away. */
export function toggleLimited(list, id, max) {
  const l = list || [];
  if (l.includes(id)) return l.filter(x => x !== id);
  return l.length < max ? [...l, id] : l;
}

/** Skills: how many to choose, from which, and those the hero already has (race, background). */
export function skillStep(draft, srd) {
  const bg = (srd.backgrounds || []).find(b => b.id === draft.background);
  const already = Object.keys(skillProficiencies({ race: draft.race }, bg));
  const { choose, from } = classSkillChoice(srd.classes, draft.class);
  return { choose, from: from.filter(s => !already.includes(s)), already, halfElf: draft.race === 'half-elf' };
}

/** Spells at level 1: how many cantrips and spells, and the class's options. */
export function spellStep(draft, srd) {
  const cls = (srd.classes || []).find(c => c.id === draft.class);
  const list = (srd.spells || []).filter(s => Array.isArray(s.classes) && cls && s.classes.includes(cls.name));
  const spells = spellLimitL1(draft.class, draftScores(draft, srd.races).wis);
  return { cantrips: CANTRIPS_KNOWN[draft.class] ?? 0, spells,
    prepared: draft.class === 'cleric' || draft.class === 'druid',
    options: { cantrips: list.filter(s => s.level === 0), spells: spells > 0 ? list.filter(s => s.level === 1) : [] } };
}

/** The names of the items in the draft's pack. */
export function kitNames(draft, srd) {
  return (draft.equipment || []).map(id => (srd.equipment || []).find(e => e.id === id)?.name || id);
}
