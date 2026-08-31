// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, reset, describe as describeErr, _state } from './league-home.js';
import { managerColor } from '../core/player-visuals.js';

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

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
    // The marker is a styled badge rather than a parenthetical, so assert the
    // intent — this row is mine — not the exact characters.
    expect(render()).toContain('class="you"');
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

describe('the season control', () => {
  // ⚠️ THE WEEK IS WHAT UNLOCKS EVERYTHING — scoring, waivers, matchups, the
  // roster. Until it is set every tab correctly reports it has nothing, and
  // there was no control anywhere to change that. The op existed from the
  // start; nothing called it.
  it('offers a commissioner a way to start a league that has not begun', () => {
    setup({ league: league({ currentWeek: null }) });
    const html = render();
    expect(html).toContain('league-start-season');
    expect(html).toContain('Start the season at week 1');
  });

  it('starts at the league’s own startWeek, not a hardcoded 1', () => {
    setup({ league: league({ currentWeek: null, settings: { name: 'L', startWeek: 5 } }) });
    expect(render()).toContain('data-week="5"');
  });

  it('switches to a week editor once the season is running', () => {
    setup({ league: league({ currentWeek: 3 }) });
    const html = render();
    expect(html).toContain('league-week-input');
    expect(html).toContain('league-set-week');
    expect(html).not.toContain('league-start-season');
  });

  // ⚠️ Only a commissioner may set the week; offering the control to anyone
  // else is an invitation to a refusal.
  it('shows no season control to an ordinary manager', () => {
    setup({ league: league({ currentWeek: null, isCommissioner: false }) });
    const html = render();
    expect(html).not.toContain('league-start-season');
    expect(html).not.toContain('league-set-week');
  });
});

describe('the empty-league callout', () => {
  // ⚠️ A one-team league looks BROKEN: every tab truthfully reports nothing to
  // show, and together that reads as a dead feature rather than as "nobody has
  // joined yet".
  it('says what a one-team league is waiting for', () => {
    setup({ league: league({ teams: { t1: { id: 't1', name: 'Alice FC' } } }) });
    expect(render()).toMatch(/one team so far/i);
  });

  it('says the same for a league with no teams at all', () => {
    setup({ league: league({ teams: {}, myTeams: [] }) });
    expect(render()).toMatch(/no teams so far/i);
  });

  it('says nothing once two teams exist', () => {
    setup();
    expect(render()).not.toMatch(/so far/i);
  });
});

describe('the weekly recap', () => {
  const sched = { weeks: [{ week: 3, matchups: [{ home: 't1', away: 't2' }, { home: 't3', away: 't1' }] }] };
  const rec = { teams: { t1: { total: 140.2 }, t2: { total: 138.9 }, t3: { total: 40.5 } } };

  // ⚠️ Absent, not empty. A "Week 3 recap" heading over blank rows reads as
  // broken, and the panel would vanish and reappear as weeks are scored.
  it('renders nothing without a schedule or scores', () => {
    setup({ schedule: null, weekScores: {} });
    expect(render()).not.toContain('recap');
  });

  it('renders nothing when the week has no results yet', () => {
    setup({ schedule: sched, weekScores: {} });
    expect(render()).not.toContain('recap');
  });

  it('tells the story of the last scored week', () => {
    setup({ schedule: sched, weekScores: { 3: rec } });
    const html = render();
    expect(html).toContain('Week 3 recap');
    expect(html).toContain('Top score');
    expect(html).toContain('Closest game');
    expect(html).toContain('Biggest win');
  });

  // ⚠️ The line everybody repeats — and it only exists when a LOSER outscored a
  // WINNER, which the fixture above deliberately does not do. Forcing it to
  // always appear would make it a lie most weeks.
  it('calls out the team that scored big and still lost', () => {
    const four = league({
      teams: {
        t1: { id: 't1', name: 'Alice FC' }, t2: { id: 't2', name: 'Bob United' },
        t3: { id: 't3', name: 'Cara City' }, t4: { id: 't4', name: 'Dee Town' },
      },
    });
    setup({
      league: four,
      schedule: { weeks: [{ week: 3, matchups: [{ home: 't1', away: 't2' }, { home: 't3', away: 't4' }] }] },
      // t2 loses on 140; t3 wins on 60. The loser outscored a winner.
      weekScores: { 3: { teams: { t1: { total: 150 }, t2: { total: 140 }, t3: { total: 60 }, t4: { total: 50 } } } },
    });
    const html = render();
    expect(html).toMatch(/Scored big, still lost/i);
    expect(html).toContain('Bob United');
  });

  it('omits that line on a week where every winner outscored every loser', () => {
    setup({ schedule: sched, weekScores: { 3: rec } });
    expect(render()).toContain('Week 3 recap');
    expect(render()).not.toMatch(/Scored big, still lost/i);
  });

  it('names teams rather than printing ids', () => {
    setup({ schedule: sched, weekScores: { 3: rec } });
    const html = render();
    expect(html).toContain('Alice FC');
    expect(html).not.toMatch(/>t1</);
  });
});

describe('power rankings', () => {
  const w = (map) => ({ teams: Object.fromEntries(Object.entries(map).map(([t, total]) => [t, { total }])) });
  const twoWeeks = { 1: w({ t1: 120, t2: 100, t3: 80 }), 2: w({ t1: 130, t2: 110, t3: 90 }) };
  const table = standings(2, [
    { teamId: 't1', seed: 1, wins: 2, losses: 0, ties: 0, pointsFor: 250, pointsAgainst: 170 },
    { teamId: 't2', seed: 2, wins: 1, losses: 1, ties: 0, pointsFor: 210, pointsAgainst: 210 },
    { teamId: 't3', seed: 3, wins: 0, losses: 2, ties: 0, pointsFor: 170, pointsAgainst: 250 },
  ]);

  // ⚠️ After one week all-play is just that week's scoreboard restated, and
  // calling it a power ranking would be theatre.
  it('does not appear after a single week', () => {
    setup({ standings: table, weekScores: { 1: twoWeeks[1] } });
    expect(render()).not.toContain('Power rankings');
  });

  it('appears once two weeks have been played', () => {
    setup({ standings: table, weekScores: twoWeeks });
    const html = render();
    expect(html).toContain('Power rankings');
    expect(html).toContain('All-play');
  });

  it('ranks the consistently highest scorer first', () => {
    setup({ standings: table, weekScores: twoWeeks });
    const body = render().split('Power rankings')[1];
    expect(body.indexOf('Alice FC')).toBeLessThan(body.indexOf('Cara City'));
  });

  // ⚠️ Efficiency comes from potentialPoints, which the native league cannot
  // compute — a stored week holds only the starters. Printing 0% would be a
  // confident lie.
  it('shows no efficiency column', () => {
    setup({ standings: table, weekScores: twoWeeks });
    expect(render()).not.toMatch(/Efficiency/i);
  });

  it('explains what luck means rather than printing a bare number', () => {
    setup({ standings: table, weekScores: twoWeeks });
    expect(render()).toMatch(/real wins minus/i);
  });
});


// ── §8b parity: team colour as accent ───────────────────────────────────────
//
// ⚠️ §8b says "via the existing teamColor()". IT CANNOT BE — teamColor() maps an
// NFL abbreviation to that franchise's colour, and these rows are FANTASY teams.
// server/ops-league.js stores a team as { id, name, ownerId, coOwners } with no
// colour at all. managerColor() derives a stable one from the team ID (not the
// name: managers rename mid-season and a row that changed colour would read as a
// bug), which is the same source the draft hero's duotone uses.
describe('team colour as accent', () => {
  it('accents a pre-season standings row with its own team colour', () => {
    setup({ standings: standings(0, []) });
    const el = parse(render());
    const row = el.querySelector('.tbl tr[data-team="t1"]');
    expect(row).not.toBeNull();
    expect(row.getAttribute('style')).toContain(managerColor('t1'));
  });

  it('accents a scored standings row too', () => {
    setup({
      standings: standings(2, [
        { teamId: 't1', seed: 1, wins: 2, losses: 0, ties: 0, pointsFor: 200, pointsAgainst: 150 },
        { teamId: 't2', seed: 2, wins: 0, losses: 2, ties: 0, pointsFor: 150, pointsAgainst: 200 },
      ]),
    });
    const el = parse(render());
    const row = el.querySelector('.tbl.standings tr[data-team="t2"]');
    expect(row.getAttribute('style')).toContain(managerColor('t2'));
  });

  it('gives two different teams two different accents', () => {
    setup({ standings: standings(0, []) });
    const el = parse(render());
    const a = el.querySelector('tr[data-team="t1"]').getAttribute('style');
    const b = el.querySelector('tr[data-team="t2"]').getAttribute('style');
    expect(a).not.toBe(b);
  });

  it('is stable across renders, so a row does not change colour on a refresh', () => {
    setup({ standings: standings(0, []) });
    const first = parse(render()).querySelector('tr[data-team="t1"]').getAttribute('style');
    const second = parse(render()).querySelector('tr[data-team="t1"]').getAttribute('style');
    expect(first).toBe(second);
  });
});

describe('the commissioner settings form', () => {
  /**
   * ⚠️ `league:settings` HAS WORKED SINCE THE ENGINE SHIPPED AND NOTHING COULD
   * REACH IT. The op takes the whole settings object, is commissioner-gated,
   * normalised and validated — and `updateSettings` had no caller, so a
   * commissioner could not change their league's NAME, let alone its rules.
   */
  it('offers the form to a commissioner', () => {
    setup({ league: league({ isCommissioner: true }) });
    const el = parse(render());
    const form = el.querySelector('form[data-act="league-settings-form"]');
    expect(form).not.toBeNull();
    expect(form.querySelector('input[name="name"]')).not.toBeNull();
    expect(form.querySelector('select[name="waiverType"]')).not.toBeNull();
  });

  it('shows it to nobody else', () => {
    setup({ league: league({ isCommissioner: false }) });
    const el = parse(render());
    expect(el.querySelector('form[data-act="league-settings-form"]')).toBeNull();
  });

  /**
   * ⚠️ STRUCTURAL SETTINGS ARE DELIBERATELY ABSENT. The op would accept them —
   * validateSettings only checks a config is internally coherent, not that it is
   * safe to apply to a season in progress — and shrinking a roster under a
   * drafted team is a migration, not a setting. It must not be one input away.
   */
  it('never offers team count or roster slots', () => {
    setup({ league: league({ isCommissioner: true }) });
    const el = parse(render());
    for (const field of ['numTeams', 'rosterPositions']) {
      expect(el.querySelector(`[name="${field}"]`)).toBeNull();
    }
  });

  it('carries the league’s current values, not the defaults', () => {
    setup({ league: league({
      isCommissioner: true,
      settings: { name: 'Sunday Money', format: 'redraft', playoffTeams: 4,
        waiverType: 'rolling', autoSubsPerWeek: 2 },
    }) });
    const el = parse(render());
    expect(el.querySelector('input[name="name"]').value).toBe('Sunday Money');
    expect(el.querySelector('input[name="playoffTeams"]').getAttribute('value')).toBe('4');
    expect(el.querySelector('select[name="waiverType"] option[selected]').value).toBe('rolling');
    expect(el.querySelector('select[name="autoSubsPerWeek"] option[selected]').value).toBe('2');
  });

  // ⚠️ Sending a preset because the select defaulted to one would silently
  // rewrite a custom scoring map this form cannot even display.
  it('offers leaving the scoring map alone, and defaults to that', () => {
    setup({ league: league({ isCommissioner: true }) });
    const el = parse(render());
    const first = el.querySelector('select[name="scoring"] option');
    expect(first.value).toBe('keep');
    expect(first.textContent).toMatch(/leave/i);
  });
});

// ⚠️ THE REPORT THIS EXISTS FOR: "we finished our draft but nothing shows up in
// Matchups". The schedule genuinely had not been generated — and every surface
// was correctly empty without any of them saying why, which together reads as a
// broken feature rather than a league waiting on one click.
describe('a season with no schedule', () => {
  it('names the missing thing on the landing surface', () => {
    setup({ schedule: null });
    const html = render();
    expect(html).toMatch(/no schedule yet/i);
    expect(html).toContain('data-tab="matchup"');
  });

  it('says nothing once a schedule exists', () => {
    setup({ schedule: { weeks: [{ week: 1, matchups: [] }] } });
    expect(render()).not.toMatch(/no schedule yet/i);
  });

  // ⚠️ The SDK's null envelope reaches here too — league-home loads the
  // schedule for its recap. A truthy `{ok:true,data:null}` must not read as a
  // schedule that exists, or the callout vanishes for exactly the league that
  // needs it.
  it('is not fooled by the SDK null envelope', () => {
    setup({ schedule: { ok: true, data: null } });
    expect(render()).toMatch(/no schedule yet/i);
  });

  // These two states have their own callouts; stacking a third would bury them.
  it('defers to the roster callout before there are two teams', () => {
    setup({ schedule: null, league: league({ teams: { t1: { id: 't1', name: 'Solo' } } }) });
    expect(render()).not.toMatch(/no schedule yet/i);
  });

  it('defers to the season strip before a week is set', () => {
    setup({ schedule: null, league: league({ currentWeek: null }) });
    expect(render()).not.toMatch(/no schedule yet/i);
  });

  it('tells a manager who can fix it, without offering them the control', () => {
    setup({ schedule: null, league: league({ isCommissioner: false }) });
    const html = render();
    expect(html).toMatch(/commissioner generates it/i);
    expect(html).not.toContain('data-tab="matchup"');
  });
});
