import { describe, it, expect, vi } from 'vitest';
import { suggestRoster, createSession } from './fantasy-session.js';

const users = {
  u1: { id: 'u1', displayName: 'MyLeekNeighbor', teamName: 'Leeks', avatar: null },
  u2: { id: 'u2', displayName: 'joelcab26', teamName: 'Cabs', avatar: null },
  u3: { id: 'u3', displayName: 'suggsasaurus', teamName: 'Suggs', avatar: null },
};
const rosters = [
  { rosterId: 1, ownerId: 'u1' }, { rosterId: 2, ownerId: 'u2' }, { rosterId: 3, ownerId: 'u3' },
];

describe('suggestRoster', () => {
  it('matches a Dissent display name to a Sleeper display name', () => {
    const s = suggestRoster({ username: 'joel', displayName: 'joelcab26' }, users, rosters);
    expect(s?.rosterId).toBe(2);
  });

  it('falls back to the Dissent username when there is no display name', () => {
    const s = suggestRoster({ username: 'suggsasaurus', displayName: null }, users, rosters);
    expect(s?.rosterId).toBe(3);
  });

  it('matches case- and punctuation-insensitively', () => {
    const s = suggestRoster({ username: 'x', displayName: 'My.Leek Neighbor' }, users, rosters);
    expect(s?.rosterId).toBe(1);
  });

  it('an exact match anywhere beats a space-insensitive one earlier in the list', () => {
    const u2 = {
      a: { id: 'a', displayName: 'JonSnow', teamName: 'A' },   // loose match, roster 1
      b: { id: 'b', displayName: 'Jon Snow', teamName: 'B' },  // exact match, roster 2
    };
    const r2 = [{ rosterId: 1, ownerId: 'a' }, { rosterId: 2, ownerId: 'b' }];
    const s = suggestRoster({ username: 'x', displayName: 'Jon Snow' }, u2, r2);
    expect(s?.rosterId).toBe(2);
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(suggestRoster({ username: 'nobody', displayName: 'Nobody' }, users, rosters)).toBe(null);
  });

  it('survives missing inputs', () => {
    expect(suggestRoster(null, users, rosters)).toBe(null);
    expect(suggestRoster({ username: 'a' }, null, null)).toBe(null);
  });
});

describe('createSession', () => {
  const mkStore = (initial = {}) => {
    const data = { ...initial };
    return {
      data,
      getUser: vi.fn(async (k, fb) => (k in data ? data[k] : fb)),
      setUser: vi.fn(async (k, v) => { data[k] = v; return true; }),
    };
  };

  it('starts in the onboarding state with nothing stored', async () => {
    const s = createSession({ store: mkStore() });
    await s.load();
    expect(s.state.step).toBe('username');
    expect(s.state.leagueId).toBe(null);
  });

  it('restores a stored league and roster and goes straight to ready', async () => {
    const store = mkStore({ prefs: { sleeperLeagueId: '123', sleeperRosterId: 4 } });
    const s = createSession({ store });
    await s.load();
    expect(s.state.step).toBe('ready');
    expect(s.state.leagueId).toBe('123');
    expect(s.state.rosterId).toBe(4);
  });

  it('seeds the league from channel config when the user has stored nothing', async () => {
    const s = createSession({ store: mkStore(), configLeagueId: '999' });
    await s.load();
    expect(s.state.leagueId).toBe('999');
    // A server-wide default still needs the user to say which roster is theirs.
    expect(s.state.step).toBe('roster');
  });

  it('a stored user preference beats the channel default', async () => {
    const store = mkStore({ prefs: { sleeperLeagueId: '123', sleeperRosterId: 4 } });
    const s = createSession({ store, configLeagueId: '999' });
    await s.load();
    expect(s.state.leagueId).toBe('123');
  });

  it('persists the choice WITHOUT clobbering unrelated prefs', async () => {
    const store = mkStore({ prefs: { reduceMotion: true } });
    const s = createSession({ store });
    await s.load();
    await s.choose({ leagueId: '55', rosterId: 7 });
    expect(store.data.prefs).toEqual({
      reduceMotion: true, sleeperLeagueId: '55', sleeperRosterId: 7,
    });
    expect(s.state.step).toBe('ready');
  });

  it('reset returns to onboarding and clears only the fantasy keys', async () => {
    const store = mkStore({ prefs: { reduceMotion: true, sleeperLeagueId: '55', sleeperRosterId: 7 } });
    const s = createSession({ store });
    await s.load();
    await s.reset();
    expect(store.data.prefs).toEqual({ reduceMotion: true });
    expect(s.state.step).toBe('username');
  });

  it('setLeagues advances to the league picker, or reports the empty case', async () => {
    const s = createSession({ store: mkStore() });
    await s.load();
    s.setLeagues('bob', 'uid', [{ id: '1', name: 'L' }]);
    expect(s.state.step).toBe('league');
    s.setLeagues('bob', 'uid', []);
    expect(s.state.step).toBe('username');
    expect(s.state.error).toMatch(/no nfl leagues/i);
  });

  it('selectLeague moves to the roster step and drops any earlier roster pick', async () => {
    const store = mkStore({ prefs: { sleeperLeagueId: '1', sleeperRosterId: 9 } });
    const s = createSession({ store });
    await s.load();
    s.selectLeague('77');
    expect(s.state.leagueId).toBe('77');
    expect(s.state.rosterId).toBe(null);
    expect(s.state.step).toBe('roster');
  });
});
