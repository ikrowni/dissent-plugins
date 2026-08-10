import { describe, it, expect, beforeEach } from 'vitest';
import { render, reset, describe as describeErr, _state } from './league-home.js';

const league = (over = {}) => ({
  id: 'lg',
  settings: { name: 'Our League', format: 'redraft', playoffTeams: 2 },
  season: 2025,
  currentWeek: 3,
  teams: {
    t1: { id: 't1', name: 'Alice FC' },
    t2: { id: 't2', name: 'Bob United' },
    t3: { id: 't3', name: 'Cara City' },
  },
  assets: { rosters: { t1: { players: ['a', 'b'] }, t2: { players: ['c'] }, t3: { players: [] } } },
  myTeams: ['t1'],
  isCommissioner: true,
  ...over,
});

const standings = (weeks, rows) => ({ season: 2025, weeks, scheduled: true, standings: rows });

beforeEach(reset);

const setup = (over = {}) => {
  Object.assign(_state, {
    leagues: [{ id: 'lg', name: 'Our League', teamCount: 3, myTeams: ['t1'], isCommissioner: true }],
    leagueId: 'lg', league: league(), scores: null, standings: null,
    error: null, busy: false, ...over,
  });
};

describe('standings table', () => {
  // ⚠️ A column of 0-0 before anyone has played looks like a played season in
  // which everybody drew. Fall back to a roster listing instead.
  it('shows rosters, not records, before any week is scored', () => {
    setup({ standings: standings(0, []) });
    const html = render();
    expect(html).toContain('Records appear once a week has been scored');
    expect(html).not.toContain('W-L-T');
  });

  it('shows records once a week has been scored', () => {
    setup({
      standings: standings(3, [
        { teamId: 't2', seed: 1, wins: 3, losses: 0, ties: 0, pointsFor: 310.5, pointsAgainst: 250 },
        { teamId: 't1', seed: 2, wins: 2, losses: 1, ties: 0, pointsFor: 300, pointsAgainst: 260.25 },
        { teamId: 't3', seed: 3, wins: 0, losses: 3, ties: 1, pointsFor: 200, pointsAgainst: 300 },
      ]),
    });
    const html = render();
    expect(html).toContain('W-L-T');
    expect(html).toContain('3-0');
    expect(html).toContain('2-1');
    expect(html).toContain('310.50');
    expect(html).toContain('After 3 scored weeks');
  });

  it('shows ties only when there are any', () => {
    setup({
      standings: standings(1, [
        { teamId: 't1', seed: 1, wins: 1, losses: 0, ties: 0, pointsFor: 1, pointsAgainst: 0 },
        { teamId: 't2', seed: 2, wins: 0, losses: 0, ties: 1, pointsFor: 1, pointsAgainst: 1 },
      ]),
    });
    const html = render();
    expect(html).toContain('1-0<');   // no trailing -0 for a team with no ties
    expect(html).toContain('0-0-1');
  });

  it('orders by the seed the module supplied rather than re-ranking', () => {
    setup({
      standings: standings(2, [
        { teamId: 't3', seed: 1, wins: 2, losses: 0, ties: 0, pointsFor: 100, pointsAgainst: 50 },
        { teamId: 't1', seed: 2, wins: 1, losses: 1, ties: 0, pointsFor: 400, pointsAgainst: 90 },
      ]),
    });
    const html = render();
    expect(html.indexOf('Cara City')).toBeLessThan(html.indexOf('Alice FC'));
  });

  // ⚠️ The cut is drawn only once records exist; over an all-zero table it would
  // show a playoff line decided by nothing.
  it('marks the playoff cut after the last qualifying seed', () => {
    setup({
      standings: standings(2, [
        { teamId: 't1', seed: 1, wins: 2, losses: 0, ties: 0, pointsFor: 200, pointsAgainst: 100 },
        { teamId: 't2', seed: 2, wins: 1, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 150 },
        { teamId: 't3', seed: 3, wins: 0, losses: 2, ties: 0, pointsFor: 100, pointsAgainst: 200 },
      ]),
    });
    const html = render();
    expect(html).toContain('playoff-cut');
    expect(html).toContain('top 2 make the playoffs');
  });

  it('draws no cut before any week is scored', () => {
    setup({ standings: standings(0, []) });
    expect(render()).not.toContain('playoff-cut');
  });

  it('marks the viewer’s own team', () => {
    setup({
      standings: standings(1, [{ teamId: 't1', seed: 1, wins: 1, losses: 0, ties: 0, pointsFor: 1, pointsAgainst: 0 }]),
    });
    expect(render()).toContain('(you)');
  });

  it('falls back gracefully when standings failed to load', () => {
    setup({ standings: null });
    const html = render();
    expect(html).toContain('Alice FC');
    expect(html).not.toContain('W-L-T');
  });

  it('says so plainly when a league has no teams', () => {
    setup({ league: league({ teams: {}, assets: { rosters: {} } }) });
    expect(render()).toContain('No teams yet');
  });

  it('escapes team names rather than injecting them', () => {
    const lg = league();
    lg.teams.t1.name = '<img src=x onerror=alert(1)>';
    setup({
      league: lg,
      standings: standings(1, [{ teamId: 't1', seed: 1, wins: 1, losses: 0, ties: 0, pointsFor: 1, pointsAgainst: 0 }]),
    });
    const html = render();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('describe (error text)', () => {
  // ⚠️ The module's own refusals are written for a person; replacing them with a
  // generic failure throws away the only explanation the user gets.
  it('passes a module refusal through verbatim', () => {
    expect(describeErr(new Error('you do not manage team t1'))).toBe('you do not manage team t1');
  });

  it('translates an unreachable engine into something actionable', () => {
    expect(describeErr(new Error('this plugin has no server module enabled')))
      .toContain('server admin');
  });

  it('never returns an empty message', () => {
    expect(describeErr(new Error(''))).toBe('Something went wrong.');
    expect(describeErr(null)).toBe('Something went wrong.');
  });
});
