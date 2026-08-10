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
    // A styled badge rather than a parenthetical — assert the intent, not the
    // exact characters, or every restyle "fails" for the wrong reason.
    expect(render()).toContain('class="you"');
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

describe('playoff bracket', () => {
  const seedRow = (id, seed) => ({ teamId: id, seed });
  const bracket = (over = {}) => ({
    season: 2025, playoffWeekStart: 15, reseed: true,
    seeds: [seedRow('t1', 1), seedRow('t2', 2)],
    byes: [],
    champion: null,
    isCommissioner: true,
    rounds: [{ round: 1, week: 15, games: [{ home: seedRow('t1', 1), away: seedRow('t2', 2), winner: null }] }],
    ...over,
  });

  const setup = (over = {}) => {
    Object.assign(_state, {
      leagueId: 'lg', league: league(['t1', 't2']), week: 15, loaded: true,
      error: null, expanded: null, scores: null, busy: false,
      schedule: null, bracket: null, ...over,
    });
  };

  // ⚠️ From playoffWeekStart onward the bracket replaces the regular pairing —
  // showing a regular-season opponent in a playoff week names a team they are
  // not playing.
  it('takes over from the regular season in a playoff week', () => {
    setup({ bracket: bracket() });
    const html = render();
    expect(html).toContain('Playoffs');
    expect(html).not.toContain('Week 15</span>'); // not the regular matchup header
  });

  it('offers a commissioner the seed button before the bracket exists', () => {
    setup({ bracket: null });
    const html = render();
    expect(html).toContain('has not been seeded');
    expect(html).toContain('matchup-start-playoffs');
  });

  it('tells a non-commissioner who to ask', () => {
    const lg = league(['t1', 't2']);
    lg.isCommissioner = false;
    setup({ bracket: null, league: lg });
    const html = render();
    expect(html).toContain('commissioner needs to seed');
    expect(html).not.toContain('matchup-start-playoffs');
  });

  // ⚠️ "Round 2 of 3" says nothing; "Semi-final" says exactly where you are.
  it('names rounds from the end', () => {
    setup({
      bracket: bracket({
        rounds: [
          { round: 1, week: 15, games: [{ home: seedRow('t3', 3), away: seedRow('t4', 4), winner: null }] },
          { round: 2, week: 16, games: [{ home: seedRow('t1', 1), away: seedRow('t2', 2), winner: null }] },
          { round: 3, week: 17, games: [{ home: seedRow('t1', 1), away: seedRow('t2', 2), winner: null }] },
        ],
      }),
    });
    const html = render();
    expect(html).toContain('Quarter-final');
    expect(html).toContain('Semi-final');
    expect(html).toContain('Final');
  });

  it('shows a single round as the Final', () => {
    setup({ bracket: bracket() });
    expect(render()).toContain('Final');
  });

  it('marks the winner of a decided game', () => {
    setup({
      bracket: bracket({
        rounds: [{ round: 1, week: 15, games: [{ home: seedRow('t1', 1), away: seedRow('t2', 2), winner: seedRow('t1', 1) }] }],
      }),
    });
    expect(render()).toContain('winning');
  });

  it('announces a champion', () => {
    setup({ bracket: bracket({ champion: seedRow('t1', 1) }) });
    const html = render();
    expect(html).toContain('🏆');
    expect(html).toContain('wins the league');
  });

  it('names the bye teams', () => {
    setup({ bracket: bracket({ byes: [seedRow('t1', 1)] }) });
    expect(render()).toContain('Bye:');
  });

  // A fantasy week genuinely can tie, and leaving it undecided would stall the
  // bracket forever — so the tiebreak is shown rather than hidden.
  it('says when a game was decided on seed', () => {
    setup({
      bracket: bracket({
        rounds: [{ round: 1, week: 15, games: [{ home: seedRow('t1', 1), away: seedRow('t2', 2), winner: seedRow('t1', 1), tie: true }] }],
      }),
    });
    expect(render()).toContain('higher seed advances');
  });

  it('escapes team names in the bracket too', () => {
    const lg = league(['t1', 't2']);
    lg.teams.t1.name = '<img src=x onerror=alert(1)>';
    setup({ league: lg, bracket: bracket() });
    const html = render();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  describe('consolation side', () => {
    const alsoRan = (id, seed, overallSeed) => ({ teamId: id, seed, overallSeed });
    const withConsolation = (over = {}) => bracket({
      consolation: {
        seeds: [alsoRan('t3', 1, 3), alsoRan('t4', 2, 4)],
        byes: [],
        champion: null,
        rounds: [{
          round: 1,
          week: 15,
          games: [{ home: alsoRan('t3', 1, 3), away: alsoRan('t4', 2, 4), winner: null }],
        }],
      },
      ...over,
    });

    // ⚠️ A league that does not run one must get no section at all — an empty
    // "Consolation bracket" heading tells half the league their season is over.
    it('shows nothing when the league has no consolation side', () => {
      setup({ bracket: bracket({ consolation: null }) });
      expect(render()).not.toContain('Consolation');
    });

    it('renders the consolation pairings alongside the championship', () => {
      setup({ league: league(['t1', 't2', 't3', 't4']), bracket: withConsolation() });
      const html = render();
      expect(html).toContain('Consolation bracket');
      expect(html).toContain('Team T3');
      expect(html).toContain('Team T4');
    });

    // ⚠️ The local seed is what pairs them; the OVERALL finish is what a manager
    // recognises. Printing "#1" for the third-best team reads as a mix-up.
    it('labels also-rans by their overall finish, not their local seed', () => {
      setup({ league: league(['t1', 't2', 't3', 't4']), bracket: withConsolation() });
      const html = render();
      expect(html).toContain('#3');
      expect(html).toContain('#4');
    });

    it('names the consolation rounds apart from the championship rounds', () => {
      setup({ league: league(['t1', 't2', 't3', 't4']), bracket: withConsolation() });
      const html = render();
      expect(html).toContain('Consolation final');
      // The championship final keeps its own unprefixed name.
      expect(html).toContain('>Final ');
    });

    it('closes the consolation with its own line, not the league trophy', () => {
      setup({
        league: league(['t1', 't2', 't3', 't4']),
        bracket: withConsolation({
          consolation: {
            seeds: [alsoRan('t3', 1, 3), alsoRan('t4', 2, 4)],
            byes: [],
            champion: alsoRan('t3', 1, 3),
            rounds: [{
              round: 1,
              week: 15,
              games: [{ home: alsoRan('t3', 1, 3), away: alsoRan('t4', 2, 4), winner: alsoRan('t3', 1, 3) }],
            }],
          },
        }),
      });
      const html = render();
      expect(html).toContain('takes the consolation bracket');
      expect(html).not.toContain('🏆');
      expect(html).not.toContain('wins the league');
    });

    it('escapes also-ran team names', () => {
      const lg = league(['t1', 't2', 't3', 't4']);
      lg.teams.t3.name = '<img src=x onerror=alert(1)>';
      setup({ league: lg, bracket: withConsolation() });
      const html = render();
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img');
    });
  });
});
