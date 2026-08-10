import { describe, it, expect } from 'vitest';
import { toScoredWeeks, toRosters, hasEnoughForPower } from './power-adapter.js';
import { powerRankings, allPlayRecords } from '../power.js';

const week = (map) => ({ teams: Object.fromEntries(Object.entries(map).map(([t, total]) => [t, { total }])) });

describe('toScoredWeeks', () => {
  it('converts stored weeks into scored weeks, in order', () => {
    const out = toScoredWeeks({ 3: week({ t1: 100, t2: 90 }), 1: week({ t1: 80, t2: 70 }) });
    expect(out.map((w) => w.week)).toEqual([1, 3]);
    expect(out[0].scores).toEqual({ t1: 80, t2: 70 });
  });

  // ⚠️ A week of zeroes would give every team a tie against the whole field and
  // drag all-play toward .500 — quietly wrong, and worst early in a season.
  it('skips a week nobody actually played', () => {
    expect(toScoredWeeks({ 1: week({ t1: 0, t2: 0 }) })).toEqual([]);
  });

  it('keeps a week where somebody scored, even if another team was blanked', () => {
    const out = toScoredWeeks({ 1: week({ t1: 90, t2: 0 }) });
    expect(out).toHaveLength(1);
    expect(out[0].scores.t2).toBe(0);
  });

  it('ignores malformed records rather than throwing', () => {
    expect(toScoredWeeks({ 1: null, 2: {}, 3: { teams: {} } })).toEqual([]);
    expect(toScoredWeeks({})).toEqual([]);
  });

  it('drops a non-numeric total', () => {
    const out = toScoredWeeks({ 1: { teams: { t1: { total: 'x' }, t2: { total: 50 } } } });
    expect(out[0].scores).toEqual({ t2: 50 });
  });
});

describe('toRosters', () => {
  it('carries the record and points across', () => {
    const [r] = toRosters([{ teamId: 't1', wins: 3, losses: 1, ties: 0, pointsFor: 400, pointsAgainst: 350 }]);
    expect(r).toMatchObject({ rosterId: 't1', wins: 3, pointsFor: 400 });
  });

  // ⚠️ The native league cannot compute a best-possible lineup: a stored week
  // holds only the STARTERS' points, so the bench scores needed are absent.
  // Zero makes powerRankings report efficiency 0, which the UI must not show.
  it('reports zero potential points, so efficiency is never invented', () => {
    expect(toRosters([{ teamId: 't1' }])[0].potentialPoints).toBe(0);
    const rows = powerRankings(toRosters([{ teamId: 't1', pointsFor: 100 }]), []);
    expect(rows[0].efficiency).toBe(0);
  });

  it('defaults a missing field rather than emitting undefined', () => {
    expect(toRosters([{ teamId: 't1' }])[0]).toMatchObject({ wins: 0, losses: 0, pointsFor: 0 });
  });
});

describe('hasEnoughForPower', () => {
  it('needs at least two played weeks', () => {
    expect(hasEnoughForPower([{ week: 1 }])).toBe(false);
    expect(hasEnoughForPower([{ week: 1 }, { week: 2 }])).toBe(true);
  });

  it('is false for nothing at all', () => {
    expect(hasEnoughForPower([])).toBe(false);
    expect(hasEnoughForPower(null)).toBe(false);
  });
});

describe('end to end against the real power module', () => {
  // t1 always scores highest, t3 always lowest — the ranking is not in doubt,
  // which is what makes this a test of the WIRING rather than of the maths.
  const weekScores = {
    1: week({ t1: 120, t2: 100, t3: 80 }),
    2: week({ t1: 130, t2: 110, t3: 90 }),
  };
  const standings = [
    { teamId: 't1', wins: 2, losses: 0, ties: 0, pointsFor: 250, pointsAgainst: 170 },
    { teamId: 't2', wins: 1, losses: 1, ties: 0, pointsFor: 210, pointsAgainst: 210 },
    { teamId: 't3', wins: 0, losses: 2, ties: 0, pointsFor: 170, pointsAgainst: 250 },
  ];

  it('ranks the consistently highest scorer first', () => {
    const rows = powerRankings(toRosters(standings), toScoredWeeks(weekScores));
    expect(rows[0].rosterId).toBe('t1');
    expect(rows[rows.length - 1].rosterId).toBe('t3');
    expect(rows[0].rank).toBe(1);
  });

  it('gives an undefeated top scorer a perfect all-play record', () => {
    const recs = allPlayRecords(toScoredWeeks(weekScores));
    expect(recs.t1).toEqual({ wins: 4, losses: 0, ties: 0 });
    expect(recs.t3).toEqual({ wins: 0, losses: 4, ties: 0 });
  });

  // ⚠️ Luck is the point of the whole panel: a team can be 2-0 while being the
  // second-best team in the league, and all-play is what exposes it.
  it('surfaces luck as the gap between real wins and all-play expectation', () => {
    const rows = powerRankings(toRosters(standings), toScoredWeeks(weekScores));
    const t2 = rows.find((r) => r.rosterId === 't2');
    expect(t2.expectedWins).toBeCloseTo(1, 5);
    expect(t2.luck).toBeCloseTo(0, 5);
  });
});
