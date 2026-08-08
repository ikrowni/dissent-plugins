// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseLeague, parseRosters, parseLeagueUsers, parseMatchups, parseProjections, joinMatchups,
} from '../core/sleeper.js';
import { renderPanel, findMyMatchup } from './fantasy-matchup.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const fx = (n) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));

const league = parseLeague(fx('sleeper-league.json'));
const rosters = parseRosters(fx('sleeper-rosters.json'));
const users = parseLeagueUsers(fx('sleeper-users.json'));
const matchups = parseMatchups(fx('sleeper-matchups-w14.json'));
const projections = parseProjections(fx('sleeper-projections-w14.json'));
const joined = joinMatchups(matchups, rosters, users);

const base = {
  league, rosters, users, projections, joined, week: 14,
  session: { rosterId: joined[0].home.rosterId, leagueId: '1182033380414181376' },
};
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('findMyMatchup', () => {
  it('finds the matchup containing my roster, from either side', () => {
    const m = findMyMatchup(joined, joined[0].away.rosterId);
    expect(m?.matchupId).toBe(joined[0].matchupId);
    expect(m.me.rosterId).toBe(joined[0].away.rosterId);
    expect(m.opp.rosterId).toBe(joined[0].home.rosterId);
  });

  it('returns null for a roster on no matchup', () => {
    expect(findMyMatchup(joined, 9999)).toBe(null);
    expect(findMyMatchup(null, 1)).toBe(null);
  });
});

describe('renderPanel', () => {
  it('renders both team names and both scores', () => {
    const d = parse(renderPanel(base));
    expect(d.textContent).toContain(joined[0].home.teamName);
    expect(d.textContent).toContain(joined[0].away.teamName);
    expect(d.querySelectorAll('[data-score]').length).toBe(2);
  });

  it('shows a win probability that reads as a percentage', () => {
    const d = parse(renderPanel(base));
    const wp = d.querySelector('.fmatch-wp');
    expect(wp).toBeTruthy();
    expect(wp.textContent).toMatch(/\d+%/);
  });

  it('renders one lineup row per starter slot', () => {
    const d = parse(renderPanel(base));
    const rows = d.querySelectorAll('.flineup-row:not(.head)');
    expect(rows.length).toBe(league.starterSlots.length);
  });

  it('labels SUPER_FLEX readably rather than with the raw slug', () => {
    const d = parse(renderPanel(base));
    expect(d.textContent).toContain('SUPER FLEX');
  });

  it('shows projected alongside actual', () => {
    const d = parse(renderPanel(base));
    expect(d.querySelector('.fmatch-proj')).toBeTruthy();
  });

  it('prompts onboarding rather than erroring when the roster is not in this league', () => {
    const d = parse(renderPanel({ ...base, session: { rosterId: 9999 } }));
    expect(d.textContent).toMatch(/matchup/i);
    expect(d.querySelector('.flineup-row')).toBe(null);
  });

  it('degrades to actual-only when projections failed, without throwing', () => {
    const d = parse(renderPanel({ ...base, projections: {} }));
    expect(d.querySelectorAll('.flineup-row:not(.head)').length).toBe(league.starterSlots.length);
  });

  it('deep-links into Sleeper, because the lineup cannot be changed here', () => {
    const d = parse(renderPanel(base));
    const link = d.querySelector('a[href^="https://sleeper.com/leagues/"]');
    expect(link).toBeTruthy();
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('renderPanel — live NFL context', () => {
  it('shows the real-game situation beside the fantasy points', () => {
    const nfl = {
      games: { PHI: { state: 'in', period: 3, clock: '4:20', margin: 7 } },
      byeTeams: [], injuries: {},
    };
    const d = parse(renderPanel({ ...base, nfl }));
    expect(d.querySelector('.flineup-ctx')).toBeTruthy();
  });

  it('renders without an nfl context at all rather than throwing', () => {
    const d = parse(renderPanel({ ...base, nfl: null }));
    expect(d.querySelectorAll('.flineup-row:not(.head)').length).toBe(league.starterSlots.length);
  });

  it('lazy-loads every headshot — 24 rows at ~99 KB each is metered bandwidth', () => {
    const d = parse(renderPanel(base));
    const shots = [...d.querySelectorAll('.flineup-shot')];
    expect(shots.length).toBeGreaterThan(0);
    for (const img of shots) expect(img.getAttribute('loading')).toBe('lazy');
  });
});
