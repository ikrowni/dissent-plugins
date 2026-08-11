import { describe, it, expect } from 'vitest';
import {
  pickKey, setBlock, blockedTeams, isBlocked,
  setInterest, interestCounts, teamsInterestedIn, tradeMatches,
} from './trade-block.js';

// t1 owns p1/p2, t2 owns p3, t3 owns p4.
const OWNER = { p1: 't1', p2: 't1', p3: 't2', p4: 't3' };
const ownerOf = (p) => OWNER[p] ?? null;
const owns = (team, p) => ownerOf(p) === team;

describe('pickKey', () => {
  it('is stable and value-based', () => {
    expect(pickKey({ season: 2027, round: 1, slot: 't1' }))
      .toBe(pickKey({ season: 2027, round: 1, slot: 't1' }));
  });

  it('separates different picks', () => {
    expect(pickKey({ season: 2027, round: 1, slot: 't1' }))
      .not.toBe(pickKey({ season: 2027, round: 2, slot: 't1' }));
  });

  it('is empty for nothing', () => {
    expect(pickKey(null)).toBe('');
  });
});

describe('setBlock', () => {
  it('records the players a team is offering', () => {
    const b = setBlock({}, 't1', { players: ['p1', 'p2'] }, owns);
    expect(b.t1.players).toEqual(['p1', 'p2']);
  });

  // ⚠️ The whole reason a block is worth having over a chat message.
  it('refuses to block a player the team does not own', () => {
    const b = setBlock({}, 't1', { players: ['p1', 'p3'] }, owns);
    expect(b.t1.players).toEqual(['p1']);
  });

  it('blocks draft picks too', () => {
    const b = setBlock({}, 't1', { picks: [{ season: 2027, round: 1, slot: 't1' }] }, owns);
    expect(b.t1.picks).toEqual([{ season: 2027, round: 1, slot: 't1' }]);
  });

  it('dedupes players and picks', () => {
    const b = setBlock({}, 't1', {
      players: ['p1', 'p1'],
      picks: [{ season: 2027, round: 1, slot: 't1' }, { season: 2027, round: 1, slot: 't1' }],
    }, owns);
    expect(b.t1.players).toEqual(['p1']);
    expect(b.t1.picks).toHaveLength(1);
  });

  it('REPLACES rather than merges, so unblocking works', () => {
    let b = setBlock({}, 't1', { players: ['p1', 'p2'] }, owns);
    b = setBlock(b, 't1', { players: ['p1'] }, owns);
    expect(b.t1.players).toEqual(['p1']);
  });

  // ⚠️ An empty entry must be deleted, or every team that ever opened the
  // screen shows as "on the block" with nothing on it.
  it('deletes the entry when the block is emptied', () => {
    let b = setBlock({}, 't1', { players: ['p1'] }, owns);
    b = setBlock(b, 't1', { players: [] }, owns);
    expect(b.t1).toBeUndefined();
  });

  it('does not mutate the map it was given', () => {
    const before = {};
    setBlock(before, 't1', { players: ['p1'] }, owns);
    expect(before).toEqual({});
  });

  it('ignores a missing team', () => {
    expect(setBlock({}, '', { players: ['p1'] }, owns)).toEqual({});
  });
});

describe('blockedTeams / isBlocked', () => {
  const block = setBlock({}, 't1', { players: ['p1'] }, owns);

  it('lists teams offering something', () => {
    expect(blockedTeams(block)).toEqual(['t1']);
  });

  it('answers whether one player is on any block', () => {
    expect(isBlocked(block, 'p1')).toBe(true);
    expect(isBlocked(block, 'p3')).toBe(false);
  });

  it('is empty-safe', () => {
    expect(blockedTeams()).toEqual([]);
    expect(isBlocked({}, 'p1')).toBe(false);
    expect(isBlocked(block, null)).toBe(false);
  });
});

describe('setInterest', () => {
  it('records what a team wants', () => {
    const i = setInterest({}, 't2', ['p1'], ownerOf);
    expect(i.t2).toEqual(['p1']);
  });

  // ⚠️ Self-interest would inflate the owner's own heart count.
  it('drops a team\'s interest in its own player', () => {
    const i = setInterest({}, 't1', ['p1', 'p3'], ownerOf);
    expect(i.t1).toEqual(['p3']);
  });

  it('dedupes', () => {
    expect(setInterest({}, 't2', ['p1', 'p1'], ownerOf).t2).toEqual(['p1']);
  });

  it('deletes the entry when cleared', () => {
    let i = setInterest({}, 't2', ['p1'], ownerOf);
    i = setInterest(i, 't2', [], ownerOf);
    expect(i.t2).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const before = {};
    setInterest(before, 't2', ['p1'], ownerOf);
    expect(before).toEqual({});
  });
});

describe('interestCounts', () => {
  it('counts how many teams want each player', () => {
    const i = { t2: ['p1'], t3: ['p1', 'p2'] };
    expect(interestCounts(i)).toEqual({ p1: 2, p2: 1 });
  });

  it('counts a team once even if it lists a player twice', () => {
    expect(interestCounts({ t2: ['p1', 'p1'] })).toEqual({ p1: 1 });
  });

  it('is empty-safe', () => {
    expect(interestCounts()).toEqual({});
  });
});

describe('teamsInterestedIn', () => {
  const i = { t3: ['p1'], t2: ['p1'] };

  it('names the teams, sorted for stability', () => {
    expect(teamsInterestedIn(i, 'p1')).toEqual(['t2', 't3']);
  });

  it('is empty for an unwanted player', () => {
    expect(teamsInterestedIn(i, 'p4')).toEqual([]);
    expect(teamsInterestedIn(i, null)).toEqual([]);
  });
});

describe('tradeMatches', () => {
  it('finds a team that wants one of mine', () => {
    const out = tradeMatches({ interest: { t2: ['p1'] }, teamId: 't1', ownerOf });
    expect(out).toEqual([{ teamId: 't2', theyWant: ['p1'], iWant: [] }]);
  });

  it('finds a team blocking something I want', () => {
    const block = setBlock({}, 't2', { players: ['p3'] }, owns);
    const out = tradeMatches({ block, interest: { t1: ['p3'] }, teamId: 't1', ownerOf });
    expect(out).toEqual([{ teamId: 't2', theyWant: [], iWant: ['p3'] }]);
  });

  // ⚠️ THE ORDERING IS THE FEATURE. A mutual match must outrank a one-sided one,
  // otherwise the screen tells a manager nothing they could not read themselves.
  it('ranks a mutual match above a one-sided one', () => {
    const block = setBlock({}, 't2', { players: ['p3'] }, owns);
    const out = tradeMatches({
      block,
      interest: { t1: ['p3'], t2: ['p1'], t3: ['p2'] },
      teamId: 't1',
      ownerOf,
    });
    expect(out[0].teamId).toBe('t2');
    expect(out[0].theyWant).toEqual(['p1']);
    expect(out[0].iWant).toEqual(['p3']);
    expect(out[1].teamId).toBe('t3');
  });

  // ⚠️ THE GUARD THE FIRST 30 TESTS MISSED. Above, the mutual partner (t2) also
  // sorts first alphabetically, so a purely alphabetical sort passes. Here the
  // mutual partner is t9 and the one-sided is t2 — now only real ranking works.
  it('ranks by overlap even when the mutual partner sorts last alphabetically', () => {
    const owner = { p1: 't1', p9: 't9' };
    const own = (t, p) => owner[p] === t;
    const block = setBlock({}, 't9', { players: ['p9'] }, own);
    const out = tradeMatches({
      block,
      interest: { t1: ['p9'], t9: ['p1'], t2: ['p1'] },
      teamId: 't1',
      ownerOf: (p) => owner[p] ?? null,
    });
    expect(out.map((m) => m.teamId)).toEqual(['t9', 't2']);
  });

  it('never matches me with myself', () => {
    const block = setBlock({}, 't1', { players: ['p1'] }, owns);
    const out = tradeMatches({ block, interest: { t1: ['p1'] }, teamId: 't1', ownerOf });
    expect(out).toEqual([]);
  });

  it('ignores interest in players I do not own', () => {
    const out = tradeMatches({ interest: { t2: ['p4'] }, teamId: 't1', ownerOf });
    expect(out).toEqual([]);
  });

  it('is empty-safe', () => {
    expect(tradeMatches({})).toEqual([]);
    expect(tradeMatches({ teamId: 't1' })).toEqual([]);
  });
});
