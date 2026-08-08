// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseTeamRoster, parseTeamRecord, parseDepthChart, parseTeamSchedule,
} from '../core/espn-team.js';
import { parseRosterInjuries } from '../core/espn-league.js';
import { renderTeam, formStrip, groupRoster } from './team.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const fx = (n) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));
const rosterRaw = fx('team-roster-phi.json');
const roster = parseTeamRoster(rosterRaw);
const s = {
  loading: false, error: null,
  team: parseTeamRecord(rosterRaw),
  roster,
  injuries: parseRosterInjuries(rosterRaw),
  depth: parseDepthChart(fx('depthchart-phi.json'), roster),
  schedule: parseTeamSchedule(fx('team-schedule-phi.json'), 'PHI'),
};
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('groupRoster', () => {
  it('buckets every athlete exactly once', () => {
    const g = groupRoster(roster);
    const total = Object.values(g).reduce((n, list) => n + list.length, 0);
    expect(total).toBe(roster.length);
    expect(Object.keys(g).length).toBeGreaterThan(1);
  });
  it('puts quarterbacks on offense and kickers on special teams', () => {
    const g = groupRoster([
      { position: 'QB', name: 'a' }, { position: 'K', name: 'b' }, { position: 'CB', name: 'c' },
    ]);
    expect(g.Offense).toHaveLength(1);
    expect(g['Special teams']).toHaveLength(1);
    expect(g.Defense).toHaveLength(1);
  });
  it('handles an empty roster', () => {
    expect(Object.values(groupRoster([])).every((l) => l.length === 0)).toBe(true);
  });
});

describe('formStrip', () => {
  it('renders one tile per completed game only', () => {
    const el = parse(formStrip([
      { id: '1', state: 'post', result: 'W', opponentAbbr: 'DAL', myScore: 24, theirScore: 20, isHome: true },
      { id: '2', state: 'post', result: 'L', opponentAbbr: 'NYG', myScore: 10, theirScore: 17, isHome: false },
      { id: '3', state: 'pre', result: null, opponentAbbr: 'WSH' },
    ]));
    expect(el.querySelectorAll('.form-tile')).toHaveLength(2);
    expect(el.textContent).toContain('W');
    expect(el.textContent).toContain('L');
  });
  it('renders nothing before any game is played', () => {
    expect(formStrip([{ id: '1', state: 'pre' }])).toBe('');
    expect(formStrip([])).toBe('');
    expect(formStrip(null)).toBe('');
  });
});

describe('renderTeam', () => {
  it('renders loading, error and no-team states', () => {
    expect(parse(renderTeam({ loading: true })).querySelector('.spinner')).not.toBeNull();
    expect(parse(renderTeam({ error: 'x' })).querySelector('[data-act="retry"]')).not.toBeNull();
    expect(parse(renderTeam({ team: null })).textContent).toMatch(/choose a team/i);
  });

  it('renders the team hero with a local logo', () => {
    const el = parse(renderTeam(s));
    expect(el.textContent).toMatch(/Eagles/);
    for (const img of el.querySelectorAll('img')) {
      expect(img.getAttribute('src')).not.toMatch(/^https:\/\/a\.espncdn\.com\/i\/teamlogos/);
    }
  });

  it('renders roster, depth chart and schedule sections', () => {
    const txt = parse(renderTeam(s)).textContent;
    for (const want of [/roster/i, /depth chart/i, /schedule/i]) expect(txt).toMatch(want);
  });

  it('makes every roster player clickable into a player page', () => {
    expect(parse(renderTeam(s)).querySelectorAll('[data-act="player"]').length)
      .toBeGreaterThan(10);
  });

  it('includes a back control', () => {
    expect(parse(renderTeam(s)).querySelector('[data-act="nav"]')).not.toBeNull();
  });

  it('degrades each section independently', () => {
    const el = parse(renderTeam({ ...s, depth: [], schedule: [], injuries: [] }));
    expect(el.textContent).toMatch(/Eagles/);
    expect(el.querySelectorAll('[data-act="player"]').length).toBeGreaterThan(10);
    expect(el.textContent).not.toMatch(/depth chart/i);
  });

  it('never renders undefined', () => {
    expect(parse(renderTeam(s)).textContent).not.toContain('undefined');
  });
});
