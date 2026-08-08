import { describe, it, expect } from 'vitest';
import { teamStats, remainingGames, simulate } from './playoff-odds.js';

/** Deterministic RNG so a probability assertion is a real assertion, not a flake. */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const scored = [
  { week: 1, scores: { 1: 130, 2: 90, 3: 110, 4: 100 } },
  { week: 2, scores: { 1: 140, 2: 85, 3: 105, 4: 95 } },
  { week: 3, scores: { 1: 135, 2: 95, 3: 115, 4: 105 } },
];

describe('teamStats', () => {
  it('computes a mean and a standard deviation per roster', () => {
    const s = teamStats(scored);
    expect(s[1].mean).toBeCloseTo(135, 5);
    expect(s[1].sd).toBeGreaterThan(0);
    expect(s[2].mean).toBeCloseTo(90, 5);
  });

  it('gives a single-week roster a non-zero sd so its games are not predetermined', () => {
    const s = teamStats([{ week: 1, scores: { 1: 100 } }]);
    expect(s[1].sd).toBeGreaterThan(0);
  });

  it('returns {} for no weeks', () => {
    expect(teamStats([])).toEqual({});
  });
});

describe('remainingGames', () => {
  it('pairs rosters that share a matchup id, for each future week', () => {
    const weeks = [{
      week: 4,
      matchups: [
        { matchupId: 1, rosterId: 1, points: 0 }, { matchupId: 1, rosterId: 2, points: 0 },
        { matchupId: 2, rosterId: 3, points: 0 }, { matchupId: 2, rosterId: 4, points: 0 },
      ],
    }];
    expect(remainingGames(weeks)).toEqual([{ week: 4, home: 1, away: 2 }, { week: 4, home: 3, away: 4 }]);
  });

  it('skips a bye, which has only one roster on the matchup id', () => {
    expect(remainingGames([{ week: 4, matchups: [{ matchupId: 9, rosterId: 1 }] }])).toEqual([]);
  });

  it('returns [] when nothing remains', () => {
    expect(remainingGames([])).toEqual([]);
  });
});

describe('simulate', () => {
  const rosters = [
    { rosterId: 1, wins: 3, losses: 0, pointsFor: 405 },
    { rosterId: 2, wins: 0, losses: 3, pointsFor: 270 },
    { rosterId: 3, wins: 2, losses: 1, pointsFor: 330 },
    { rosterId: 4, wins: 1, losses: 2, pointsFor: 300 },
  ];
  const remaining = [{ week: 4, home: 1, away: 2 }, { week: 4, home: 3, away: 4 }];

  it('returns one odds row per roster, each a percentage', async () => {
    const out = await simulate({
      rosters, scored, remaining, playoffTeams: 2, iterations: 200, rng: seeded(7),
    });
    expect(out).toHaveLength(4);
    for (const r of out) {
      expect(r.odds).toBeGreaterThanOrEqual(0);
      expect(r.odds).toBeLessThanOrEqual(100);
    }
  });

  it('gives the dominant team far better odds than the worst team', async () => {
    const out = await simulate({
      rosters, scored, remaining, playoffTeams: 2, iterations: 400, rng: seeded(11),
    });
    const byId = Object.fromEntries(out.map((r) => [r.rosterId, r.odds]));
    expect(byId[1]).toBeGreaterThan(byId[2]);
    expect(byId[1]).toBeGreaterThan(90);
  });

  it('is deterministic for a given seed', async () => {
    const args = { rosters, scored, remaining, playoffTeams: 2, iterations: 100 };
    const a = await simulate({ ...args, rng: seeded(3) });
    const b = await simulate({ ...args, rng: seeded(3) });
    expect(a).toEqual(b);
  });

  it('returns settled odds of 100/0 when no games remain', async () => {
    const out = await simulate({
      rosters, scored, remaining: [], playoffTeams: 2, iterations: 50, rng: seeded(5),
    });
    const byId = Object.fromEntries(out.map((r) => [r.rosterId, r.odds]));
    expect(byId[1]).toBe(100);
    expect(byId[3]).toBe(100);
    expect(byId[2]).toBe(0);
  });

  it('yields between chunks so a long sim never blocks the frame', async () => {
    let yields = 0;
    await simulate({
      rosters, scored, remaining, playoffTeams: 2, iterations: 500, chunkSize: 100,
      rng: seeded(2), yieldFn: async () => { yields += 1; },
    });
    expect(yields).toBe(5);
  });
});
