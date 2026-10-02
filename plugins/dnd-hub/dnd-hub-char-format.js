// plugins/dnd-hub/dnd-hub-char-format.js — display helpers for the character creator.
export const proficiencyLabel = s => String(s).replace(/^Skill:\s*/i, '');
export function racialBonus(race, subrace, ability) {
  const sum = r => (r?.ability_bonuses || [])
    .filter(b => (b.ability || b.ability_score?.name || '').toUpperCase() === ability)
    .reduce((n, b) => n + (b.bonus || 0), 0);
  return sum(race) + sum(subrace);
}
export const finalScore = (base, bonus) => (base || 0) + (bonus || 0);
export const modifier = score => Math.floor((score - 10) / 2);
