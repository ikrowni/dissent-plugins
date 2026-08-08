import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseLeague, parseRosters, parseLeagueUsers, parseMatchups, parseProjections, joinMatchups,
} from './sleeper.js';
import { scoringKey, buildLineup, sideTotals, winProbability, benchPoints } from './fantasy.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const league = parseLeague(fx('sleeper-league.json'));
const rosters = parseRosters(fx('sleeper-rosters.json'));
const users = parseLeagueUsers(fx('sleeper-users.json'));
const matchups = parseMatchups(fx('sleeper-matchups-w14.json'));
const projections = parseProjections(fx('sleeper-projections-w14.json'));
const joined = joinMatchups(matchups, rosters, users);

describe('scoringKey', () => {
  it('maps the league scoring type onto the projection field', () => {
    expect(scoringKey({ scoringType: 'PPR' })).toBe('ppr');
    expect(scoringKey({ scoringType: 'Half PPR' })).toBe('halfPpr');
    expect(scoringKey({ scoringType: 'Standard' })).toBe('std');
  });

  it('defaults to ppr rather than throwing on an unknown league', () => {
    expect(scoringKey(null)).toBe('ppr');
    expect(scoringKey({ scoringType: 'weird' })).toBe('ppr');
  });

  it('reads the fixture league as PPR', () => {
    expect(scoringKey(league)).toBe('ppr');
  });
});

describe('buildLineup', () => {
  const side = joined[0].home;

  it('labels each starter with its roster slot, in slot order', () => {
    const rows = buildLineup(side, league, { projections, key: 'ppr' });
    expect(rows).toHaveLength(league.starterSlots.length);
    expect(rows.map((r) => r.slot)).toEqual(league.starterSlots);
  });

  it('handles SUPER_FLEX, which is the slot most likely to be mislabelled', () => {
    expect(league.starterSlots).toContain('SUPER_FLEX');
    const rows = buildLineup(side, league, { projections, key: 'ppr' });
    expect(rows.find((r) => r.slot === 'SUPER_FLEX')).toBeDefined();
  });

  it('carries actual points from players_points and projected from the projection dict', () => {
    const rows = buildLineup(side, league, { projections, key: 'ppr' });
    const scored = rows.filter((r) => r.actual > 0);
    expect(scored.length).toBeGreaterThan(0);
    expect(rows.every((r) => Number.isFinite(r.actual))).toBe(true);
    expect(rows.every((r) => Number.isFinite(r.projected))).toBe(true);
  });

  it('marks an empty slot rather than dropping the row, so the lineup stays slot-aligned', () => {
    const empty = { ...side, starters: [], playerPoints: {} };
    const rows = buildLineup(empty, league, { projections, key: 'ppr' });
    expect(rows).toHaveLength(league.starterSlots.length);
    expect(rows.every((r) => r.empty)).toBe(true);
  });

  it('resolves names through the player index when it has one', () => {
    const index = { get: (id) => ({ name: `Name${id}`, position: 'RB', teamAbbr: 'PHI', espnId: 42 }) };
    const rows = buildLineup(side, league, { projections, key: 'ppr', index });
    const named = rows.filter((r) => !r.empty);
    expect(named.length).toBeGreaterThan(0);
    expect(named[0].name).toMatch(/^Name/);
    expect(named[0].espnId).toBe(42);
  });

  it('returns [] for a missing side instead of throwing', () => {
    expect(buildLineup(null, league, { projections, key: 'ppr' })).toEqual([]);
  });
});

describe('sideTotals', () => {
  it('reports actual, projected and the projected final', () => {
    const rows = buildLineup(joined[0].home, league, { projections, key: 'ppr' });
    const t = sideTotals(joined[0].home, rows);
    expect(t.actual).toBeCloseTo(joined[0].home.points, 1);
    // Projected final is what is already banked plus what is still to come — never less
    // than what has already been scored.
    expect(t.projectedFinal).toBeGreaterThanOrEqual(t.actual - 0.01);
  });

  it('treats a played row as banked and an unplayed row as still to come', () => {
    const rows = [
      { actual: 20, projected: 14, played: true, empty: false },
      { actual: 0, projected: 12, played: false, empty: false },
    ];
    const t = sideTotals({ points: 20 }, rows);
    expect(t.actual).toBe(20);
    expect(t.remaining).toBe(12);
    expect(t.projectedFinal).toBe(32);
  });
});

describe('winProbability', () => {
  it('is 50% for two identical sides', () => {
    expect(winProbability({ projectedFinal: 100, remaining: 40 },
      { projectedFinal: 100, remaining: 40 })).toBe(50);
  });

  it('is certain once both sides have finished and one is ahead', () => {
    expect(winProbability({ projectedFinal: 120, remaining: 0 },
      { projectedFinal: 100, remaining: 0 })).toBe(100);
    expect(winProbability({ projectedFinal: 100, remaining: 0 },
      { projectedFinal: 120, remaining: 0 })).toBe(0);
  });

  it('is less certain with more football left to play', () => {
    const early = winProbability({ projectedFinal: 110, remaining: 90 },
      { projectedFinal: 100, remaining: 90 });
    const late = winProbability({ projectedFinal: 110, remaining: 5 },
      { projectedFinal: 100, remaining: 5 });
    expect(late).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(50);
  });

  it('always returns a whole percentage inside [0, 100]', () => {
    for (const r of [0, 1, 20, 200]) {
      for (const d of [-80, -3, 0, 3, 80]) {
        const p = winProbability({ projectedFinal: 100 + d, remaining: r },
          { projectedFinal: 100, remaining: r });
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(100);
        expect(Number.isInteger(p)).toBe(true);
      }
    }
  });
});

describe('benchPoints', () => {
  it('is the gap between what was scored and the optimal lineup', () => {
    const roster = { pointsFor: 100, potentialPoints: 124.6 };
    expect(benchPoints(roster)).toBeCloseTo(24.6, 1);
  });

  it('never goes negative, and is null when potential is unknown', () => {
    expect(benchPoints({ pointsFor: 100, potentialPoints: 90 })).toBe(0);
    expect(benchPoints({ pointsFor: 100, potentialPoints: 0 })).toBe(null);
    expect(benchPoints(null)).toBe(null);
  });
});
