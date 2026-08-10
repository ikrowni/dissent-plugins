import { describe, it, expect } from 'vitest';
import { weekRecap, latestRecap } from './recap.js';

const scores = (map) => ({ teams: Object.fromEntries(Object.entries(map).map(([t, total]) => [t, { total }])) });

const MATCHUPS = [
  { home: 't1', away: 't2', bye: false },
  { home: 't3', away: 't4', bye: false },
  { home: 't5', away: 't6', bye: false },
];

describe('weekRecap', () => {
  const s = scores({ t1: 140.2, t2: 138.9, t3: 99.1, t4: 40.5, t5: 120.0, t6: 118.4 });
  const r = weekRecap(4, MATCHUPS, s);

  it('finds the best and worst scores of the week', () => {
    expect(r.best.teamId).toBe('t1');
    expect(r.worst.teamId).toBe('t4');
  });

  it('finds the blowout and the nail-biter', () => {
    expect(r.blowout.margin).toBeCloseTo(58.6, 1);
    expect(r.nailBiter.margin).toBeCloseTo(1.3, 1);
  });

  it('finds the shootout by combined points', () => {
    expect(r.shootout.combined).toBeCloseTo(279.1, 1);
  });

  // ⚠️ The one everybody remembers: the highest score of the week that lost.
  it('names the team that scored big and still lost', () => {
    expect(r.unlucky.teamId).toBe('t2');
    expect(r.unlucky.points).toBe(138.9);
    // The lowest-scoring WINNER, which is t3 on 99.1 — not the closest game.
    expect(r.luckiest.teamId).toBe('t3');
  });

  it('leaves unlucky null when no loser outscored a winner', () => {
    const clean = weekRecap(1, MATCHUPS, scores({ t1: 100, t2: 50, t3: 100, t4: 50, t5: 100, t6: 50 }));
    expect(clean.unlucky).toBe(null);
    expect(clean.luckiest).toBe(null);
  });

  // ⚠️ A recap of nothing must be ABSENT. A panel headed "Week 4" with blank
  // rows reads as broken.
  it('returns null rather than an empty recap', () => {
    expect(weekRecap(4, [], scores({}))).toBe(null);
    expect(weekRecap(4, MATCHUPS, null)).toBe(null);
    expect(weekRecap(4, [{ home: 't1', away: null, bye: true }], scores({ t1: 100 }))).toBe(null);
  });

  // ⚠️ A half-scored game would let an unplayed opponent count as 0 and
  // manufacture a record blowout.
  it('ignores a game where only one side was scored', () => {
    const half = weekRecap(4, MATCHUPS, scores({ t1: 140, t3: 99, t4: 40, t5: 120, t6: 118 }));
    expect(half.games).toBe(2);
    expect(half.blowout.margin).toBeCloseTo(59, 1);
  });

  it('handles a tie without inventing a winner', () => {
    const tied = weekRecap(2, [{ home: 'a', away: 'b' }], scores({ a: 100, b: 100 }));
    expect(tied.games).toBe(1);
    expect(tied.blowout.margin).toBe(0);
    expect(tied.blowout.winner).toBe(null);
  });

  it('copes with a single game', () => {
    const one = weekRecap(1, [{ home: 'a', away: 'b' }], scores({ a: 10, b: 20 }));
    expect(one.best.teamId).toBe('b');
    expect(one.blowout).toEqual(one.nailBiter);
  });
});

describe('latestRecap', () => {
  const weeks = [
    { week: 1, matchups: MATCHUPS },
    { week: 2, matchups: MATCHUPS },
    { week: 3, matchups: MATCHUPS },
  ];
  const played = scores({ t1: 100, t2: 90, t3: 80, t4: 70, t5: 60, t6: 50 });

  it('describes the current week when it has results', () => {
    expect(latestRecap(3, weeks, (w) => (w === 3 ? played : null)).week).toBe(3);
  });

  // ⚠️ Walks BACKWARDS. A league whose latest week has not been scored still has
  // a story from the one before, and showing nothing would make this panel
  // vanish for most of every week.
  it('falls back to the last week that was scored', () => {
    expect(latestRecap(3, weeks, (w) => (w === 1 ? played : null)).week).toBe(1);
  });

  it('returns null when nothing has been scored at all', () => {
    expect(latestRecap(3, weeks, () => null)).toBe(null);
  });

  it('returns null in preseason rather than guessing', () => {
    expect(latestRecap(null, weeks, () => played)).toBe(null);
    expect(latestRecap(0, weeks, () => played)).toBe(null);
  });

  it('skips a week missing from the schedule', () => {
    expect(latestRecap(9, weeks, (w) => (w === 2 ? played : null)).week).toBe(2);
  });
});
