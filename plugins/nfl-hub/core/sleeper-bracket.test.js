import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBracket, bracketRounds, sideLabel } from './sleeper-bracket.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const winners = parseBracket(fx('sleeper-winners-bracket.json'));
const losers = parseBracket(fx('sleeper-losers-bracket.json'));

describe('parseBracket', () => {
  it('parses every match', () => {
    expect(winners).toHaveLength(7);
    expect(losers).toHaveLength(7);
  });

  it('reads a first-round match with both sides already known', () => {
    expect(winners[0]).toMatchObject({
      matchId: 1, round: 1, team1: 7, team2: 3, winner: 7, loser: 3,
      placement: null, team1From: null, team2From: null,
    });
  });

  it('reads the source reference on a later-round side', () => {
    const m3 = winners.find((m) => m.matchId === 3);
    expect(m3.team2From).toEqual({ kind: 'winner', matchId: 1 });
  });

  it('reads a consolation match fed by two losers', () => {
    const m5 = winners.find((m) => m.matchId === 5);
    expect(m5.team1From).toEqual({ kind: 'loser', matchId: 1 });
    expect(m5.team2From).toEqual({ kind: 'loser', matchId: 2 });
    expect(m5.placement).toBe(5);
  });

  it('flags the championship match', () => {
    const final = winners.find((m) => m.placement === 1);
    expect(final.matchId).toBe(6);
    expect(final.winner).toBe(8);
  });

  it('returns [] rather than throwing on a malformed payload', () => {
    expect(parseBracket(null)).toEqual([]);
    expect(parseBracket({})).toEqual([]);
  });
});

describe('bracketRounds', () => {
  it('groups matches by round in ascending order', () => {
    const rounds = bracketRounds(winners);
    expect(rounds.map((r) => r.round)).toEqual([1, 2, 3]);
    expect(rounds[0].matches).toHaveLength(2);
    expect(rounds[1].matches).toHaveLength(3);
  });

  it('returns [] for an empty bracket', () => {
    expect(bracketRounds([])).toEqual([]);
  });
});

describe('sideLabel', () => {
  const names = { 7: 'Team Seven', 3: 'Team Three' };

  it('names a known roster', () => {
    expect(sideLabel(7, null, names)).toBe('Team Seven');
  });

  it('describes an unresolved side by its source match', () => {
    expect(sideLabel(null, { kind: 'winner', matchId: 1 }, names)).toBe('Winner of M1');
    expect(sideLabel(null, { kind: 'loser', matchId: 2 }, names)).toBe('Loser of M2');
  });

  it('falls back to TBD when there is neither a roster nor a source', () => {
    expect(sideLabel(null, null, names)).toBe('TBD');
  });

  it('falls back to a roster number when the name is unknown', () => {
    expect(sideLabel(99, null, names)).toBe('Roster 99');
  });
});
