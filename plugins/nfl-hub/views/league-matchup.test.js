import { describe, it, expect, beforeEach } from 'vitest';
import { pairingsFor, render, expand, reset, _state } from './league-matchup.js';
import { setIndex } from '../core/player-index.js';

const league = (teamIds, over = {}) => ({
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

describe('pairingsFor', () => {
  it('pairs every team exactly once in a week', () => {
    const pairs = pairingsFor(league(['t1', 't2', 't3', 't4']), 1);
    const involved = pairs.flatMap((m) => [m.home, m.away]).filter(Boolean);
    expect(new Set(involved).size).toBe(4);
    expect(pairs).toHaveLength(2);
  });

  it('gives different pairings in different weeks', () => {
    const lg = league(['t1', 't2', 't3', 't4']);
    const sig = (w) => pairingsFor(lg, w).map((m) => [m.home, m.away].sort().join('-')).sort().join('|');
    expect(sig(1)).not.toBe(sig(2));
  });

  // ⚠️ Derived from the SAME pure function the server would use, so this must be
  // stable — two managers computing different opponents is worse than no view.
  it('is deterministic across calls', () => {
    const lg = league(['t1', 't2', 't3', 't4']);
    expect(pairingsFor(lg, 3)).toEqual(pairingsFor(lg, 3));
  });

  it('produces a bye for an odd number of teams', () => {
    const pairs = pairingsFor(league(['t1', 't2', 't3']), 1);
    expect(pairs.filter((m) => m.bye)).toHaveLength(1);
  });

  it('returns nothing for a league too small or a missing week', () => {
    expect(pairingsFor(league(['t1']), 1)).toEqual([]);
    expect(pairingsFor(league(['t1', 't2']), null)).toEqual([]);
    expect(pairingsFor(null, 1)).toEqual([]);
  });
});

describe('render', () => {
  const setup = (over = {}) => {
    Object.assign(_state, {
      leagueId: 'lg', league: league(['t1', 't2']), week: 3, loaded: true,
      error: null, expanded: null, scores: null, ...over,
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
    setup({ league: league(['t1', 't2', 't3']) });
    expect(render()).toContain('bye');
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
