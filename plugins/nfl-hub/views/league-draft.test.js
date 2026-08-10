import { describe, it, expect, beforeEach } from 'vitest';
import { render, reset, _state } from './league-draft.js';

const league = (teamCount = 4, over = {}) => ({
  id: 'lg',
  isCommissioner: true,
  teams: Object.fromEntries(
    Array.from({ length: teamCount }, (_, i) => [`t${i + 1}`, { id: `t${i + 1}`, name: `Team ${i + 1}` }]),
  ),
  myTeams: ['t1'],
  ...over,
});

beforeEach(reset);

const setup = (over = {}) => {
  Object.assign(_state, {
    leagueId: 'lg', league: league(), teamId: 't1', draft: null,
    error: null, busy: false, notice: null, noDraft: false, query: '', results: [], ...over,
  });
};

describe('a league with no draft yet', () => {
  // ⚠️ THE REGRESSION. The module refuses `draft:get` for a league that never
  // created one, and rendering that refusal as an error left a commissioner
  // looking at "Try again" — a button that could never work, on the one screen
  // where they were the only person able to act.
  it('is a state with a way forward, not an error with a retry', () => {
    setup({ noDraft: true });
    const html = render();
    expect(html).toContain('draft-create');
    expect(html).not.toContain('draft-retry');
  });

  it('explains what is missing', () => {
    setup({ noDraft: true });
    expect(render()).toMatch(/No draft has been set up/i);
  });

  // ⚠️ A draft needs opponents. Offering a live button that the module will
  // refuse teaches nothing; saying the count does.
  it('refuses to offer a draft to a one-team league, and says why', () => {
    setup({ noDraft: true, league: league(1) });
    const html = render();
    expect(html).toMatch(/at least two teams/i);
    expect(html).toMatch(/this league has 1/i);
    expect(html).toMatch(/data-act="draft-create"[^>]*disabled/);
  });

  it('enables the button once a second team exists', () => {
    setup({ noDraft: true, league: league(2) });
    expect(render()).not.toMatch(/data-act="draft-create"[^>]*disabled/);
  });

  it('tells a non-commissioner who to ask, without a button they cannot use', () => {
    setup({ noDraft: true, league: league(4, { isCommissioner: false }) });
    const html = render();
    expect(html).toMatch(/commissioner needs to create it/i);
    expect(html).not.toContain('draft-create');
  });

  // A real failure still has to look like one.
  it('keeps the retry pane for an actual error', () => {
    setup({ error: 'the league engine is not running' });
    const html = render();
    expect(html).toContain('draft-retry');
    expect(html).toContain('not running');
  });
});

describe('the live board', () => {
  // ⚠️ Built to match `draftView` in server/ops-draft.js EXACTLY. Note what it
  // does NOT carry: `onClock` has no `owner` and no `pickInRound`. A stub that
  // invented them would hide the very mismatch this guards.
  const order = [
    { overall: 1, round: 1, pickInRound: 1, slot: 't1', owner: 't1' },
    { overall: 2, round: 1, pickInRound: 2, slot: 't2', owner: 't2' },
    { overall: 3, round: 2, pickInRound: 1, slot: 't2', owner: 't2' },
    { overall: 4, round: 2, pickInRound: 2, slot: 't1', owner: 't1' },
  ];
  const live = (over = {}) => ({
    status: 'active', type: 'snake', rounds: 2, pickTimerSeconds: 90,
    pickEndsAt: Date.now() + 60000, msRemaining: 60000,
    onClock: { overall: 2, round: 1, teamId: 't2' },
    picks: { 1: { playerId: 'p1', teamId: 't1', at: 1, auto: false } },
    order,
    isCommissioner: true,
    ...over,
  });

  const setupLive = (over = {}) => {
    Object.assign(_state, {
      leagueId: 'lg', teamId: 't1', error: null, busy: false, notice: null,
      noDraft: false, query: '', results: [], localDeadline: null,
      league: {
        id: 'lg', isCommissioner: true, myTeams: ['t1'],
        settings: { rosterPositions: ['QB', 'RB', 'WR', 'BN'] },
        teams: { t1: { id: 't1', name: 'Alice FC' }, t2: { id: 't2', name: 'Bob United' } },
      },
      draft: live(over),
    });
  };

  it('draws the board with the picks already made', () => {
    setupLive();
    const html = render();
    expect(html).toContain('db-made');
    expect(html).toContain('Board');
  });

  // ⚠️ THE SHAPE MISMATCH THIS EXISTS FOR. The module sends `teamId`, the board
  // wants `owner`. Passed straight through, the board reports nobody on the
  // clock while the rest of the screen says somebody is.
  it('resolves who is on the clock despite the payload naming it teamId', () => {
    setupLive();
    const html = render();
    expect(html).toContain('db-live');
    expect(html).toContain('Bob United');
  });

  it('says plainly when the pick is yours', () => {
    setupLive({ onClock: { overall: 1, round: 1, teamId: 't1' }, picks: {} });
    expect(render()).toMatch(/You are on the clock/i);
  });

  // ⚠️ Columns come from the ORDER, not the league's team map — that is stored
  // in join order and would seat managers in the wrong columns.
  it('orders the columns by round one, left to right', () => {
    setupLive();
    // Scope to the board's own header row; the on-the-clock banner names a team
    // earlier in the document and would answer a different question.
    const head = render().split('db-head')[1] ?? '';
    const a = head.indexOf('Alice FC');
    const b = head.indexOf('Bob United');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });

  it('shows your roster slots filling as you draft', () => {
    setupLive();
    expect(render()).toContain('db-roster');
  });

  it('draws the finished board rather than a bare table when complete', () => {
    setupLive({ status: 'complete', onClock: null });
    const html = render();
    expect(html).toMatch(/Draft complete/i);
    expect(html).toContain('db-made');
  });
});
