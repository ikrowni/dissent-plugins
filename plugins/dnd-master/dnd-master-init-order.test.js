import { describe, it, expect } from 'vitest';
import { sortOrder, isWaiting, startInitiative, withPlayerRoll, rollMissing, nextTurn, isDefeated } from './dnd-master-init-order.js';

const bob = { type: 'player', userId: 'b', name: 'Bob', roll: null };
const cat = { type: 'player', userId: 'c', name: 'Cat', roll: null };
const gob = { type: 'monster', id: 'g', name: 'Goblin', roll: 12 };

describe('startInitiative', () => {
  it('waits while any player has not rolled; unrolled rows go last', () => {
    const init = startInitiative([bob, gob]);
    expect(init).toMatchObject({ active: true, round: 1, currentIndex: 0, waiting: true });
    expect(init.order.map(c => c.name)).toEqual(['Goblin', 'Bob']);
  });
  it('does not wait when every row has a roll', () => {
    expect(startInitiative([{ ...bob, roll: 4 }, gob]).waiting).toBe(false);
  });
});

describe('withPlayerRoll', () => {
  it('fills that player\'s roll and keeps waiting for the rest', () => {
    const init = withPlayerRoll(startInitiative([bob, cat, gob]), 'b', 15);
    expect(init.waiting).toBe(true);
    expect(init.order.find(c => c.userId === 'b').roll).toBe(15);
  });
  it('sorts and starts at the top once the last roll is in', () => {
    let init = withPlayerRoll(startInitiative([bob, cat, gob]), 'b', 15);
    init = withPlayerRoll(init, 'c', 3);
    expect(init.waiting).toBe(false);
    expect(init.currentIndex).toBe(0);
    expect(init.order.map(c => c.name)).toEqual(['Bob', 'Goblin', 'Cat']);
  });
  it('ignores a second roll from the same player, and a roll from a stranger', () => {
    const once = withPlayerRoll(startInitiative([bob, gob]), 'b', 15);
    expect(withPlayerRoll(once, 'b', 20)).toBe(once);
    const init = startInitiative([bob, gob]);
    expect(withPlayerRoll(init, 'zed', 20)).toBe(init);
  });
  it('ignores a roll when no fight is on', () => {
    expect(withPlayerRoll(null, 'b', 10)).toBe(null);
  });
});

describe('rollMissing', () => {
  it('rolls for everyone still missing, then sorts', () => {
    const init = rollMissing(startInitiative([bob, cat, gob]), c => (c.userId === 'b' ? 20 : 1));
    expect(isWaiting(init)).toBe(false);
    expect(init.waiting).toBe(false);
    expect(init.order.map(c => c.name)).toEqual(['Bob', 'Goblin', 'Cat']);
  });
});

describe('sortOrder', () => {
  it('highest first, without changing the input', () => {
    const order = [gob, { ...bob, roll: 18 }];
    expect(sortOrder(order).map(c => c.name)).toEqual(['Bob', 'Goblin']);
    expect(order[0].name).toBe('Goblin');
  });
});

describe('nextTurn (defeated monsters take no turns)', () => {
  const order = [
    { type: 'monster', hp: 7 }, { type: 'player', hp: 0 }, { type: 'monster', hp: 0 }, { type: 'monster', hp: 3 },
  ];
  it('skips a monster at 0 HP but never a hero at 0', () => {
    expect(isDefeated(order[2])).toBe(true);
    expect(isDefeated(order[1])).toBe(false);
    expect(nextTurn(order, 1, 1)).toEqual({ index: 3, wrapped: false });
    expect(nextTurn(order, 0, 1)).toEqual({ index: 1, wrapped: false });
  });
  it('a new round when it passes the top', () => {
    expect(nextTurn(order, 3, 1)).toEqual({ index: 0, wrapped: true });
    expect(nextTurn([{ type: 'monster', hp: 0 }, { type: 'player', hp: 5 }], 1, 1)).toEqual({ index: 1, wrapped: true });
  });
  it('backwards skips too, and never counts a round', () => {
    expect(nextTurn(order, 3, -1)).toEqual({ index: 1, wrapped: false });
  });
  it('everyone defeated: it just steps on', () => {
    const dead = [{ type: 'monster', hp: 0 }, { type: 'monster', hp: 0 }];
    expect(nextTurn(dead, 0, 1)).toEqual({ index: 1, wrapped: false });
    expect(nextTurn([], 0, 1)).toEqual({ index: 0, wrapped: false });
  });
});
