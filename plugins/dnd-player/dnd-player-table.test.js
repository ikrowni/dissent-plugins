import { describe, it, expect } from 'vitest';
import { saveBonus, trapPrompt, trapResult, needsMyRoll, deathSaveTurn } from './dnd-player-table.js';

const hero = { level: 1, savingThrows: ['str', 'con'], dex: 14, con: 12 };

describe('saveBonus', () => {
  it('ability modifier, plus proficiency when trained', () => {
    expect(saveBonus(hero, hero, 'dex')).toBe(2);
    expect(saveBonus(hero, hero, 'con')).toBe(3);
  });
});

describe('trapPrompt', () => {
  const trap = { saveAbility: 'dex', saveDC: 13 };
  it('names the DC only with hints on', () => {
    expect(trapPrompt(trap, true)).toBe('Roll a DEX save, DC 13');
    expect(trapPrompt(trap, false)).toBe('Roll a DEX save');
  });
});

describe('trapResult', () => {
  const trap = { damage: 7, saveAbility: 'dex', saveDC: 13 };
  it('halves on a save and says so', () => {
    const r = trapResult(trap, 11, 2, true);
    expect(r.damage).toBe(3);
    expect(r.note).toBe(' DEX save 11+2 = 13 vs DC 13: half damage.');
  });
  it('full damage on a failure; without hints the DC stays hidden', () => {
    const r = trapResult(trap, 5, 2, false);
    expect(r.damage).toBe(7);
    expect(r.note).toBe(' DEX save 5+2 = 7: failed.');
  });
  it('a trap with no save deals its damage', () => {
    expect(trapResult({ damage: 4 }, 20, 5, true)).toEqual({ damage: 4, note: '' });
  });
});

describe('needsMyRoll', () => {
  const init = { active: true, order: [{ type: 'player', userId: 'b', roll: null }, { type: 'player', userId: 'c', roll: 9 }] };
  it('true only while my row has no roll', () => {
    expect(needsMyRoll(init, 'b')).toBe(true);
    expect(needsMyRoll(init, 'c')).toBe(false);
    expect(needsMyRoll({ ...init, active: false }, 'b')).toBe(false);
  });
});

describe('deathSaveTurn', () => {
  const init = { active: true, round: 2, currentIndex: 1, order: [{ type: 'monster', id: 'g' }, { type: 'player', userId: 'b' }] };
  it('my turn at 0 HP, not yet reminded: the turn key', () => {
    expect(deathSaveTurn(init, 'b', { hp: 0 }, null)).toBe('2:1');
  });
  it('once per turn', () => {
    expect(deathSaveTurn(init, 'b', { hp: 0 }, '2:1')).toBe(null);
  });
  it('not when stable, dead, above 0 HP, someone else\'s turn, or while waiting for rolls', () => {
    expect(deathSaveTurn(init, 'b', { hp: 0, stable: true }, null)).toBe(null);
    expect(deathSaveTurn(init, 'b', { hp: 0, dead: true }, null)).toBe(null);
    expect(deathSaveTurn(init, 'b', { hp: 3 }, null)).toBe(null);
    expect(deathSaveTurn(init, 'c', { hp: 0 }, null)).toBe(null);
    expect(deathSaveTurn({ ...init, waiting: true }, 'b', { hp: 0 }, null)).toBe(null);
  });
});
