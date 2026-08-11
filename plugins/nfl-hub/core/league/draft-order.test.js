import { describe, it, expect } from 'vitest';
import {
  DRAFT_TYPE, generateOrder, applyTradedPicks, pickAt, picksByOwner, draftSlotOf,
} from './draft-order.js';

const four = ['a', 'b', 'c', 'd'];

describe('generateOrder — snake', () => {
  const picks = generateOrder(four, 3, DRAFT_TYPE.SNAKE);

  it('produces every pick exactly once, numbered from 1', () => {
    expect(picks).toHaveLength(12);
    expect(picks.map((p) => p.overall)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  // ⚠️ The round-parity bug: an off-by-one runs round 2 forwards, which looks
  // fine in a 2-round test and is wrong for every real draft.
  it('runs odd rounds forwards and even rounds backwards', () => {
    expect(picks.filter((p) => p.round === 1).map((p) => p.slot)).toEqual(['a', 'b', 'c', 'd']);
    expect(picks.filter((p) => p.round === 2).map((p) => p.slot)).toEqual(['d', 'c', 'b', 'a']);
    expect(picks.filter((p) => p.round === 3).map((p) => p.slot)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('gives the turn team back-to-back picks across the turn', () => {
    // Pick 4 and pick 5 are both team d — the defining property of a snake.
    expect(pickAt(picks, 4).slot).toBe('d');
    expect(pickAt(picks, 5).slot).toBe('d');
  });

  it('gives every team the same number of picks', () => {
    expect(picksByOwner(picks)).toEqual({ a: 3, b: 3, c: 3, d: 3 });
  });

  it('numbers pickInRound from 1 within each round', () => {
    expect(pickAt(picks, 5)).toMatchObject({ round: 2, pickInRound: 1 });
    expect(pickAt(picks, 8)).toMatchObject({ round: 2, pickInRound: 4 });
  });
});

describe('generateOrder — linear', () => {
  const picks = generateOrder(four, 3, DRAFT_TYPE.LINEAR);

  it('runs every round in the same direction', () => {
    for (const round of [1, 2, 3]) {
      expect(picks.filter((p) => p.round === round).map((p) => p.slot)).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('differs from snake exactly at the even rounds', () => {
    const snake = generateOrder(four, 2, DRAFT_TYPE.SNAKE);
    expect(picks.filter((p) => p.round === 1)).toEqual(snake.filter((p) => p.round === 1));
    expect(picks.filter((p) => p.round === 2)).not.toEqual(snake.filter((p) => p.round === 2));
  });
});

describe('generateOrder — degenerate input', () => {
  it('returns an empty order rather than throwing', () => {
    expect(generateOrder([], 3)).toEqual([]);
    expect(generateOrder(four, 0)).toEqual([]);
    expect(generateOrder(null, 3)).toEqual([]);
    expect(generateOrder(four, 1.5)).toEqual([]);
  });

  it('handles a one-team draft without reversing itself into nonsense', () => {
    const picks = generateOrder(['solo'], 3, DRAFT_TYPE.SNAKE);
    expect(picks.map((p) => p.overall)).toEqual([1, 2, 3]);
    expect(picks.every((p) => p.slot === 'solo')).toBe(true);
  });
});

// ⚠️ slot vs owner is the distinction that only matters once, and then matters
// permanently: collapse them and the first traded pick goes to the wrong team.
describe('applyTradedPicks', () => {
  const picks = generateOrder(four, 3, DRAFT_TYPE.SNAKE);

  it('moves ownership without moving the draft position', () => {
    const traded = applyTradedPicks(picks, [{ round: 2, slot: 'a', to: 'c' }]);
    const p = traded.find((x) => x.round === 2 && x.slot === 'a');
    expect(p.owner).toBe('c');
    expect(p.slot).toBe('a');
    // Position in the order is untouched.
    expect(p.overall).toBe(pickAt(picks, p.overall).overall);
  });

  it('counts a traded pick for whoever will actually make it', () => {
    const traded = applyTradedPicks(picks, [{ round: 2, slot: 'a', to: 'c' }]);
    expect(picksByOwner(traded)).toEqual({ a: 2, b: 3, c: 4, d: 3 });
  });

  it('addresses picks by round and slot, not by overall number', () => {
    // The same round-2 pick has a different overall in snake vs linear, but the
    // trade addresses it identically either way.
    const linear = generateOrder(four, 3, DRAFT_TYPE.LINEAR);
    const t = [{ round: 2, slot: 'a', to: 'c' }];
    expect(applyTradedPicks(picks, t).find((p) => p.round === 2 && p.slot === 'a').owner).toBe('c');
    expect(applyTradedPicks(linear, t).find((p) => p.round === 2 && p.slot === 'a').owner).toBe('c');
  });

  it('supports a pick traded onward more than once', () => {
    const traded = applyTradedPicks(picks, [
      { round: 1, slot: 'a', to: 'b' },
      { round: 1, slot: 'a', to: 'd' },
    ]);
    expect(traded.find((p) => p.round === 1 && p.slot === 'a').owner).toBe('d');
  });

  it('ignores a stale trade rather than refusing to start the draft', () => {
    const traded = applyTradedPicks(picks, [{ round: 99, slot: 'a', to: 'c' }, null]);
    expect(traded).toEqual(picks);
  });

  it('does not mutate the original order', () => {
    applyTradedPicks(picks, [{ round: 1, slot: 'a', to: 'c' }]);
    expect(picks.find((p) => p.round === 1 && p.slot === 'a').owner).toBe('a');
  });
});

describe('draftSlotOf', () => {
  const picks = applyTradedPicks(generateOrder(four, 3), [{ round: 1, slot: 'a', to: 'c' }]);

  // A team that traded away its first-rounder still occupies its position.
  it('reads the draft position from slot, not owner', () => {
    expect(draftSlotOf(picks, 'a')).toBe(1);
    expect(draftSlotOf(picks, 'd')).toBe(4);
  });

  it('returns null for a team with no slot', () => {
    expect(draftSlotOf(picks, 'ghost')).toBe(null);
  });
});

describe('3rd Round Reversal', () => {
  const teams = ['a', 'b', 'c', 'd'];
  const roundOf = (picks, r) => picks.filter((p) => p.round === r).map((p) => p.slot);

  it('runs rounds 1 and 2 exactly like a snake', () => {
    const p = generateOrder(teams, 5, DRAFT_TYPE.THIRD_ROUND_REVERSAL);
    expect(roundOf(p, 1)).toEqual(['a', 'b', 'c', 'd']);
    expect(roundOf(p, 2)).toEqual(['d', 'c', 'b', 'a']);
  });

  // ⚠️ THE WHOLE POINT. In a plain snake, round 3 runs forward and the team
  // holding 1.01 picks back-to-back across the 2/3 turn. 3RR reverses again so
  // the team that picked LAST in round one opens round three instead.
  it('reverses again in round 3 instead of turning', () => {
    const p = generateOrder(teams, 5, DRAFT_TYPE.THIRD_ROUND_REVERSAL);
    expect(roundOf(p, 3)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('kills the 1.01 holder\'s back-to-back at the 2/3 turn', () => {
    const p = generateOrder(teams, 3, DRAFT_TYPE.THIRD_ROUND_REVERSAL);
    const r2 = roundOf(p, 2);
    const r3 = roundOf(p, 3);
    expect(r2[r2.length - 1]).toBe('a');
    expect(r3[0]).not.toBe('a');
  });

  it('snakes normally from round 4 with the parity flipped', () => {
    const p = generateOrder(teams, 6, DRAFT_TYPE.THIRD_ROUND_REVERSAL);
    expect(roundOf(p, 4)).toEqual(['a', 'b', 'c', 'd']);
    expect(roundOf(p, 5)).toEqual(['d', 'c', 'b', 'a']);
    expect(roundOf(p, 6)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('differs from a plain snake from round 3 onward', () => {
    const snake = generateOrder(teams, 4, DRAFT_TYPE.SNAKE);
    const rr = generateOrder(teams, 4, DRAFT_TYPE.THIRD_ROUND_REVERSAL);
    expect(roundOf(rr, 1)).toEqual(roundOf(snake, 1));
    expect(roundOf(rr, 2)).toEqual(roundOf(snake, 2));
    expect(roundOf(rr, 3)).not.toEqual(roundOf(snake, 3));
    expect(roundOf(rr, 4)).not.toEqual(roundOf(snake, 4));
  });

  it('still numbers picks continuously', () => {
    const p = generateOrder(teams, 3, DRAFT_TYPE.THIRD_ROUND_REVERSAL);
    expect(p.map((x) => x.overall)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('is a no-op distinction in a two-round draft', () => {
    const snake = generateOrder(teams, 2, DRAFT_TYPE.SNAKE);
    const rr = generateOrder(teams, 2, DRAFT_TYPE.THIRD_ROUND_REVERSAL);
    expect(rr).toEqual(snake);
  });
});
