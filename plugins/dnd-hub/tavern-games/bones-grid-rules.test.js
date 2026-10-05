import { describe, it, expect } from 'vitest';
import { columnScore, boardScore, place, emptyBoard, hostMove, winner, rerolls, moveValue, isFull } from './bones-grid-rules.js?v=20261014e';

describe('scoring', () => {
  it('multiplies matching faces in a column', () => {
    expect(columnScore([4])).toBe(4);
    expect(columnScore([4, 4])).toBe(16);
    expect(columnScore([4, 4, 4])).toBe(36);
    expect(columnScore([2, 5, 2])).toBe(13);
    expect(boardScore([[6, 6], [1], []])).toBe(25);
  });
});

describe('placing', () => {
  it('smashes the same face in the facing column only', () => {
    const r = place([[], [], []], [[3, 3, 1], [3], []], 0, 3);
    expect(r.mine[0]).toEqual([3]);
    expect(r.theirs).toEqual([[1], [3], []]);
    expect(r.smashed).toBe(2);
  });
  it('refuses a full column', () => expect(() => place([[1, 2, 3], [], []], emptyBoard(), 0, 4)).toThrow());
  it('values a smash as the rival\'s loss', () => expect(moveValue(emptyBoard(), [[5, 5], [], []], 0, 5)).toBe(5 + 20));
});

describe('the host', () => {
  it('a regular host takes the big smash', () => {
    expect(hostMove(emptyBoard(), [[], [6, 6], []], 6, 'regular', () => 0.5)).toBe(1);
  });
  it('a regular host builds on its own pair', () => {
    expect(hostMove([[], [], [4, 4]], emptyBoard(), 4, 'regular', () => 0.5)).toBe(2);
  });
  it('a shark finishes its board when that wins', () => {
    const host = [[6, 6, 6], [6, 6, 6], [5, 5]], hero = [[1], [1], [1]];
    expect(hostMove(host, hero, 2, 'shark', () => 0.5)).toBe(2);
  });
  it('only ever picks an open column', () => {
    for (const skill of ['novice', 'regular', 'shark']) {
      for (let i = 0; i < 30; i++) expect(hostMove([[1, 1, 1], [2, 2, 2], []], emptyBoard(), 1 + (i % 6), skill)).toBe(2);
    }
  });
});

describe('the end', () => {
  it('waits until a board is full, then compares', () => {
    expect(winner([[1], [], []], emptyBoard())).toBeNull();
    const full = [[1, 2, 3], [1, 2, 3], [1, 2, 3]];
    expect(isFull(full)).toBe(true);
    expect(winner(full, [[6], [], []])).toBe('hero');
    expect(winner(full, [[6, 6], [], []])).toBe('host'); // 18 against 24
  });
  it('a draw is a draw (28 each)', () => expect(winner([[6, 1, 1], [1, 1, 1], [1, 1, 1]], [[6, 6], [4], []])).toBe('draw'));
});

describe('rerolls', () => {
  it('come from the stat edge', () => {
    expect(rerolls(1)).toEqual({ hero: 2, host: 0 });
    expect(rerolls(0.4)).toEqual({ hero: 1, host: 0 });
    expect(rerolls(0)).toEqual({ hero: 0, host: 0 });
    expect(rerolls(-0.6)).toEqual({ hero: 0, host: 1 });
  });
});

import { PLAYABLE } from '../lk-tavern.js';
import { GAME_LOADERS } from '../dnd-hub-tavern-games.js';
describe('the game registry', () => {
  it('has code for exactly the games the DM can set up', () => {
    expect(Object.keys(GAME_LOADERS).sort()).toEqual([...PLAYABLE].sort());
  });
});
