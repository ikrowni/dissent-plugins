// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseLeague, parseRosters, parseLeagueUsers, parseMatchups, parseProjections, joinMatchups,
} from '../core/sleeper.js';
import { renderPanel, closestGame, biggestBlowout } from './fantasy-matchups.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const fx = (n) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));

const league = parseLeague(fx('sleeper-league.json'));
const rosters = parseRosters(fx('sleeper-rosters.json'));
const users = parseLeagueUsers(fx('sleeper-users.json'));
const joined = joinMatchups(parseMatchups(fx('sleeper-matchups-w14.json')), rosters, users);
const projections = parseProjections(fx('sleeper-projections-w14.json'));

const base = {
  league, rosters, users, projections, joined, week: 14,
  session: { state: { rosterId: joined[0].home.rosterId, leagueId: '1' } },
};
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('closestGame / biggestBlowout', () => {
  it('picks the smallest and largest margins', () => {
    const close = closestGame(joined);
    const blow = biggestBlowout(joined);
    expect(close.margin).toBeLessThanOrEqual(blow.margin);
    for (const m of joined) {
      expect(close.margin).toBeLessThanOrEqual(m.margin);
      expect(blow.margin).toBeGreaterThanOrEqual(m.margin);
    }
  });

  it('ignores byes, which have no opponent and a fake margin of 0', () => {
    const withBye = [...joined,
      { matchupId: 99, home: { rosterId: 50, points: 100 }, away: null, margin: 0 }];
    expect(closestGame(withBye).matchupId).not.toBe(99);
  });

  it('returns null for an empty week', () => {
    expect(closestGame([])).toBe(null);
    expect(biggestBlowout(null)).toBe(null);
  });
});

describe('renderPanel', () => {
  it('renders one card per matchup', () => {
    const d = parse(renderPanel(base));
    expect(d.querySelectorAll('.fmini').length).toBe(joined.length);
  });

  it('marks the viewer’s own matchup so it is findable at a glance', () => {
    const d = parse(renderPanel(base));
    expect(d.querySelectorAll('.fmini.mine').length).toBe(1);
  });

  it('calls out the closest game and the blowout', () => {
    const d = parse(renderPanel(base));
    expect(d.textContent).toMatch(/closest/i);
    expect(d.textContent).toMatch(/blowout/i);
  });

  it('says so plainly when the week has no matchups', () => {
    const d = parse(renderPanel({ ...base, joined: [] }));
    expect(d.querySelector('.fmini')).toBe(null);
    expect(d.textContent).toMatch(/no matchups/i);
  });

  it('renders a bye side without inventing an opponent', () => {
    const bye = [{ matchupId: 1, margin: 0, leaderRosterId: 1,
      home: { rosterId: 1, teamName: 'Solo', points: 90, starters: [], playerPoints: {} },
      away: null }];
    const d = parse(renderPanel({ ...base, joined: bye }));
    expect(d.textContent).toContain('Bye');
  });

  it('escapes hostile team names', () => {
    const evil = [{ matchupId: 1, margin: 0, leaderRosterId: 2,
      home: { rosterId: 1, teamName: '<img src=x onerror=alert(1)>', points: 1, starters: [], playerPoints: {} },
      away: { rosterId: 2, teamName: 'ok', points: 2, starters: [], playerPoints: {} } }];
    const d = parse(renderPanel({ ...base, joined: evil }));
    expect(d.querySelector('img')).toBe(null);
  });
});
