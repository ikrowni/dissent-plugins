// @vitest-environment jsdom
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

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

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

  // 🔴 A MATCHUP HAS TWO SIDES AND THE POINT IS COMPARING THEM. `state.expanded`
  // held a single teamId and matchupCard rendered `expanded === m.home ? … : ''`
  // beside `expanded === m.away ? … : ''`, so only one of the two could ever be
  // true: expanding showed the side you clicked and nothing to compare it with.
  // Reported 2026-08-31 as "it's not showing each person's team setup".
  it('shows BOTH lineups when a matchup is expanded', () => {
    setIndex({ p1: { n: 'Pat One', p: 'QB', t: 'KC' }, p2: { n: 'Rival Two', p: 'QB', t: 'BUF' } });
    setup({
      scores: { teams: {
        t1: { total: 10, rows: [{ slot: 'QB', playerId: 'p1', points: 10 }] },
        t2: { total: 5, rows: [{ slot: 'QB', playerId: 'p2', points: 5 }] },
      } },
    });
    expand(null, 't1');
    const html = render();
    expect(html).toContain('Pat One');
    expect(html).toContain('Rival Two');
  });

  // Either side opens the SAME matchup — the pane is a property of the pairing,
  // not of the team whose name happened to be clicked.
  it('opens the same pair from the away side', () => {
    setIndex({ p1: { n: 'Pat One', p: 'QB', t: 'KC' }, p2: { n: 'Rival Two', p: 'QB', t: 'BUF' } });
    setup({
      scores: { teams: {
        t1: { total: 10, rows: [{ slot: 'QB', playerId: 'p1', points: 10 }] },
        t2: { total: 5, rows: [{ slot: 'QB', playerId: 'p2', points: 5 }] },
      } },
    });
    expand(null, 't2');
    const html = render();
    expect(html).toContain('Pat One');
    expect(html).toContain('Rival Two');
  });

  // Clicking the partner of an open matchup CLOSES it. Keying on the clicked
  // team would silently re-open the same pane and read as a dead click.
  it('closes from the other side of an open matchup', () => {
    setup({
      scores: { teams: {
        t1: { total: 10, rows: [{ slot: 'QB', playerId: 'p1', points: 10 }] },
        t2: { total: 5, rows: [] },
      } },
    });
    expand(null, 't1');
    expand(null, 't2');
    expect(render()).not.toContain('Pat One');
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


// ── §8b parity: the expanded lineup ─────────────────────────────────────────
//
// ⚠️ THIS TAB WAS THE ONE THAT DIVERGED. My Roster and Moves already render
// players through playerChip (monogram, position pill, team mark); this table
// rendered `playerLabel()` as a bare string — "Pat One (QB · KC)" — so the same
// player looked like a different object depending on which tab you opened.
describe('the expanded lineup matches every other tab', () => {
  const setup = (over = {}) => {
    Object.assign(_state, {
      leagueId: 'lg', league: league(['t1', 't2']), week: 3, loaded: true,
      error: null, expanded: null, scores: null, busy: false,
      schedule: scheduleRecord([{ week: 3, matchups: [{ home: 't1', away: 't2', bye: false }] }]),
      ...over,
    });
  };

  const withLineup = () => {
    setup({
      scores: {
        teams: {
          t1: {
            total: 10,
            rows: [
              { slot: 'QB', playerId: 'p1', points: 10 },
              { slot: 'FLEX', playerId: 'p1', points: 4 },
              { slot: 'BN', playerId: null, points: 0 },
            ],
          },
          t2: { total: 5, rows: [] },
        },
      },
    });
    expand(null, 't1');
    return parse(render());
  };

  it('renders the player through the shared chip, not as a bare label', () => {
    const el = withLineup();
    expect(el.querySelector('.pv-chip')).not.toBeNull();
    expect(el.querySelector('.pv-name').textContent).toBe('Pat One');
    // The old bare-string form, which no other tab uses.
    expect(el.textContent).not.toContain('Pat One (QB');
  });

  it('gives every player a monogram, because only ~23% have a headshot', () => {
    const el = withLineup();
    expect(el.querySelector('.pv-mono')).not.toBeNull();
  });

  // ⚠️ THE DIVERGENCE §8b NAMES. views/league-roster.js has always coloured its
  // slot chip by position; this table left it flat --text-3, so QB and RB looked
  // identical on the one screen where you compare two lineups side by side.
  it('colours the slot chip by position, the same way My Roster does', () => {
    const el = withLineup();
    const qb = el.querySelector('td.slot');
    expect(qb.getAttribute('style')).toContain('#f2557d'); // POSITION_COLORS.QB
  });

  it('colours a flex slot by the flex hue rather than looking for a FLEX player', () => {
    // ⚠️ Same rule as roster.js: a slot accepting >1 position is "flexish" and
    // takes RB's hue. Matching the literal position would leave it uncoloured.
    const el = withLineup();
    const slots = [...el.querySelectorAll('td.slot')];
    const flex = slots.find((s) => s.textContent.trim() === 'FLEX');
    expect(flex.getAttribute('style')).toContain('#3fc4a0'); // POSITION_COLORS.RB
  });

  it('still says empty for a slot with nobody in it', () => {
    const el = withLineup();
    expect(el.textContent).toContain('empty');
  });

  it('still shows the points', () => {
    expect(withLineup().textContent).toContain('10.00');
  });
});

// ── §8b item 2: the accent must reach every surface that renders a team's row ──
//
// ⚠️ THE BRACKET SHARES `.side` WITH THE MATCHUP CARD. Accenting only the
// regular-season card left a colour stripe on one and none on the playoff game
// rendered directly below it — a visible inconsistency created by doing half of
// a shared component.
describe('team accent on the bracket and byes', () => {
  const setup = (over = {}) => {
    Object.assign(_state, {
      leagueId: 'lg', league: league(['t1', 't2']), week: 15, loaded: true,
      error: null, expanded: null, scores: null, busy: false,
      schedule: scheduleRecord([{ week: 15, matchups: [{ home: 't1', away: 't2', bye: false }] }]),
      ...over,
    });
  };

  it('accents both seats of a bracket game with their own team colours', () => {
    setup({
      bracket: {
        rounds: [{ round: 1, week: 15, games: [{ home: { teamId: 't1', seed: 1 }, away: { teamId: 't2', seed: 2 } }] }],
        byes: [], champion: null,
      },
    });
    const el = parse(render());
    const seats = [...el.querySelectorAll('.bracket-game .side')];
    expect(seats).toHaveLength(2);
    for (const s of seats) expect(s.classList.contains('team-accent')).toBe(true);
    expect(seats[0].getAttribute('style')).not.toBe(seats[1].getAttribute('style'));
  });

  it('accents a bye row, which is still that team own row', () => {
    setup({
      week: 3,
      schedule: scheduleRecord([{ week: 3, matchups: [{ home: 't1', away: null, bye: true }] }]),
    });
    const el = parse(render());
    const bye = el.querySelector('.matchup.bye .side');
    expect(bye.classList.contains('team-accent')).toBe(true);
    expect(bye.getAttribute('style')).toContain('--mgr:');
  });
});

// 🔴 THE BUG THIS FILE'S NEWEST TESTS EXIST FOR — reported 2026-08-31 as
// "we finished our draft but nothing shows up in Matchups".
//
// The SDK's `invokeModule` unwraps with `inner?.data ?? inner`, and `??` reads a
// null `data` as ABSENT and falls back to the envelope. So `getPlayoffs`
// answering "this league has no bracket" arrived as a truthy
// `{ok:true, data:null}`, the view's `if (state.bracket || …)` fired in WEEK 1,
// and the postseason pane rendered — empty, because there were no rounds to
// draw. The regular season sat behind it, unreachable, and with it the
// "Generate schedule" button a freshly drafted league needs.
//
// These test the VIEW's contract: a bracket-shaped value that carries no
// postseason must not displace the regular season.
describe('a league with no postseason yet', () => {
  const setup = (over = {}) => Object.assign(_state, {
    leagueId: 'lg', league: league(['t1', 't2']), week: 1,
    scores: null, schedule: null, bracket: null, loaded: true, error: null, ...over,
  });

  it('offers the schedule button in week 1, not an empty Playoffs pane', () => {
    setup();
    const html = render();
    expect(html).toContain('matchup-generate');
    expect(html).not.toContain('Playoffs');
  });

  // The regression itself: the value the SDK actually delivered.
  it('is not fooled by the SDK\'s null envelope', () => {
    setup({ bracket: { ok: true, data: null } });
    const html = render();
    expect(html).toContain('matchup-generate');
    expect(html).not.toContain('Playoffs');
  });

  it('does not treat a null-enveloped schedule as a real one', () => {
    setup({ schedule: { ok: true, data: null } });
    const html = render();
    expect(html).toContain('matchup-generate');
  });

  // The pane is still correct when it IS the postseason — the fix must not
  // trade one wrong branch for another.
  it('still shows the postseason once the playoff weeks arrive', () => {
    setup({ week: 15 });
    const html = render();
    expect(html).toContain('Playoffs');
    expect(html).toContain('matchup-start-playoffs');
  });

  it('still shows a real bracket whenever one exists', () => {
    setup({ week: 15, bracket: { rounds: [{ round: 1, week: 15, games: [] }], byes: [] } });
    expect(render()).toContain('Playoffs');
  });

  // A manager is not the one who can fix it, so they get the reason, not a
  // button that will be refused.
  it('tells a manager who needs to act', () => {
    setup({ league: league(['t1', 't2'], { isCommissioner: false }) });
    const html = render();
    expect(html).toContain('commissioner needs to generate it');
    expect(html).not.toContain('matchup-generate');
  });
});

// The Matchups tab was four rows tall in a page-tall pane. The fixture strip is
// what fills it — chosen because it answers something no other part of the tab
// does: who you play next, and when.
describe('your season fixture strip', () => {
  const sched = (weeks) => ({ season: 2025, startWeek: 1, teamIds: ['t1', 't2'], weeks });
  const base = (over = {}) => Object.assign(_state, {
    leagueId: 'lg', league: league(['t1', 't2']), week: 2,
    scores: null, bracket: null, loaded: true, error: null,
    schedule: sched([
      { week: 1, matchups: [{ home: 't1', away: 't2', bye: false }] },
      { week: 2, matchups: [{ home: 't2', away: 't1', bye: false }] },
      { week: 3, matchups: [{ home: 't1', away: 't2', bye: false }] },
    ]),
    ...over,
  });

  it('lists every week the reader has a fixture in', () => {
    base();
    const html = render();
    expect(html).toContain('Your season');
    expect(html).toContain('WK 1');
    expect(html).toContain('WK 3');
  });

  // Home and away are different games and the strip has to say which.
  it('distinguishes home from away', () => {
    base();
    const d = parse(render());
    const ats = [...d.querySelectorAll('.fx-at')].map((n) => n.textContent.trim());
    expect(ats).toEqual(['vs', '@', 'vs']);
  });

  it('marks the current week and dims the played ones', () => {
    base();
    const d = parse(render());
    expect(d.querySelectorAll('.fx.now').length).toBe(1);
    expect(d.querySelectorAll('.fx.past').length).toBe(1);
  });

  // ⚠️ The bye is in a LATER week, and the current week has a real pairing.
  // Putting the bye in the current week makes the view take its "week N is not
  // in the schedule" branch instead, and the test then passes or fails for a
  // reason that has nothing to do with byes.
  it('says Bye rather than inventing an opponent', () => {
    base({
      week: 1,
      schedule: sched([
        { week: 1, matchups: [{ home: 't1', away: 't2', bye: false }] },
        { week: 2, matchups: [{ home: 't1', away: null, bye: true }] },
      ]),
    });
    const html = render();
    expect(html).toContain('Your season');
    expect(html).toContain('Bye');
  });

  // ⚠️ It is additive. A league with no schedule must still get the pane that
  // offers to generate one, not a half-rendered strip.
  it('renders nothing without a schedule', () => {
    base({ schedule: null });
    const html = render();
    expect(html).not.toContain('Your season');
    expect(html).toContain('matchup-generate');
  });

  it('renders nothing for someone with no team in the league', () => {
    base({ league: league(['t1', 't2'], { myTeams: [] }) });
    expect(render()).not.toContain('Your season');
  });
})

// The tab rendered the league's current week and offered no way to reach any
// other, so a finished week became unreachable the moment the commissioner
// advanced the season. The schedule holds every week; nothing surfaced them.
describe('browsing the season', () => {
  const sched = () => ({
    season: 2025, startWeek: 1, teamIds: ['t1', 't2'],
    weeks: [1, 2, 3].map((w) => ({ week: w, matchups: [{ home: 't1', away: 't2', bye: false }] })),
  });
  const at = (viewWeek) => Object.assign(_state, {
    leagueId: 'lg', league: league(['t1', 't2']), week: 2, viewWeek,
    scores: null, bracket: null, loaded: true, error: null, schedule: sched(),
  });

  it('offers a step in each direction', () => {
    at(2);
    const d = parse(render());
    const btns = [...d.querySelectorAll('[data-act="matchup-week"]')]
      .filter((b) => b.closest('.wk-nav'));
    expect(btns.map((b) => b.dataset.week)).toContain('1');
    expect(btns.map((b) => b.dataset.week)).toContain('3');
  });

  // ⚠️ Bounded by the SCHEDULE, not by 1..18 — stepping past either end offers a
  // week with no pairings, which renders as an error and reads as a dead button.
  it('disables the step that would leave the schedule', () => {
    // ⚠️ Selected by TITLE, not by position. When you are off the live week a
    // third "Today" button appears at the end, so nav[last] is not the forward
    // step — an index-based selector tests whichever button happens to be last.
    at(1);
    const back = parse(render()).querySelector('[title="Previous week"]');
    expect(back.disabled).toBe(true);
    expect(parse(render()).querySelector('[title="Next week"]').disabled).toBe(false);

    at(3);
    expect(parse(render()).querySelector('[title="Next week"]').disabled).toBe(true);
    expect(parse(render()).querySelector('[title="Previous week"]').disabled).toBe(false);
  });

  it('renders the viewed week, not the league week', () => {
    at(3);
    expect(render()).toContain('Week 3');
  });

  it('says when you are not looking at the live week, and offers the way back', () => {
    at(3);
    const html = render();
    expect(html).toMatch(/not live/i);
    expect(html).toContain('>Today<');
    at(2);
    expect(render()).not.toMatch(/not live/i);
  });

  it('defaults to the league week when nothing is chosen', () => {
    at(null);
    expect(render()).toContain('Week 2');
  });

  // The fixture chips double as the week picker.
  it('makes each fixture chip jump to its week', () => {
    at(2);
    const chips = [...parse(render()).querySelectorAll('.fx')];
    expect(chips.length).toBe(3);
    for (const c of chips) expect(c.dataset.act).toBe('matchup-week');
  });
})

describe('projected points and bye weeks in a lineup', () => {
  const withLineup = () => Object.assign(_state, {
    leagueId: 'lg', league: league(['t1', 't2']), week: 1, viewWeek: 1,
    bracket: null, loaded: true, error: null,
    schedule: { season: 2025, startWeek: 1, teamIds: ['t1', 't2'],
      weeks: [{ week: 1, matchups: [{ home: 't1', away: 't2', bye: false }] }] },
    scores: { teams: { t1: { total: 0, rows: [{ slot: 'QB', playerId: 'p1', points: 0 }] },
      t2: { total: 0, rows: [{ slot: 'QB', playerId: 'p1', points: 0 }] } } },
    expanded: 't1',
  });

  it('names both columns so the numbers are not a mystery', () => {
    withLineup();
    const html = render();
    expect(html).toContain('>Proj<');
    expect(html).toContain('>Bye<');
    expect(html).toMatch(/whole season/i);
  });

  // ⚠️ 0 is a real projection for somebody not expected to play, so an unknown
  // one must not render as 0. No ranking is loaded under test.
  it('renders an unknown projection as a dash, never as zero', () => {
    withLineup();
    const d = parse(render());
    const cells = [...d.querySelectorAll('.lineup-detail .proj')].map((n) => n.textContent.trim());
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c).toBe('—');
  });
})
