// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render, reset, remainingMs, _state, startGlow, stopGlow, flashSweep, bindParallax,
} from './league-draft.js';
import * as draftQueue from './league-draft.js';
import { setIndex } from '../core/player-index.js';
import { motion } from '../core/motion.js';

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

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
    // ⚠️ The board used to sit under an <h4>Board</h4>. It is now inside the stage,
    // where the hero above it already says what it is — a heading there would be
    // labelling the only thing on the surface.
    expect(html).toContain('gr-stage');
    expect(html).toContain('gr-board');
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

// ── The player pool ──────────────────────────────────────────────────────────
//
// ⚠️ THE REGRESSION THIS FILE EXISTS FOR. The live board used to show players
// only once you had typed two letters, so you could only draft somebody you had
// already thought of — a search box where a draft board should be.
describe('the pool of available players', () => {
  const order = [
    { overall: 1, round: 1, pickInRound: 1, slot: 't1', owner: 't1' },
    { overall: 2, round: 1, pickInRound: 2, slot: 't2', owner: 't2' },
  ];
  const RANKING = ['qb1', 'rb1', 'wr1', 'rb2', 'te1'];

  const setupPool = (over = {}, stateOver = {}) => {
    setIndex({
      qb1: { n: 'Quinn Back', p: 'QB', t: 'KC' },
      rb1: { n: 'Ray Bee', p: 'RB', t: 'DET' },
      rb2: { n: 'Rob Bee', p: 'RB', t: 'SF' },
      wr1: { n: 'Will Rec', p: 'WR', t: 'MIN' },
      te1: { n: 'Tay End', p: 'TE', t: 'BAL' },
    });
    Object.assign(_state, {
      leagueId: 'lg', teamId: 't1', error: null, busy: false, notice: null,
      noDraft: false, query: '', filter: 'ALL', ranking: RANKING,
      localDeadline: Date.now() + 60000, frozenRemaining: null,
      league: {
        id: 'lg', isCommissioner: true, myTeams: ['t1'],
        settings: { rosterPositions: ['QB', 'RB', 'BN'] },
        teams: { t1: { id: 't1', name: 'Alice FC' }, t2: { id: 't2', name: 'Bob United' } },
      },
      draft: {
        status: 'active', type: 'snake', rounds: 1, pickTimerSeconds: 90,
        pickEndsAt: Date.now() + 60000, msRemaining: 60000,
        onClock: { overall: 1, round: 1, teamId: 't1' },
        picks: {}, order, isCommissioner: true, ...over,
      },
      ...stateOver,
    });
  };

  it('lists players with nothing typed', () => {
    setupPool();
    const html = render();
    expect(html).toContain('Quinn Back');
    expect(html).toContain('Ray Bee');
  });

  it('lists them best-first, in ranking order', () => {
    setupPool();
    const html = render();
    expect(html.indexOf('Quinn Back')).toBeLessThan(html.indexOf('Ray Bee'));
    expect(html.indexOf('Ray Bee')).toBeLessThan(html.indexOf('Will Rec'));
  });

  it('offers a tab per position, with a count on each', () => {
    setupPool();
    const html = render();
    expect(html).toContain('data-filter="QB"');
    expect(html).toContain('data-filter="RB"');
    expect(html).toContain('data-filter="DEF"');
  });

  // The headline ask: on the clock for a quarterback, the quarterbacks are one
  // click away and already ranked.
  it('narrows to one position, still ranked', () => {
    setupPool({}, { filter: 'RB' });
    const html = render();
    expect(html).toContain('Ray Bee');
    expect(html).toContain('Rob Bee');
    expect(html).not.toContain('Quinn Back');
    expect(html.indexOf('Ray Bee')).toBeLessThan(html.indexOf('Rob Bee'));
  });

  // ⚠️ Asserted on the BUTTON, not on the name. A drafted player still appears
  // on the board — that is the board's job — so searching the whole document for
  // his name would fail for the wrong reason.
  it('drops a player the moment he is drafted', () => {
    setupPool({ picks: { 1: { playerId: 'qb1', teamId: 't1', at: 1, auto: false } } });
    const html = render();
    expect(html).not.toContain('data-act="draft-take" data-player="qb1"');
    expect(html).toContain('data-act="draft-take" data-player="rb1"');
  });

  it('offers a Draft button when the pick is yours', () => {
    setupPool();
    expect(render()).toContain('data-act="draft-take"');
  });

  // ⚠️ THE LIST STAYS, ONLY THE BUTTONS GO. A board you cannot look at until you
  // are on the clock gives you ninety seconds to do all of your thinking.
  it('still shows the pool when it is somebody else\'s pick, without buttons', () => {
    setupPool({ onClock: { overall: 2, round: 1, teamId: 't2' } });
    const html = render();
    expect(html).toContain('Quinn Back');
    expect(html).not.toContain('data-act="draft-take"');
    expect(html).toContain('Waiting on the manager');
  });

  it('takes the buttons away while the draft is paused', () => {
    setupPool({ status: 'paused' });
    const html = render();
    expect(html).toContain('Quinn Back');
    expect(html).not.toContain('data-act="draft-take"');
  });

  it('narrows by name as well as by position', () => {
    setupPool({}, { query: 'bee' });
    const html = render();
    expect(html).toContain('Ray Bee');
    expect(html).not.toContain('Quinn Back');
  });

  // ⚠️ A ranking that failed to load must not read as "everybody is drafted",
  // and must not leave a live draft with no way to make a pick at all.
  it('falls back to search, and says so, when the ranking did not load', () => {
    setupPool({}, { ranking: [] });
    const html = render();
    expect(html).toMatch(/ranked player pool could not be loaded/i);
    expect(html).toMatch(/falling\s+back to search/i);
  });

  it('still lets a manager draft by name in that fallback', () => {
    setupPool({}, { ranking: [], query: 'quinn' });
    const html = render();
    expect(html).toContain('Quinn Back');
    expect(html).toContain('data-act="draft-take" data-player="qb1"');
  });

  it('keeps a drafted player out of the fallback results too', () => {
    setupPool(
      { picks: { 1: { playerId: 'qb1', teamId: 't1', at: 1, auto: false } } },
      { ranking: [], query: 'quinn' },
    );
    expect(render()).not.toContain('data-act="draft-take" data-player="qb1"');
  });
});

// ── The clock ────────────────────────────────────────────────────────────────
describe('the pick clock', () => {
  beforeEach(reset);

  it('counts down from the deadline the server gave', () => {
    Object.assign(_state, { localDeadline: Date.now() + 45_000, frozenRemaining: null });
    const left = remainingMs();
    expect(left).toBeGreaterThan(43_000);
    expect(left).toBeLessThanOrEqual(45_000);
  });

  // ⚠️ A negative remainder rendered as a NEGATIVE clock. The pick is expired,
  // which is 0:00, not "-0:03".
  it('floors at zero rather than going negative', () => {
    Object.assign(_state, { localDeadline: Date.now() - 5_000, frozenRemaining: null });
    expect(remainingMs()).toBe(0);
  });

  // ⚠️ A PAUSED CLOCK DOES NOT COUNT DOWN. Counting down against a deadline that
  // is not running is how a paused draft appears to expire while paused.
  it('holds still while paused', () => {
    Object.assign(_state, { localDeadline: null, frozenRemaining: 30_000 });
    expect(remainingMs()).toBe(30_000);
    expect(remainingMs()).toBe(30_000);
  });

  it('reports nothing for a draft with no clock at all', () => {
    Object.assign(_state, { localDeadline: null, frozenRemaining: null });
    expect(remainingMs()).toBe(null);
  });
});

describe('draft queue mutations', () => {
  beforeEach(() => {
    Object.assign(_state, { leagueId: 'L1', teamId: 't1', queue: [], notice: null });
  });

  it('adds a player once, never twice', () => {
    draftQueue.queueAdd(null, 'p1');
    draftQueue.queueAdd(null, 'p1');
    expect(_state.queue).toEqual(['p1']);
  });

  it('ignores an empty id', () => {
    draftQueue.queueAdd(null, '');
    expect(_state.queue).toEqual([]);
  });

  it('removes a player', () => {
    Object.assign(_state, { queue: ['p1', 'p2'] });
    draftQueue.queueRemove(null, 'p1');
    expect(_state.queue).toEqual(['p2']);
  });

  it('moves a player up', () => {
    Object.assign(_state, { queue: ['p1', 'p2'] });
    draftQueue.queueUp(null, 'p2');
    expect(_state.queue).toEqual(['p2', 'p1']);
  });

  it('leaves the top player where it is', () => {
    Object.assign(_state, { queue: ['p1', 'p2'] });
    draftQueue.queueUp(null, 'p1');
    expect(_state.queue).toEqual(['p1', 'p2']);
  });

  it('does not persist without a team', () => {
    Object.assign(_state, { teamId: null, queue: [] });
    expect(() => draftQueue.queueAdd(null, 'p1')).not.toThrow();
    expect(_state.queue).toEqual(['p1']);
  });
});

describe('the live draft renders on the stage', () => {
  const liveDraft = {
    status: 'active',
    rounds: 2,
    order: [
      { overall: 1, round: 1, pickInRound: 1, owner: 't1' },
      { overall: 2, round: 1, pickInRound: 2, owner: 't2' },
      { overall: 3, round: 2, pickInRound: 1, owner: 't2' },
      { overall: 4, round: 2, pickInRound: 2, owner: 't1' },
    ],
    picks: { 1: { playerId: 'p1', teamId: 't1', at: 1, auto: false } },
    onClock: { overall: 2, round: 1, teamId: 't2' },
    isCommissioner: false,
    msRemaining: 64000,
  };

  beforeEach(() => {
    setIndex({ p1: { n: 'B. Robinson', p: 'RB', t: 'ATL' } });
    setup({
      draft: liveDraft,
      league: league(2, { settings: { rosterPositions: ['QB', 'RB', 'BN'] } }),
      localDeadline: Date.now() + 64000,
      frozenRemaining: null,
      ranking: [],
      queue: [],
      filter: 'ALL',
    });
  });

  it('puts the board inside a stage', () => {
    const el = parse(render());
    expect(el.querySelector('.gr-stage')).not.toBeNull();
    expect(el.querySelector('.gr-stage .db')).not.toBeNull();
  });

  it('shows the hero with the team on the clock', () => {
    const el = parse(render());
    // `league(2)` names its teams "Team 1" / "Team 2"; t2 is on the clock at #2.
    expect(el.querySelector('.gr-team').textContent).toBe('Team 2');
    expect(el.querySelector('.gr-overall').textContent).toBe('#2 OVERALL');
  });

  it('renders the ticker strip even with nothing to say', () => {
    const el = parse(render());
    const tick = el.querySelector('.gr-tick');
    expect(tick).not.toBeNull();
    expect(tick.classList.contains('is-quiet')).toBe(true);
  });

  it('renders the live rail with the pick that has landed', () => {
    const el = parse(render());
    expect(el.querySelector('.gr-feed').textContent).toContain('B. Robinson');
  });

  // ⚠️ paintClock() writes ONE TEXT NODE via [data-draft-clock]. The hero now owns
  // that hook; if it went missing the clock would silently stop moving between
  // polls while the board looked perfect.
  it('keeps exactly one [data-draft-clock] hook, in the hero', () => {
    const el = parse(render());
    const hooks = el.querySelectorAll('[data-draft-clock]');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].classList.contains('gr-clock')).toBe(true);
  });
});
