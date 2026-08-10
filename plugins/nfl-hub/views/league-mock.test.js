import { describe, it, expect, beforeEach } from 'vitest';
import { render, reset, setField, take, simulate, setFilter, restart, _state, DEFAULT_SLOTS } from './league-mock.js';
import { setIndex } from '../core/player-index.js';
import { createMock, runBotsUntilMyTurn, onTheClock } from '../core/mock-draft.js';

const MIX = ['RB', 'WR', 'WR', 'QB', 'RB', 'TE', 'WR', 'RB', 'QB', 'WR', 'TE', 'K', 'DEF'];
const INDEX = Object.fromEntries(
  Array.from({ length: 200 }, (_, i) => [`p${i + 1}`, { n: `Player ${i + 1}`, p: MIX[i % MIX.length], t: 'KC' }]),
);
const RANKING = Object.keys(INDEX);

beforeEach(() => { reset(); setIndex(INDEX); });

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

  // ⚠️ The ranking is last season's points, not a projection. Somebody who
  // thinks otherwise will draw wrong conclusions from a working board.
  it('states what the ranking actually is', () => {
    expect(render()).toMatch(/last season/i);
    expect(render()).toMatch(/not a projection/i);
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

  it('renders the board, the clock and the pool', () => {
    const html = render();
    expect(html).toContain('db-clock');
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
