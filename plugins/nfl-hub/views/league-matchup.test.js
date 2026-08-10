import { describe, it, expect, beforeEach } from 'vitest';
import { pairingsFor, render, expand, reset, _state } from './league-matchup.js';
import { setIndex } from '../core/player-index.js';

const league = (teamIds, over = {}) => ({
  isCommissioner: true,
  teams: Object.fromEntries(teamIds.map((id) => [id, { id, name: `Team ${id.toUpperCase()}` }])),
  myTeams: ['t1'],
  season: 2025,
  settings: { startWeek: 1, playoffWeekStart: 15 },
  ...over,
});

beforeEach(() => {
  reset();
  setIndex({ p1: { n: 'Pat One', p: 'QB', t: 'KC' } });
});

// A stored schedule record, the shape schedule:generate writes.
const scheduleRecord = (weeks) => ({
  season: 2025, startWeek: 1, teamIds: ['t1', 't2'], generatedAt: 1, weeks,
});

describe('pairingsFor', () => {
  const stored = scheduleRecord([
    { week: 1, matchups: [{ home: 't1', away: 't2', bye: false }] },
    { week: 2, matchups: [{ home: 't2', away: 't1', bye: false }] },
    { week: 3, matchups: [{ home: 't1', away: null, bye: true }] },
  ]);

  it('reads the week straight out of the stored schedule', () => {
    expect(pairingsFor(stored, 1)).toEqual([{ home: 't1', away: 't2', bye: false }]);
    expect(pairingsFor(stored, 2)).toEqual([{ home: 't2', away: 't1', bye: false }]);
  });

  it('accepts a week given as a string, since it arrives from the DOM', () => {
    expect(pairingsFor(stored, '1')).toHaveLength(1);
  });

  // ⚠️ NEVER computed here. Inventing pairings would put a second answer to
  // "who plays whom" in circulation, and the two only diverge once somebody
  // joins — long after anyone would think to look.
  it('returns nothing rather than deriving when there is no schedule', () => {
    expect(pairingsFor(null, 1)).toEqual([]);
    expect(pairingsFor(undefined, 1)).toEqual([]);
    expect(pairingsFor(stored, null)).toEqual([]);
  });

  it('returns nothing for a week outside the schedule', () => {
    expect(pairingsFor(stored, 99)).toEqual([]);
  });

  it('carries a bye through as a bye', () => {
    expect(pairingsFor(stored, 3)[0].bye).toBe(true);
  });
});

describe('render', () => {
  const twoTeamWeek3 = scheduleRecord([
    { week: 3, matchups: [{ home: 't1', away: 't2', bye: false }] },
  ]);

  const setup = (over = {}) => {
    Object.assign(_state, {
      leagueId: 'lg', league: league(['t1', 't2']), week: 3, loaded: true,
      error: null, expanded: null, scores: null, busy: false,
      schedule: twoTeamWeek3, ...over,
    });
  };

  it('says the season has not started when there is no week', () => {
    setup({ week: null });
    expect(render()).toContain('has not started');
  });

  // ⚠️ "Not scored yet" is a NORMAL state, not an error. Showing a failure for a
  // week nobody has played would send managers looking for a bug.
  it('shows dashes rather than an error before a week is scored', () => {
    setup();
    const html = render();
    expect(html).toContain('—');
    expect(html).not.toContain('Try again');
  });

  it('shows both scores and marks the leader', () => {
    setup({ scores: { teams: { t1: { total: 101.5, rows: [] }, t2: { total: 88.25, rows: [] } } } });
    const html = render();
    expect(html).toContain('101.50');
    expect(html).toContain('88.25');
    expect(html).toContain('winning');
  });

  it('marks neither side when the scores are level', () => {
    setup({ scores: { teams: { t1: { total: 90, rows: [] }, t2: { total: 90, rows: [] } } } });
    expect(render()).not.toContain('winning');
  });

  it('marks the viewer’s own team', () => {
    setup();
    expect(render()).toContain('(you)');
  });

  it('renders a bye as a bye rather than half a card', () => {
    setup({
      league: league(['t1', 't2', 't3']),
      schedule: scheduleRecord([{ week: 3, matchups: [{ home: 't3', away: null, bye: true }] }]),
    });
    expect(render()).toContain('bye');
  });

  // ⚠️ No schedule is a NORMAL state, not an error — and only a commissioner is
  // offered the fix, because only a commissioner can perform it.
  it('offers a commissioner the generate button when no schedule exists', () => {
    setup({ schedule: null });
    const html = render();
    expect(html).toContain('No schedule has been generated');
    expect(html).toContain('matchup-generate');
  });

  it('tells a non-commissioner who to ask, without a button they cannot use', () => {
    const lg = league(['t1', 't2']);
    lg.isCommissioner = false;
    setup({ schedule: null, league: lg });
    const html = render();
    expect(html).toContain('commissioner needs to generate');
    expect(html).not.toContain('matchup-generate');
  });

  it('says a week is outside the schedule rather than showing nothing', () => {
    setup({ week: 9 });
    expect(render()).toContain('not in the schedule');
  });

  it('expands a lineup on demand, with player names', () => {
    setup({
      scores: { teams: { t1: { total: 10, rows: [{ slot: 'QB', playerId: 'p1', points: 10 }] }, t2: { total: 5, rows: [] } } },
    });
    expect(render()).not.toContain('Pat One');
    expand(null, 't1');
    const html = render();
    expect(html).toContain('Pat One');
    expect(html).toContain('10.00');
  });

  it('toggles the same team closed again', () => {
    setup({ scores: { teams: { t1: { total: 10, rows: [{ slot: 'QB', playerId: 'p1', points: 10 }] } } } });
    expand(null, 't1');
    expand(null, 't1');
    expect(render()).not.toContain('Pat One');
  });

  it('renders an error as a pane with a retry', () => {
    setup({ error: 'the league engine is not running' });
    const html = render();
    expect(html).toContain('not running');
    expect(html).toContain('matchup-retry');
  });

  it('escapes team names rather than injecting them', () => {
    const lg = league(['t1', 't2']);
    lg.teams.t1.name = '<img src=x onerror=alert(1)>';
    setup({ league: lg });
    const html = render();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
