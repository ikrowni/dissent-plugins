import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toRosters, toScoredWeeks } from './league/power-adapter.js';
import { weeklyScores, allPlayRecords, powerRankings } from './power.js';

/**
 * ⚠️ THIS TEST USED TO PARSE SLEEPER FIXTURES, and it was the last thing in the
 * plugin that did. `core/power.js` was written for the Sleeper mirror's shapes,
 * so its test read `sleeper-rosters.json` and three weeks of `sleeper-matchups`
 * through parsers that no longer exist — the mirror was removed on 2026-08-12.
 *
 * `core/power.js` itself stays: `views/league-home.js` ranks the NATIVE league
 * with it, through `core/league/power-adapter.js`, which exists precisely so the
 * league does not end up with two answers to "who is actually best".
 *
 * So the input now arrives the way production's only caller supplies it — through
 * the adapter. The fixture behind it was derived ONCE from that same real
 * 12-team, 3-week season and reshaped into the native stored form: real scores,
 * real records, nothing hand-invented. Building this by hand is how a suite goes
 * green over a shape the app never produces.
 */
const fx = JSON.parse(
  readFileSync(new URL('../tests/fixtures/league-power.json', import.meta.url), 'utf8'),
);
const rosters = toRosters(fx.standings);
const weeks = toScoredWeeks(fx.weekScores);

describe('weeklyScores', () => {
  it('maps each week to rosterId -> points', () => {
    // ⚠️ The adapter already produces `{ week, scores }`, so weeklyScores is fed
    // the mirror's raw shape here and the adapter's output is checked beside it —
    // the two paths into power.js must agree on what a scored week looks like.
    const s = weeklyScores([{ week: 1, matchups: [{ rosterId: 1, points: 100 }] }]);
    expect(s).toEqual([{ week: 1, scores: { 1: 100 } }]);
    expect(weeks).toHaveLength(3);
    expect(Object.keys(weeks[0].scores)).toHaveLength(12);
    expect(weeks[0].week).toBe(1);
  });

  it('skips weeks where nobody has scored yet', () => {
    expect(weeklyScores([{ week: 5, matchups: [{ rosterId: 1, points: 0 }] }])).toEqual([]);
  });
});

describe('allPlayRecords', () => {
  it('gives every team (teams-1) games per week', () => {
    const recs = allPlayRecords(weeks);
    const r1 = recs['1'];
    expect(r1.wins + r1.losses + r1.ties).toBe(3 * 11);
  });

  it('awards the weekly high scorer a clean sweep', () => {
    const recs = allPlayRecords([{ week: 1, scores: { 1: 100, 2: 90, 3: 80 } }]);
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
  const ranked = powerRankings(rosters, weeks);

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
    // A direct call, because the adapter can never supply a denominator — see below.
    const out = powerRankings(
      [{ rosterId: 'a', wins: 1, losses: 0, ties: 0, pointsFor: 90, potentialPoints: 120 }],
      [{ week: 1, scores: { a: 90 } }],
    );
    expect(out[0].efficiency).toBeCloseTo(0.75, 5);
  });

  /**
   * ⚠️ THE NATIVE LEAGUE CANNOT REPORT EFFICIENCY AT ALL, and that is deliberate.
   * Sleeper supplied a best-possible lineup; a stored native week holds only the
   * STARTERS' points, so the bench scores needed to know what the best lineup
   * would have been are simply absent. `toRosters` therefore sets
   * `potentialPoints: 0` and efficiency comes out 0 — the UI must hide that column
   * rather than print a confident nonsense number.
   */
  it('reports zero efficiency for every native team, rather than inventing one', () => {
    for (const r of ranked) expect(r.efficiency).toBe(0);
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
