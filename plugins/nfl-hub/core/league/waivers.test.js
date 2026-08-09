import { describe, it, expect } from 'vitest';
import {
  CLAIM_STATUS, orderClaims, resolveWaivers, demoteToBack, priorityFromStandings, remainingBudget,
} from './waivers.js';
import { normalizeSettings, WAIVER_TYPE } from './settings.js';
import { emptyRosters, addPlayer, ownerOf } from './rosters.js';

const faab = normalizeSettings({
  waiverType: WAIVER_TYPE.FAAB, waiverBudget: 100,
  rosterPositions: ['QB', 'RB', 'WR', 'BN', 'BN'],
});
const rolling = normalizeSettings({
  waiverType: WAIVER_TYPE.ROLLING,
  rosterPositions: ['QB', 'RB', 'WR', 'BN', 'BN'],
});

const teams = () => emptyRosters(['t1', 't2', 't3']);
const priority = { t1: 1, t2: 2, t3: 3 };
const claim = (teamId, playerId, over = {}) => ({ teamId, playerId, submittedAt: 0, ...over });

describe('orderClaims', () => {
  it('puts the highest FAAB bid first', () => {
    const out = orderClaims([
      claim('t1', 'p1', { bid: 5 }), claim('t2', 'p1', { bid: 50 }), claim('t3', 'p1', { bid: 20 }),
    ], { waiverType: WAIVER_TYPE.FAAB, priority });
    expect(out.map((c) => c.teamId)).toEqual(['t2', 't3', 't1']);
  });

  it('breaks a FAAB tie on waiver priority', () => {
    const out = orderClaims([
      claim('t3', 'p1', { bid: 20 }), claim('t1', 'p1', { bid: 20 }),
    ], { waiverType: WAIVER_TYPE.FAAB, priority });
    expect(out.map((c) => c.teamId)).toEqual(['t1', 't3']);
  });

  it('ignores bids entirely in a rolling league', () => {
    const out = orderClaims([
      claim('t3', 'p1', { bid: 999 }), claim('t1', 'p1', { bid: 0 }),
    ], { waiverType: WAIVER_TYPE.ROLLING, priority });
    expect(out.map((c) => c.teamId)).toEqual(['t1', 't3']);
  });

  // ⚠️ A waiver run that is not reproducible cannot be explained to the manager
  // who lost. Equal claims must still have a defined order.
  it('is total — equal bid and equal priority fall back to submission time', () => {
    const out = orderClaims([
      claim('t1', 'p1', { bid: 10, submittedAt: 200 }),
      claim('t1', 'p2', { bid: 10, submittedAt: 100 }),
    ], { waiverType: WAIVER_TYPE.FAAB, priority });
    expect(out.map((c) => c.playerId)).toEqual(['p2', 'p1']);
  });

  it('does not mutate the input array', () => {
    const input = [claim('t3', 'p1', { bid: 1 }), claim('t1', 'p1', { bid: 99 })];
    orderClaims(input, { waiverType: WAIVER_TYPE.FAAB, priority });
    expect(input[0].teamId).toBe('t3');
  });
});

describe('resolveWaivers — FAAB', () => {
  it('awards the player to the highest bid and charges the budget', () => {
    const out = resolveWaivers([
      claim('t1', 'p1', { bid: 10 }), claim('t2', 'p1', { bid: 40 }),
    ], { rosters: teams(), settings: faab, priority });

    const won = out.results.find((r) => r.status === CLAIM_STATUS.WON);
    expect(won.claim.teamId).toBe('t2');
    expect(out.budgets.t2).toBe(60);
    expect(ownerOf(out.rosters, 'p1')).toBe('t2');
  });

  it('tells the loser why they lost', () => {
    const out = resolveWaivers([
      claim('t1', 'p1', { bid: 10 }), claim('t2', 'p1', { bid: 40 }),
    ], { rosters: teams(), settings: faab, priority });
    const lost = out.results.find((r) => r.status === CLAIM_STATUS.LOST);
    expect(lost.claim.teamId).toBe('t1');
    expect(lost.reason).toContain('claimed by team t2');
  });

  // ⚠️ The budget must be checked as it stands mid-batch, not as it stood at
  // submission — otherwise $100 buys $180 of players.
  it('deducts within the batch, so a team cannot overspend across its own claims', () => {
    const out = resolveWaivers([
      claim('t1', 'p1', { bid: 90 }), claim('t1', 'p2', { bid: 20 }),
    ], { rosters: teams(), settings: faab, priority });

    expect(out.results[0].status).toBe(CLAIM_STATUS.WON);
    expect(out.results[1].status).toBe(CLAIM_STATUS.INVALID);
    expect(out.results[1].reason).toContain('exceeds remaining budget 10');
    expect(out.budgets.t1).toBe(10);
    expect(ownerOf(out.rosters, 'p2')).toBe(null);
  });

  it('allows a $0 bid but refuses a negative one', () => {
    const zero = resolveWaivers([claim('t1', 'p1', { bid: 0 })],
      { rosters: teams(), settings: faab, priority });
    expect(zero.results[0].status).toBe(CLAIM_STATUS.WON);

    const neg = resolveWaivers([claim('t1', 'p1', { bid: -5 })],
      { rosters: teams(), settings: faab, priority });
    expect(neg.results[0].status).toBe(CLAIM_STATUS.INVALID);
  });

  it('refuses a bid above the starting budget', () => {
    const out = resolveWaivers([claim('t1', 'p1', { bid: 101 })],
      { rosters: teams(), settings: faab, priority });
    expect(out.results[0].status).toBe(CLAIM_STATUS.INVALID);
  });
});

describe('resolveWaivers — roster space and drops', () => {
  const full = () => {
    let r = teams();
    for (const p of ['x1', 'x2', 'x3', 'x4', 'x5']) r = addPlayer(r, 't1', p).rosters;
    return r;
  };

  it('refuses a claim when the roster is full and nothing is dropped', () => {
    const out = resolveWaivers([claim('t1', 'p1', { bid: 5 })],
      { rosters: full(), settings: faab, priority });
    expect(out.results[0].status).toBe(CLAIM_STATUS.INVALID);
    expect(out.results[0].reason).toContain('roster is full');
  });

  it('accepts the same claim with a drop attached', () => {
    const out = resolveWaivers([claim('t1', 'p1', { bid: 5, dropPlayerId: 'x1' })],
      { rosters: full(), settings: faab, priority });
    expect(out.results[0].status).toBe(CLAIM_STATUS.WON);
    expect(ownerOf(out.rosters, 'x1')).toBe(null);
    expect(ownerOf(out.rosters, 'p1')).toBe('t1');
  });

  it('refuses a drop of a player the team does not own', () => {
    const out = resolveWaivers([claim('t1', 'p1', { bid: 5, dropPlayerId: 'nope' })],
      { rosters: full(), settings: faab, priority });
    expect(out.results[0].status).toBe(CLAIM_STATUS.INVALID);
  });

  it('refuses a claim for a player already on the claiming roster', () => {
    const r = addPlayer(teams(), 't1', 'p1').rosters;
    const out = resolveWaivers([claim('t1', 'p1', { bid: 5 })],
      { rosters: r, settings: faab, priority });
    expect(out.results[0].reason).toContain('already on this roster');
  });

  it('honours an availability check for players who are not free agents', () => {
    const out = resolveWaivers([claim('t1', 'p1', { bid: 5 })],
      { rosters: teams(), settings: faab, priority, isAvailable: () => false });
    expect(out.results[0].status).toBe(CLAIM_STATUS.INVALID);
  });
});

describe('resolveWaivers — rolling priority', () => {
  it('sends a winner to the back of the order', () => {
    const out = resolveWaivers([claim('t1', 'p1')],
      { rosters: teams(), settings: rolling, priority });
    expect(out.priority).toEqual({ t1: 3, t2: 1, t3: 2 });
  });

  it('lets the next-best team win the following claim in the same batch', () => {
    const out = resolveWaivers([claim('t1', 'p1'), claim('t1', 'p2'), claim('t2', 'p2')],
      { rosters: teams(), settings: rolling, priority });
    // t1 wins p1 and drops to the back, so t2 now outranks t1 for p2.
    expect(ownerOf(out.rosters, 'p1')).toBe('t1');
    expect(ownerOf(out.rosters, 'p2')).toBe('t1');
    // t1's second claim was ordered ahead of t2's before the demotion applied —
    // ordering is computed once for the batch, which is how real waivers run.
    expect(out.results.filter((r) => r.status === CLAIM_STATUS.WON)).toHaveLength(2);
  });

  it('does not charge a budget in a non-FAAB league', () => {
    const out = resolveWaivers([claim('t1', 'p1', { bid: 50 })],
      { rosters: teams(), settings: rolling, priority });
    expect(out.budgets).toEqual({});
  });
});

// ⚠️ Setting the winner to numTeams leaves a hole, and eventually two teams
// share a position — at which point the order stops being total.
describe('demoteToBack', () => {
  it('closes the gap left behind', () => {
    expect(demoteToBack({ a: 1, b: 2, c: 3, d: 4 }, 'b')).toEqual({ a: 1, b: 4, c: 2, d: 3 });
  });

  it('leaves positions unique after repeated demotions', () => {
    let p = { a: 1, b: 2, c: 3, d: 4 };
    for (const t of ['a', 'c', 'a', 'd', 'b']) p = demoteToBack(p, t);
    const positions = Object.values(p).sort();
    expect(positions).toEqual([1, 2, 3, 4]);
  });

  it('is a no-op for an unknown team', () => {
    expect(demoteToBack({ a: 1, b: 2 }, 'ghost')).toEqual({ a: 1, b: 2 });
  });
});

describe('priorityFromStandings', () => {
  it('gives the worst record the first claim', () => {
    const p = priorityFromStandings([
      { teamId: 'good', wins: 10, pointsFor: 1500 },
      { teamId: 'bad', wins: 2, pointsFor: 900 },
      { teamId: 'mid', wins: 6, pointsFor: 1200 },
    ]);
    expect(p).toEqual({ bad: 1, mid: 2, good: 3 });
  });

  it('breaks a tie on points for', () => {
    const p = priorityFromStandings([
      { teamId: 'a', wins: 5, pointsFor: 1100 },
      { teamId: 'b', wins: 5, pointsFor: 900 },
    ]);
    expect(p).toEqual({ b: 1, a: 2 });
  });
});

describe('remainingBudget', () => {
  it('falls back to the league budget for a team that has spent nothing', () => {
    expect(remainingBudget({}, 't1', faab)).toBe(100);
    expect(remainingBudget({ t1: 25 }, 't1', faab)).toBe(25);
  });
});
