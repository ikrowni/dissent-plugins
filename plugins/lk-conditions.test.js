// plugins/lk-conditions.test.js
import { describe, it, expect } from 'vitest';
import { CONDITION_TEXT, conditionText, holdsInPlace, exhaustionNow, exhaustionD20, exhaustedSpeed } from './lk-conditions.js';

const ALL = ['Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed',
  'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];

describe('conditions by rules edition', () => {
  it('says what every condition does, in both editions', () => {
    for (const e of ['2014', '2024']) expect(Object.keys(CONDITION_TEXT[e]).sort()).toEqual(ALL);
    expect(conditionText('Grappled', '2024')).toMatch(/other than|anyone but/);
    expect(conditionText('Grappled', '2014')).not.toMatch(/Disadvantage on attacks/i);
    expect(conditionText('Nope', '2024')).toBe('');
    expect(conditionText('Exhaustion', undefined)).toBe(CONDITION_TEXT['2014'].Exhaustion); // no rules set = 2014
  });
  it('a Stunned creature still moves under 2024 rules, not under 2014', () => {
    expect(holdsInPlace(['Stunned'], '2014')).toBe(true);
    expect(holdsInPlace(['Stunned'], '2024')).toBe(false);
    expect(holdsInPlace(['Prone', 'Grappled'], '2024')).toBe(true);
    expect(holdsInPlace([], '2024')).toBe(false);
  });
});

describe('Exhaustion', () => {
  it('2024: −2 a level on d20 rolls and −5 ft a level of speed', () => {
    expect(exhaustionD20(3, '2024')).toBe(-6);
    expect(exhaustedSpeed(30, 3, '2024')).toBe(15);
    expect(exhaustedSpeed(30, 5, '2024')).toBe(5);
    expect(exhaustionNow(2, '2024')).toBe('−4 to d20 rolls · −10 ft speed');
  });
  it('2014: no d20 penalty (its levels give disadvantage); speed halved from 2, gone from 5', () => {
    expect(exhaustionD20(3, '2014')).toBe(0);
    expect([1, 2, 4, 5].map(n => exhaustedSpeed(30, n, '2014'))).toEqual([30, 15, 15, 0]);
    expect(exhaustedSpeed(25, 2, '2014')).toBe(10); // whole squares
    expect(exhaustionNow(3, '2014')).toBe('Disadvantage on ability checks · Speed halved · Disadvantage on attacks and saves');
  });
  it('none, and death at 6, in both', () => {
    for (const e of ['2014', '2024']) {
      expect([exhaustionD20(0, e), exhaustedSpeed(30, 0, e), exhaustionNow(0, e)]).toEqual([0, 30, '']);
      expect([exhaustedSpeed(30, 6, e), exhaustionNow(6, e)]).toEqual([0, 'Dead (Exhaustion 6).']);
    }
    expect(exhaustedSpeed(30, 'x', '2024')).toBe(30);
  });
});
