// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  render,
  reset,
  setField,
  take,
  simulate,
  setFilter,
  restart,
  _state,
  DEFAULT_SLOTS,
  armClock,
  stopClock,
  remainingMs,
} from './league-mock.js';
import { setIndex } from '../core/player-index.js';
import { createMock, runBotsUntilMyTurn, onTheClock, availableIn, pick } from '../core/mock-draft.js';

const MIX = ['RB', 'WR', 'WR', 'QB', 'RB', 'TE', 'WR', 'RB', 'QB', 'WR', 'TE', 'K', 'DEF'];
const INDEX = Object.fromEntries(
  Array.from({ length: 200 }, (_, i) => [`p${i + 1}`, { n: `Player ${i + 1}`, p: MIX[i % MIX.length], t: 'KC' }]),
);
const RANKING = Object.keys(INDEX);

beforeEach(() => { reset(); setIndex(INDEX); });

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

const startedMock = (over = {}) => runBotsUntilMyTurn(createMock({
  teams: 12, rounds: 15, slot: 1,
  rosterPositions: [...DEFAULT_SLOTS, 'BN', 'BN', 'BN'],
  ranking: RANKING, positionOf: (id) => INDEX[id]?.p ?? null, seed: 5, ...over,
}));

describe('setup', () => {
  it('offers the setup screen before a mock exists', () => {
    const html = render();
    expect(html).toContain('mock-start');
    expect(html).toContain('Your seat');
  });

  // ⚠️ THIS TEST EXISTS SO THE SCREEN CANNOT LIE ABOUT ITS OWN BOARD, and it
  // has now caught that once. It used to assert the copy said "last season",
  // which was true until the ranking became ADP for the season being drafted —
  // and the sentence would have gone on claiming the old basis, on screen, with
  // every other test still green. Update it WITH the basis; never delete it.
  it('states what the ranking actually is', () => {
    expect(render()).toMatch(/average draft position/i);
    expect(render()).not.toMatch(/last season/i);
  });

  // The season is read from the loaded asset rather than written into the copy,
  // so the sentence cannot disagree with the file it describes.
  it('names the season from the ranking asset, not a constant', () => {
    _state.ranking = { season: 2031, ppr: [] };
    expect(render()).toContain('2031');
  });

  it('says nothing is saved, because nothing is', () => {
    expect(render()).toMatch(/nothing is saved/i);
  });

  it('changes a setting', () => {
    setField(null, 'teams', '10');
    expect(_state.setup.teams).toBe(10);
  });

  // ⚠️ Shrinking the league must not leave the human in a seat that no longer
  // exists — createMock would silently clamp them to the last seat instead.
  it('pulls the seat back inside a smaller league', () => {
    setField(null, 'slot', '12');
    setField(null, 'teams', '8');
    expect(_state.setup.slot).toBe(8);
  });

  it('keeps the seat when the league grows', () => {
    setField(null, 'slot', '5');
    setField(null, 'teams', '14');
    expect(_state.setup.slot).toBe(5);
  });
});

describe('the board', () => {
  beforeEach(() => { _state.mock = startedMock(); });

  it('renders the board, who is up, and the pool', () => {
    const html = render();
    // ⚠️ "Who is up" is the HERO now, not the old .db-clock banner. Asserting
    // `db-clock` here would still pass — it is a prefix of `db-clocktag`, which the
    // on-the-clock board cell renders — so this checks the hero's own markup.
    expect(html).toContain('gr-hero');
    expect(html).toContain('gr-overall');
    expect(html).toContain('db-pool');
    expect(html).toContain('Player');
  });

  it('shows progress through the draft', () => {
    expect(render()).toMatch(/\d+ \/ \d+ picks/);
  });

  it('offers a Draft button on your turn', () => {
    expect(onTheClock(_state.mock).owner).toBe(_state.mock.myTeam);
    expect(render()).toContain('draft-take');
  });

  it('filters the pool by position', () => {
    setFilter(null, 'QB');
    const html = render();
    expect(html).toContain('aria-selected="true"');
    expect(_state.filter).toBe('QB');
  });

  it('searches by name', () => {
    _state.query = 'Player 7';
    expect(render()).toContain('Player 7');
  });

  it('says so when a filter matches nobody', () => {
    _state.query = 'zzzznotaplayer';
    expect(render()).toMatch(/Nobody matches/i);
  });

  it('advances when you take a player', () => {
    const before = Object.keys(_state.mock.draft.picks).length;
    const first = render().match(/data-player="([^"]+)"/)[1];
    take(null, first);
    expect(Object.keys(_state.mock.draft.picks).length).toBeGreaterThan(before);
  });

  // ⚠️ A pick out of turn would desynchronise the board from the engine.
  it('ignores a pick when it is not your turn', () => {
    _state.mock = startedMock({ slot: 12 });
    // Rewind to a bot's turn by rebuilding without running the bots.
    _state.mock = createMock({
      teams: 12, rounds: 15, slot: 12, rosterPositions: DEFAULT_SLOTS,
      ranking: RANKING, positionOf: (id) => INDEX[id]?.p ?? null, seed: 5,
    });
    const before = Object.keys(_state.mock.draft.picks).length;
    take(null, 'p1');
    expect(Object.keys(_state.mock.draft.picks).length).toBe(before);
  });

  // ⚠️ Simulating PICKS for you rather than skipping. A skipped pick leaves a
  // hole the real draft can never produce.
  it('simulate takes a player rather than skipping the pick', () => {
    const before = Object.keys(_state.mock.draft.picks).length;
    simulate(null);
    expect(Object.keys(_state.mock.draft.picks).length).toBeGreaterThan(before);
  });

  it('shows your roster slots as they fill', () => {
    expect(render()).toContain('db-roster');
    expect(render()).toContain('Your roster');
  });

  it('goes back to setup on reset', () => {
    restart(null);
    expect(_state.mock).toBe(null);
    expect(render()).toContain('mock-start');
  });
});

describe('failure', () => {
  it('shows an error with a way out rather than a blank screen', () => {
    _state.error = 'Could not start the mock: ranking 404';
    const html = render();
    expect(html).toContain('ranking 404');
    expect(html).toContain('mock-reset');
  });
});

describe('the rank shown in the pool', () => {
  // ⚠️ It is the ORIGINAL ranking position, not the index in what is left.
  // Renumbering from 1 on every pick hides the only thing the number is for:
  // how far a player has slid past where they were supposed to go.
  it('keeps a player’s original rank after others are taken', () => {
    _state.mock = startedMock({ slot: 12 }); // eleven bots have already picked
    const html = render();
    const firstRank = Number(html.match(/db-rank">(\d+)</)[1]);
    expect(firstRank).toBeGreaterThan(1);
  });
});

describe('the finished mock', () => {
  it('grades the room rather than just stopping', () => {
    let m = startedMock();
    let guard = 400;
    while (guard-- > 0 && onTheClock(m)) {
      m = runBotsUntilMyTurn(m);
      if (!onTheClock(m)) break;
      const a = availableIn(m);
      if (!a.length) break;
      m = pick(m, a[0].id);
    }
    _state.mock = m;
    _state.ranking = { ppr_v: Object.fromEntries(RANKING.map((id, i) => [id, 300 - i])) };
    const html = render();
    expect(html).toMatch(/How the room drafted/i);
    expect(html).toContain('grade-mark');
    // ⚠️ The curve is stated, because a grade with no basis is decoration.
    expect(html).toMatch(/value over replacement/i);
  });
});

// ⚠️ FOUND BY BROWSER QA, not by the suite. renderFilters was made
// backward-compatible so the mock was "unchanged" — which left wave 1's
// roster-need pills invisible in the ONE draft surface that works solo. A live
// draft needs two teams; a rehearsal is exactly where roster need matters.
describe('roster-need pills in the mock', () => {
  const start = () => {
    restart(null);
    setField(null, 'teams', '12');
    setField(null, 'slot', '1');
    _state.mock = createMock({ ranking: RANKING, index: INDEX, teams: 12, rounds: 15, slot: 1 });
  };

  it('shows have/slots on the pills, not just availability', () => {
    start();
    expect(render()).toContain('db-filter-need');
  });

  it('counts the whole roster including bench in ALL', () => {
    start();
    const html = render();
    // 10 starters + 5 bench = 15 roster spots, nobody drafted yet.
    expect(html).toContain('0/15');
  });
});

describe('the mock renders on the same stage as the live draft', () => {
  beforeEach(() => { _state.mock = startedMock(); });

  it('wraps the board in a stage with a hero and a ticker', () => {
    const el = parse(render());
    expect(el.querySelector('.gr-stage')).not.toBeNull();
    expect(el.querySelector('.gr-stage .db')).not.toBeNull();
    expect(el.querySelector('.gr-tick')).not.toBeNull();
  });

  // ⚠️ THE MOCK HAS NO CLOCK. It is turn-based against bots — there is no deadline
  // and no countdown. A hero rendering "—" where a live draft shows 1:04 would be
  // the rehearsal lying about the event.
  it('renders the hero with no clock, because a mock has no deadline', () => {
    const el = parse(render());
    expect(el.querySelector('.gr-clock')).toBeNull();
    expect(el.querySelector('.gr-overall')).not.toBeNull();
  });

  it('renders the live rail from the mock picks', () => {
    // ⚠️ startedMock() runs the bots up to seat 1's turn, so on slot 1 the board can
    // legitimately be empty. Take a pick first so the rail has something to show.
    _state.mock = pick(_state.mock, availableIn(_state.mock)[0].id);
    const el = parse(render());
    expect(el.querySelector('.gr-feed').querySelectorAll('.gr-feed-item').length).toBeGreaterThan(0);
  });

  it('keeps the same stage once the draft is complete', () => {
    _state.mock = startedMock({ teams: 2, rounds: 1 });
    const el = parse(render());
    expect(el.querySelector('.gr-stage')).not.toBeNull();
  });

  // ⚠️ THE BOARD IS THE LAST THING ON THE PAGE. It is a record; the pool is the
  // control. Ordering them the other way put fifteen rounds of empty cells
  // between a manager and the only button they came for.
  it('puts the board below the pool and the roster', () => {
    _state.mock = startedMock();
    const html = render();
    const board = html.indexOf('gr-stage-board');
    const pool = html.indexOf('mock-pool-col');
    const side = html.indexOf('mock-side');
    expect(board).toBeGreaterThan(-1);
    expect(pool).toBeGreaterThan(-1);
    expect(board).toBeGreaterThan(pool);
    expect(board).toBeGreaterThan(side);
  });

  it('keeps the hero and ticker in a band with no empty column strip', () => {
    _state.mock = startedMock();
    const el = parse(render());
    const hero = el.querySelector('.gr-stage:not(.gr-stage-board)');
    expect(hero.querySelector('.gr-hero')).not.toBeNull();
    expect(hero.querySelector('.gr-cols')).toBeNull();
  });
});

function mockOnClockFor(team) {
  // Shaped so `currentPick` reports `team` on the clock with nothing picked yet.
  return {
    myTeam: team,
    rosterPositions: ['QB', 'RB', 'BN'],
    ranking: ['a', 'b', 'c'],
    positionOf: () => 'RB',
    draft: { picks: {}, order: [{ overall: 1, round: 1, pickInRound: 1, slot: team, owner: team }] },
  };
}

describe('the optional pick clock', () => {
  beforeEach(() => { reset(); vi.useRealTimers(); });
  afterEach(() => { stopClock(); vi.useRealTimers(); });

  // ⚠️ OFF BY DEFAULT. A mock is a rehearsal, and thinking time is most of what
  // it is for — the clock is offered, not imposed.
  it('is off unless it is turned on', () => {
    expect(_state.setup.clock).toBe(0);
    // Your turn, on a real board — the only reason no clock runs is the setting.
    _state.mock = mockOnClockFor('m1');
    armClock();
    expect(_state.deadline).toBe(null);
    expect(remainingMs()).toBe(null);
  });

  it('offers the setting on the setup screen, defaulting to Off', () => {
    const html = render();
    expect(html).toContain('data-field="clock"');
    expect(html).toMatch(/<option value="0" selected>Off<\/option>/);
  });

  it('arms only for YOUR turn, never a bot\'s', () => {
    _state.setup.clock = 60;
    // A bot on the clock: no countdown, because a bot answers instantly and a
    // timer for it could never run out.
    _state.mock = { myTeam: 'm1', draft: { picks: {}, order: [{ overall: 1, owner: 'm2' }] } };
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    armClock();
    expect(_state.deadline).toBe(null);
  });

  it('counts down from the configured seconds when it is your pick', () => {
    _state.setup.clock = 60;
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    _state.mock = mockOnClockFor('m1');
    armClock();
    expect(_state.deadline).toBe(now + 60_000);
    expect(remainingMs()).toBe(60_000);
    Date.now.mockReturnValue(now + 45_000);
    expect(remainingMs()).toBe(15_000);
    // Never negative — a clock reading "-0:03" is worse than one reading 0:00.
    Date.now.mockReturnValue(now + 99_000);
    expect(remainingMs()).toBe(0);
  });

  it('clears the countdown once the board is finished', () => {
    _state.setup.clock = 60;
    _state.mock = { myTeam: 'm1', draft: { picks: {}, order: [] } }; // nobody on the clock
    armClock();
    expect(_state.deadline).toBe(null);
  });

  // ⚠️ The whole point of the setting. With it off, no timer is ever opened.
  it('opens no timer at all while the clock is off', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    _state.setup.clock = 0;
    _state.mock = mockOnClockFor('m1');
    armClock();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // 🔴 THE GAP THIS CLOSES. Every other test here calls armClock/remainingMs
  // directly and never RENDERS with a live deadline — so a missing `formatClock`
  // import passed the whole suite and threw the moment a clock was switched on.
  // With the clock off the ternary short-circuits and never touches it, which is
  // why the default path looked healthy.
  it('renders the countdown onto the board without throwing', () => {
    _state.setup.clock = 60;
    _state.mock = mockOnClockFor('m1');
    armClock();
    expect(_state.deadline).not.toBe(null);
    const html = render();
    expect(html).toContain('data-draft-clock');
    // A real mm:ss, not "undefined" or "—".
    expect(html).toMatch(/data-draft-clock[^>]*>\s*\d+:\d{2}/);
  });

  it('renders no clock element at all when the clock is off', () => {
    _state.setup.clock = 0;
    _state.mock = mockOnClockFor('m1');
    armClock();
    expect(render()).not.toContain('data-draft-clock');
  });

  it('stops cleanly, and stopping twice is safe', () => {
    _state.setup.clock = 30;
    _state.mock = mockOnClockFor('m1');
    armClock();
    expect(() => { stopClock(); stopClock(); }).not.toThrow();
  });
});
