import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strengthFromStandings, opponentStrengthFor, tierOf } from './opponent-strength.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const ranks = strengthFromStandings(fx('standings.json'));

describe('strengthFromStandings', () => {
  it('ranks all 32 teams', () => {
    expect(Object.keys(ranks)).toHaveLength(32);
  });

  it('gives rank 1 to the team allowing the fewest points', () => {
    const best = Object.values(ranks).find((r) => r.rank === 1);
    const worst = Object.values(ranks).find((r) => r.rank === 32);
    expect(best.pointsAgainst).toBeLessThan(worst.pointsAgainst);
  });

  it('keys by the abbreviation the rest of the hub uses', () => {
    expect(ranks.PHI).toBeDefined();
    expect(ranks.WSH).toBeDefined();
    expect(ranks.WAS).toBeUndefined();
  });

  it('returns {} rather than throwing on a malformed payload', () => {
    expect(strengthFromStandings(null)).toEqual({});
    expect(strengthFromStandings({})).toEqual({});
  });
});

describe('tierOf', () => {
  it('splits 32 ranks into three tiers', () => {
    expect(tierOf(1)).toBe('tough');
    expect(tierOf(16)).toBe('even');
    expect(tierOf(32)).toBe('soft');
  });

  it('has no tier for an unknown rank', () => {
    expect(tierOf(null)).toBe(null);
  });
});

describe('opponentStrengthFor', () => {
  const nfl = { games: { PHI: { opponentAbbr: 'DAL' } }, byeTeams: ['KC'], injuries: {} };
  const table = { DAL: { rank: 4, pointsAgainst: 200 } };

  it('resolves a player to their opponent defense rank', () => {
    expect(opponentStrengthFor({ teamAbbr: 'PHI' }, nfl, table))
      .toEqual({ opponentAbbr: 'DAL', rank: 4, tier: 'tough' });
  });

  it('reports a bye rather than inventing an opponent', () => {
    expect(opponentStrengthFor({ teamAbbr: 'KC' }, nfl, table))
      .toEqual({ opponentAbbr: null, rank: null, tier: null, bye: true });
  });

  it('returns nulls for a player with no team or no slate entry', () => {
    expect(opponentStrengthFor({ teamAbbr: '' }, nfl, table).rank).toBe(null);
    expect(opponentStrengthFor({ teamAbbr: 'NYJ' }, nfl, table).rank).toBe(null);
  });

  it('returns a null rank when the opponent is missing from the table', () => {
    const partial = { games: { PHI: { opponentAbbr: 'DAL' } }, byeTeams: [] };
    expect(opponentStrengthFor({ teamAbbr: 'PHI' }, partial, {}).rank).toBe(null);
  });
});
