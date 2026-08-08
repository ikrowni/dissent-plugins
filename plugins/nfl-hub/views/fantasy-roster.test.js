// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { warningsFor, renderPanel, oppCell } from './fantasy-roster.js';

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

const row = (over) => ({
  slot: 'RB', playerId: '1', empty: false, name: 'Bucky Irving', position: 'RB',
  teamAbbr: 'TB', espnId: null, actual: 0, projected: 12.4, played: false, ...over,
});

describe('warningsFor', () => {
  it('flags a starter whose real team is on bye', () => {
    const w = warningsFor(row(), { byeTeams: ['TB'], injuries: {}, games: {} });
    expect(w.some((x) => x.kind === 'bye')).toBe(true);
  });

  it('flags an injured starter, carrying the status through', () => {
    const w = warningsFor(row(), { byeTeams: [], injuries: { 1: 'Out' }, games: {} });
    const inj = w.find((x) => x.kind === 'injury');
    expect(inj).toBeTruthy();
    expect(inj.detail).toContain('Out');
  });

  it('flags an empty starting slot, which is the costliest mistake', () => {
    const w = warningsFor(row({ empty: true, playerId: null }), { byeTeams: [], injuries: {}, games: {} });
    expect(w.some((x) => x.kind === 'empty')).toBe(true);
  });

  it('says nothing about a healthy starter who is playing', () => {
    const w = warningsFor(row(), { byeTeams: [], injuries: {}, games: { TB: { state: 'in' } } });
    expect(w).toEqual([]);
  });

  it('never warns about a player who has already scored — the advice is moot', () => {
    const w = warningsFor(row({ actual: 18.2, played: true }),
      { byeTeams: ['TB'], injuries: { 1: 'Out' }, games: {} });
    expect(w).toEqual([]);
  });

  it('survives missing context', () => {
    expect(warningsFor(row(), null)).toEqual([]);
    expect(warningsFor(null, { byeTeams: [], injuries: {}, games: {} })).toEqual([]);
  });
});

describe('renderPanel', () => {
  const base = {
    week: 14,
    session: { rosterId: 1, leagueId: '55' },
    league: { starterSlots: ['QB', 'RB'], scoringType: 'PPR' },
    joined: [{ matchupId: 1, margin: 0, leaderRosterId: 1,
      home: { rosterId: 1, teamName: 'Mine', points: 30, starters: ['1', '2'], playerPoints: { 1: 18.2 } },
      away: { rosterId: 2, teamName: 'Theirs', points: 20, starters: [], playerPoints: {} } }],
    rosters: [{ rosterId: 1, ownerId: 'u1', pointsFor: 30, potentialPoints: 54.6,
      players: ['1', '2', '3'], starters: ['1', '2'] }],
    users: {}, projections: {}, nfl: { byeTeams: [], injuries: {}, games: {} },
  };

  it('renders a row per starter', () => {
    const d = parse(renderPanel(base));
    expect(d.querySelectorAll('.froster-row').length).toBe(2);
  });

  it('shows the points left on the bench', () => {
    const d = parse(renderPanel(base));
    expect(d.textContent).toContain('24.6');
  });

  it('every warning carries a Sleeper deep-link, since the fix is not possible here', () => {
    const d = parse(renderPanel({ ...base, nfl: { byeTeams: [], injuries: { 2: 'Out' }, games: {} } }));
    const links = [...d.querySelectorAll('.froster-warn a')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute('href')).toContain('sleeper.com/leagues/55');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('does not warn about the starter who already banked points', () => {
    const d = parse(renderPanel({ ...base, nfl: { byeTeams: [], injuries: { 1: 'Out' }, games: {} } }));
    expect(d.querySelectorAll('.froster-row.warned').length).toBe(0);
  });

  it('prompts rather than throwing when the roster is unknown', () => {
    const d = parse(renderPanel({ ...base, session: { rosterId: 999, leagueId: '55' } }));
    expect(d.querySelector('.froster-row')).toBe(null);
  });
});

describe('oppCell', () => {
  const nfl = { games: { TB: { opponentAbbr: 'DAL', state: 'pre' } }, byeTeams: [], injuries: {} };
  const strength = { DAL: { rank: 3, pointsAgainst: 180 } };

  it('shows the opponent and its defensive rank', () => {
    const html = oppCell(row(), { nfl, strength });
    expect(html).toContain('DAL');
    expect(html).toContain('#3');
  });

  it('marks a top-third defense as a tough draw', () => {
    expect(oppCell(row(), { nfl, strength })).toContain('opp-tough');
  });

  it('marks a bottom-third defense as soft', () => {
    expect(oppCell(row(), { nfl, strength: { DAL: { rank: 30, pointsAgainst: 400 } } }))
      .toContain('opp-soft');
  });

  it('shows a bye instead of inventing an opponent', () => {
    const html = oppCell(row(), { nfl: { games: {}, byeTeams: ['TB'], injuries: {} }, strength });
    expect(html).toContain('BYE');
  });

  it('renders a dash when the strength table has not loaded', () => {
    expect(oppCell(row(), { nfl, strength: {} })).toContain('opp-none');
  });

  it('renders a dash for a player with no team', () => {
    expect(oppCell(row({ teamAbbr: '' }), { nfl, strength })).toContain('opp-none');
  });
});

describe('the opponent column is labelled honestly', () => {
  // Read through Vite's ?raw rather than readFileSync: this file runs under jsdom, where
  // import.meta.url is an http: URL and node:fs refuses it.
  it('says strength, never difficulty — it is not per-position', async () => {
    const { default: src } = await import('./fantasy-roster.js?raw');
    expect(src).toMatch(/Opp strength/);
    expect(src).not.toMatch(/Opp difficulty/);
  });
});
