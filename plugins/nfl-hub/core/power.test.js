import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRosters, parseMatchups } from './sleeper.js';
import { weeklyScores, allPlayRecords, powerRankings } from './power.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const rosters = parseRosters(fx('sleeper-rosters.json'));
const weeks = [1, 2, 3].map((w) => ({
  week: w, matchups: parseMatchups(fx(`sleeper-matchups-w${w}.json`)),
}));

describe('weeklyScores', () => {
  it('maps each week to rosterId -> points', () => {
    const s = weeklyScores(weeks);
    expect(s).toHaveLength(3);
    expect(Object.keys(s[0].scores)).toHaveLength(12);
    expect(s[0].week).toBe(1);
  });

  it('skips weeks where nobody has scored yet', () => {
    const s = weeklyScores([{ week: 5, matchups: [{ rosterId: 1, points: 0 }] }]);
    expect(s).toEqual([]);
  });
});

describe('allPlayRecords', () => {
  it('gives every team (teams-1) games per week', () => {
    const recs = allPlayRecords(weeklyScores(weeks));
    const r1 = recs[1];
    expect(r1.wins + r1.losses + r1.ties).toBe(3 * 11);
  });

  it('awards the weekly high scorer a clean sweep', () => {
    const one = [{ week: 1, scores: { 1: 100, 2: 90, 3: 80 } }];
    const recs = allPlayRecords(one);
    expect(recs[1]).toMatchObject({ wins: 2, losses: 0, ties: 0 });
    expect(recs[3]).toMatchObject({ wins: 0, losses: 2, ties: 0 });
    expect(recs[2]).toMatchObject({ wins: 1, losses: 1, ties: 0 });
  });

  it('counts an exact tie as a tie on both sides', () => {
    const recs = allPlayRecords([{ week: 1, scores: { 1: 100, 2: 100 } }]);
    expect(recs[1]).toMatchObject({ wins: 0, losses: 0, ties: 1 });
    expect(recs[2]).toMatchObject({ wins: 0, losses: 0, ties: 1 });
  });

  it('returns an empty map for no weeks', () => {
    expect(allPlayRecords([])).toEqual({});
  });
});

describe('powerRankings', () => {
  const ranked = powerRankings(rosters, weeklyScores(weeks));

  it('ranks every roster exactly once, starting at 1', () => {
    expect(ranked).toHaveLength(rosters.length);
    expect(ranked.map((r) => r.rank)).toEqual(rosters.map((_, i) => i + 1));
  });

  it('orders by all-play win percentage', () => {
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].allPlayPct).toBeGreaterThanOrEqual(ranked[i].allPlayPct);
    }
  });

  it('computes luck as actual wins minus all-play expected wins', () => {
    for (const r of ranked) {
      expect(r.luck).toBeCloseTo(r.wins - r.expectedWins, 5);
    }
  });

  it('computes efficiency as pointsFor over potentialPoints', () => {
    const r = ranked.find((x) => x.potentialPoints > 0);
    expect(r.efficiency).toBeCloseTo(r.pointsFor / r.potentialPoints, 5);
  });

  it('never divides by zero when a roster has no potential points', () => {
    const out = powerRankings(
      [{ rosterId: 1, wins: 0, losses: 0, ties: 0, pointsFor: 0, potentialPoints: 0 }],
      [],
    );
    expect(out[0].efficiency).toBe(0);
    expect(out[0].allPlayPct).toBe(0);
    expect(out[0].luck).toBe(0);
  });
});
