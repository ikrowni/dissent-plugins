import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { setFetcher, resetFetcher } from './http.js';
import {
  sleeperUrls, parseState, parseLeague, parseRosters, parseMatchups,
  parseLeagueUsers, joinMatchups, deepLink, fetchState,
} from './sleeper.js';

const fixture = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

afterEach(() => { resetFetcher(); });

describe('sleeperUrls', () => {
  it('builds the endpoints the hub reads', () => {
    expect(sleeperUrls.state()).toBe('https://api.sleeper.app/v1/state/nfl');
    expect(sleeperUrls.user('kroWn')).toBe('https://api.sleeper.app/v1/user/kroWn');
    expect(sleeperUrls.userLeagues('123', 2026)).toBe(
      'https://api.sleeper.app/v1/user/123/leagues/nfl/2026');
    expect(sleeperUrls.league('L1')).toBe('https://api.sleeper.app/v1/league/L1');
    expect(sleeperUrls.rosters('L1')).toBe('https://api.sleeper.app/v1/league/L1/rosters');
    expect(sleeperUrls.leagueUsers('L1')).toBe('https://api.sleeper.app/v1/league/L1/users');
    expect(sleeperUrls.matchups('L1', 3)).toBe(
      'https://api.sleeper.app/v1/league/L1/matchups/3');
    expect(sleeperUrls.transactions('L1', 3)).toBe(
      'https://api.sleeper.app/v1/league/L1/transactions/3');
  });

  it('never builds the 14 MB player database url', () => {
    expect(Object.keys(sleeperUrls)).not.toContain('players');
    expect(JSON.stringify(Object.keys(sleeperUrls))).not.toContain('players');
    // trending is fine — it is a small, limited list.
    expect(sleeperUrls.trending('add', 5)).toBe(
      'https://api.sleeper.app/v1/players/nfl/trending/add?limit=5');
  });

  it('builds avatar urls on the thumbnail path', () => {
    expect(sleeperUrls.avatar('abc')).toBe('https://sleepercdn.com/avatars/thumbs/abc');
    expect(sleeperUrls.avatar(null)).toBeNull();
  });
});

describe('parseState', () => {
  it('flattens the state payload', () => {
    const s = parseState({
      week: 1, season: '2026', season_type: 'pre', display_week: 1,
      season_start_date: '2026-08-06',
    });
    expect(s).toEqual({
      week: 1, displayWeek: 1, season: 2026, seasonType: 'pre',
      isPreseason: true, isRegular: false, seasonStart: '2026-08-06',
    });
  });

  it('marks the regular season', () => {
    expect(parseState({ season: '2026', season_type: 'regular', week: 4 }).isRegular).toBe(true);
  });

  it('parses the recorded fixture', () => {
    const s = parseState(fixture('sleeper-state.json'));
    expect(s.season).toBeGreaterThan(2020);
    expect(typeof s.week).toBe('number');
  });

  it('returns null for junk', () => {
    expect(parseState(null)).toBeNull();
  });
});

describe('parseLeague', () => {
  it('extracts name, size, scoring and playoff shape', () => {
    const l = parseLeague({
      league_id: 'L1', name: 'The League', season: '2026', status: 'in_season',
      total_rosters: 12, avatar: 'av1',
      settings: { playoff_teams: 6, playoff_week_start: 15, num_teams: 12 },
      scoring_settings: { rec: 0.5 },
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN'],
    });
    expect(l).toMatchObject({
      id: 'L1', name: 'The League', season: 2026, teams: 12,
      playoffTeams: 6, playoffWeekStart: 15, scoringType: 'Half PPR',
    });
    expect(l.starterSlots).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']);
  });

  it('names the scoring format from the rec setting', () => {
    expect(parseLeague({ scoring_settings: { rec: 1 } }).scoringType).toBe('PPR');
    expect(parseLeague({ scoring_settings: { rec: 0 } }).scoringType).toBe('Standard');
    expect(parseLeague({ scoring_settings: {} }).scoringType).toBe('Standard');
  });

  it('excludes bench, IR and taxi from starter slots', () => {
    const l = parseLeague({ roster_positions: ['QB', 'BN', 'IR', 'TAXI', 'WR'] });
    expect(l.starterSlots).toEqual(['QB', 'WR']);
  });

  it('returns null for junk', () => {
    expect(parseLeague(null)).toBeNull();
  });
});

describe('parseRosters', () => {
  it('flattens record and points, splitting the fractional part', () => {
    const [r] = parseRosters([{
      roster_id: 3, owner_id: 'u1', players: ['1234', '5678'], starters: ['1234'],
      settings: { wins: 5, losses: 2, ties: 0, fpts: 1234, fpts_decimal: 56,
                  fpts_against: 1100, fpts_against_decimal: 12 },
    }]);
    expect(r).toMatchObject({
      rosterId: 3, ownerId: 'u1', wins: 5, losses: 2, ties: 0,
      pointsFor: 1234.56, pointsAgainst: 1100.12,
    });
    expect(r.players).toEqual(['1234', '5678']);
    expect(r.starters).toEqual(['1234']);
  });

  it('treats missing point fields as zero rather than NaN', () => {
    const [r] = parseRosters([{ roster_id: 1, settings: {} }]);
    expect(r.pointsFor).toBe(0);
    expect(r.pointsAgainst).toBe(0);
  });

  it('returns an empty array for junk', () => {
    expect(parseRosters(null)).toEqual([]);
  });
});

describe('parseLeagueUsers', () => {
  it('keys users by id with their team name', () => {
    const out = parseLeagueUsers([
      { user_id: 'u1', display_name: 'krown', avatar: 'a1',
        metadata: { team_name: 'Krown Jewels' } },
      { user_id: 'u2', display_name: 'bob', avatar: null, metadata: {} },
    ]);
    expect(out.u1).toMatchObject({ id: 'u1', displayName: 'krown', teamName: 'Krown Jewels' });
    expect(out.u2.teamName).toBe('bob'); // falls back to display name
  });

  it('returns an empty object for junk', () => {
    expect(parseLeagueUsers(null)).toEqual({});
  });
});

describe('joinMatchups', () => {
  it('pairs rosters sharing a matchup_id and attaches owner metadata', () => {
    const matchups = parseMatchups([
      { matchup_id: 1, roster_id: 3, points: 101.5, starters: ['a'] },
      { matchup_id: 1, roster_id: 7, points: 98.25, starters: ['b'] },
    ]);
    const rosters = parseRosters([
      { roster_id: 3, owner_id: 'u1', settings: { wins: 2, losses: 1 } },
      { roster_id: 7, owner_id: 'u2', settings: {} },
    ]);
    const users = parseLeagueUsers([
      { user_id: 'u1', display_name: 'krown', metadata: { team_name: 'A' } },
      { user_id: 'u2', display_name: 'bob', metadata: { team_name: 'B' } },
    ]);
    const pairs = joinMatchups(matchups, rosters, users);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].home.teamName).toBe('A');
    expect(pairs[0].away.teamName).toBe('B');
    expect(pairs[0].home.record).toBe('2-1');
    expect(pairs[0].margin).toBe(3.25);
    expect(pairs[0].leaderRosterId).toBe(3);
  });

  it('handles a bye (one roster in a matchup) without inventing an opponent', () => {
    const pairs = joinMatchups(
      parseMatchups([{ matchup_id: 2, roster_id: 5, points: 88 }]),
      parseRosters([{ roster_id: 5, owner_id: 'u3', settings: {} }]),
      parseLeagueUsers([{ user_id: 'u3', display_name: 'sam', metadata: {} }]),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].away).toBeNull();
    expect(pairs[0].margin).toBe(0);
  });

  it('names the trailing side as leader only when it is actually ahead', () => {
    const pairs = joinMatchups(
      parseMatchups([
        { matchup_id: 1, roster_id: 3, points: 80 },
        { matchup_id: 1, roster_id: 7, points: 120 },
      ]),
      parseRosters([{ roster_id: 3, settings: {} }, { roster_id: 7, settings: {} }]),
      {},
    );
    expect(pairs[0].leaderRosterId).toBe(7);
    expect(pairs[0].margin).toBe(40);
  });

  it('falls back to a roster label when the owner is unknown', () => {
    const pairs = joinMatchups(
      parseMatchups([{ matchup_id: 1, roster_id: 9, points: 1 }]),
      parseRosters([{ roster_id: 9, settings: {} }]),
      {},
    );
    expect(pairs[0].home.teamName).toBe('Roster 9');
  });

  it('skips entries with no matchup_id (undrafted or bye weeks)', () => {
    const pairs = joinMatchups(
      parseMatchups([{ matchup_id: null, roster_id: 4, points: 0 }]),
      parseRosters([{ roster_id: 4, settings: {} }]),
      {},
    );
    expect(pairs).toEqual([]);
  });

  it('sorts by matchup id so the render order is stable', () => {
    const pairs = joinMatchups(
      parseMatchups([
        { matchup_id: 3, roster_id: 1, points: 1 },
        { matchup_id: 1, roster_id: 2, points: 2 },
        { matchup_id: 2, roster_id: 3, points: 3 },
      ]),
      parseRosters([
        { roster_id: 1, settings: {} }, { roster_id: 2, settings: {} }, { roster_id: 3, settings: {} },
      ]),
      {},
    );
    expect(pairs.map((p) => p.matchupId)).toEqual([1, 2, 3]);
  });
});

describe('deepLink', () => {
  it('builds links into the Sleeper app for actions the API cannot perform', () => {
    expect(deepLink.league('L1')).toBe('https://sleeper.com/leagues/L1');
    expect(deepLink.roster('L1', 3)).toBe('https://sleeper.com/leagues/L1/team/3');
    expect(deepLink.matchup('L1', 4)).toBe('https://sleeper.com/leagues/L1/matchup/4');
    expect(deepLink.players('L1')).toBe('https://sleeper.com/leagues/L1/players');
    expect(deepLink.trade('L1')).toBe('https://sleeper.com/leagues/L1/trade');
  });
});

describe('transport wiring', () => {
  it('fetches and parses state through the injected fetcher', async () => {
    setFetcher(vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: JSON.stringify({ week: 1, season: '2026', season_type: 'pre' }),
    }));
    await expect(fetchState()).resolves.toMatchObject({ season: 2026, isPreseason: true });
  });
});
