import { describe, it, expect } from 'vitest';
import {
  TEAMS, TEAM_BY_ID, teamByAbbr, teamById, teamIdFromRef,
  normalizeAbbr, logoPath, timeslot, DIVISIONS,
} from './config.js';

describe('team table', () => {
  it('has all 32 teams', () => {
    expect(Object.keys(TEAMS)).toHaveLength(32);
  });

  it('maps ESPN numeric ids, including the 33/34 gap', () => {
    expect(teamById(12).abbr).toBe('KC');
    expect(teamById(6).abbr).toBe('DAL');
    expect(teamById(33).abbr).toBe('BAL');
    expect(teamById(34).abbr).toBe('HOU');
    expect(teamById(31)).toBeNull();
    expect(teamById(32)).toBeNull();
  });

  it('covers every ESPN id exactly once', () => {
    expect(Object.keys(TEAM_BY_ID)).toHaveLength(32);
  });

  it('places every team in exactly one division', () => {
    const placed = Object.values(DIVISIONS).flat();
    expect(placed).toHaveLength(32);
    expect(new Set(placed).size).toBe(32);
  });

  it('has eight divisions of four', () => {
    expect(Object.keys(DIVISIONS)).toHaveLength(8);
    for (const teams of Object.values(DIVISIONS)) expect(teams).toHaveLength(4);
  });

  it('gives every team a hash-prefixed primary colour', () => {
    for (const t of Object.values(TEAMS)) {
      expect(t.primary).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.alt).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('derives abbr and fullName onto each record', () => {
    expect(TEAMS.KC.abbr).toBe('KC');
    expect(TEAMS.KC.fullName).toBe('Kansas City Chiefs');
  });
});

describe('teamIdFromRef', () => {
  it('extracts the id from a real ESPN $ref url', () => {
    const ref = 'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/teams/6?lang=en&region=us';
    expect(teamIdFromRef(ref)).toBe(6);
  });

  it('accepts the wrapped object form ESPN actually sends', () => {
    expect(teamIdFromRef({ $ref: 'https://x/teams/33?lang=en' })).toBe(33);
  });

  it('returns null for junk rather than throwing', () => {
    expect(teamIdFromRef(null)).toBeNull();
    expect(teamIdFromRef('nope')).toBeNull();
    expect(teamIdFromRef({})).toBeNull();
  });
});

describe('normalizeAbbr', () => {
  it('canonicalises the aliases ESPN and Sleeper disagree on', () => {
    expect(normalizeAbbr('WAS')).toBe('WSH');
    expect(normalizeAbbr('ARZ')).toBe('ARI');
    expect(normalizeAbbr('JAC')).toBe('JAX');
    expect(normalizeAbbr('LA')).toBe('LAR');
  });

  it('upper-cases and passes through canonical abbrs', () => {
    expect(normalizeAbbr('kc')).toBe('KC');
    expect(normalizeAbbr('WSH')).toBe('WSH');
  });

  it('returns empty string for nullish input', () => {
    expect(normalizeAbbr(null)).toBe('');
    expect(normalizeAbbr(undefined)).toBe('');
  });
});

describe('teamByAbbr', () => {
  it('resolves through aliases', () => {
    expect(teamByAbbr('WAS').name).toBe('Commanders');
  });
  it('returns null for unknown', () => {
    expect(teamByAbbr('ZZZ')).toBeNull();
  });
});

describe('logoPath', () => {
  it('returns a local asset path, never an espncdn url', () => {
    const p = logoPath('KC');
    expect(p).toBe('nfl-hub/assets/logos/kc.png');
    expect(p).not.toContain('espncdn');
  });
  it('normalises the abbr first', () => {
    expect(logoPath('WAS')).toBe('nfl-hub/assets/logos/wsh.png');
  });
});

describe('timeslot', () => {
  const et = (iso) => timeslot(iso);
  it('names Thursday night football', () => {
    expect(et('2025-09-05T00:20Z')).toBe('Thursday Night Football');
  });
  it('splits the Sunday afternoon windows', () => {
    expect(et('2025-09-07T17:00Z')).toBe('Sunday · 1:00 PM ET');
    expect(et('2025-09-07T20:25Z')).toBe('Sunday · 4:25 PM ET');
  });
  it('names Sunday night football', () => {
    expect(et('2025-09-08T00:20Z')).toBe('Sunday Night Football');
  });
  it('names Monday night football', () => {
    expect(et('2025-09-09T00:15Z')).toBe('Monday Night Football');
  });
});
