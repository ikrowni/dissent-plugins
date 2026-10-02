// plugins/dnd-hub/dnd-hub-char-format.test.js
import { it, expect } from 'vitest';
import { proficiencyLabel, racialBonus, finalScore, modifier } from './dnd-hub-char-format.js';

it('strips the SRD "Skill: " prefix', () => {
  expect(proficiencyLabel('Skill: Insight')).toBe('Insight');
  expect(proficiencyLabel('Light armor')).toBe('Light armor');
});
it('sums race and subrace bonuses for one ability', () => {
  const race = { ability_bonuses: [{ ability: 'CON', bonus: 2 }] };
  const sub = { ability_bonuses: [{ ability: 'WIS', bonus: 1 }] };
  expect(racialBonus(race, sub, 'CON')).toBe(2);
  expect(racialBonus(race, sub, 'WIS')).toBe(1);
  expect(racialBonus(race, null, 'STR')).toBe(0);
});
it('final score and modifier include the racial bonus', () => {
  expect(finalScore(13, 2)).toBe(15);
  expect(modifier(15)).toBe(2);
  expect(modifier(8)).toBe(-1);
});
