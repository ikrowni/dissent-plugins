import { describe, it, expect, beforeEach } from 'vitest';
import { setSlot, useIndex, _state, reset, render } from './league-roster.js';

const INDEX = {
  qb1: { n: 'Quinn Back', p: 'QB', t: 'KC' },
  rb1: { n: 'Ray Bee', p: 'RB', t: 'DET' },
  rb2: { n: 'Rob Bee', p: 'RB', t: 'SF' },
  wr1: { n: 'Will Rec', p: 'WR', t: 'MIN' },
};

beforeEach(() => {
  reset();
  useIndex(INDEX);
  Object.assign(_state, {
    leagueId: 'lg', teamId: 't1', week: 3, loaded: true,
    league: {
      settings: { rosterPositions: ['QB', 'RB', 'FLEX', 'BN'] },
      assets: { rosters: { t1: { players: ['qb1', 'rb1', 'rb2', 'wr1'], ir: [], taxi: [] } } },
    },
    lineup: [null, null, null],
  });
});

describe('setSlot', () => {
  it('assigns a player to a slot', () => {
    setSlot(null, 0, 'qb1');
    expect(_state.lineup).toEqual(['qb1', null, null]);
  });

  it('clears a slot with an empty value', () => {
    setSlot(null, 0, 'qb1');
    setSlot(null, 0, '');
    expect(_state.lineup[0]).toBe(null);
  });

  // ⚠️ Starting someone already in another slot MOVES them. Cloning would put
  // one player in two slots, which the module rejects — so the UI would offer a
  // lineup that can never be saved.
  it('moves a player rather than cloning them', () => {
    setSlot(null, 1, 'rb1');
    setSlot(null, 2, 'rb1');
    expect(_state.lineup).toEqual([null, null, 'rb1']);
  });

  it('ignores an out-of-range slot instead of growing the array', () => {
    setSlot(null, 9, 'qb1');
    setSlot(null, -1, 'qb1');
    expect(_state.lineup).toHaveLength(3);
    expect(_state.lineup.every((x) => x === null)).toBe(true);
  });

  // ⚠️ The lineup is POSITIONAL — a hole must stay a hole. Compacting it shifts
  // every slot after the gap and starts the wrong players.
  it('keeps holes rather than compacting them', () => {
    setSlot(null, 0, 'qb1');
    setSlot(null, 2, 'wr1');
    expect(_state.lineup).toEqual(['qb1', null, 'wr1']);
  });
});

describe('render', () => {
  // ⚠️ Scoped to ONE ROW. Slicing to the end of the document sweeps in the bench
  // list, where every player legitimately appears — which made this pass for the
  // wrong reason and then fail for the wrong reason.
  // ⚠️ Attribute-agnostic. Matching the exact tag text coupled this helper to
  // the markup, so adding a position colour to the slot cell silently returned
  // an empty string and every assertion "failed" for the wrong reason.
  const rowFor = (html, slot) => {
    const m = new RegExp(`<td class="slot"[^>]*>${slot}</td>`).exec(html);
    if (!m) return '';
    const end = html.indexOf('</tr>', m.index);
    return html.slice(m.index, end);
  };

  it('offers only eligible players for a slot', () => {
    const qbRow = rowFor(render(), 'QB');
    expect(qbRow).toContain('Quinn Back');
    expect(qbRow).not.toContain('Ray Bee');
  });

  it('offers RB and WR in a FLEX slot but not a QB', () => {
    const flexRow = rowFor(render(), 'FLEX');
    expect(flexRow).toContain('Ray Bee');
    expect(flexRow).toContain('Will Rec');
    expect(flexRow).not.toContain('Quinn Back');
  });

  it('shows an unknown player by id rather than blank', () => {
    _state.league.assets.rosters.t1.players.push('ghost');
    expect(render()).toContain('#ghost');
  });

  it('moves a started player out of the bench list', () => {
    setSlot(null, 0, 'qb1');
    const html = render();
    const bench = html.slice(html.indexOf('<h4>Bench</h4>'));
    expect(bench).not.toContain('Quinn Back');
    expect(bench).toContain('Ray Bee');
  });

  it('renders an error as a pane with a retry, not a blank screen', () => {
    _state.error = 'you do not manage team t1';
    const html = render();
    expect(html).toContain('you do not manage team t1');
    expect(html).toContain('roster-retry');
  });

  it('says so plainly when the user has no team', () => {
    _state.teamId = null;
    expect(render()).toContain('do not have a team');
  });

  it('escapes player names rather than injecting them', () => {
    useIndex({ x1: { n: '<img src=x onerror=alert(1)>', p: 'QB' } });
    _state.league.assets.rosters.t1.players = ['x1'];
    const html = render();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

// ── The lineup repaint ───────────────────────────────────────────────────────
//
// ⚠️ THE REGRESSION. Every slot's dropdown is built from the BENCH, which is
// "held, minus whoever is already starting" — so the lists are only correct as
// of the last render. Without a repaint after each change, a player you had just
// started stayed listed in every other slot and could be picked again. The state
// deduped him underneath, so the screen showed one lineup and the save sent a
// different one, which is worse than either being wrong on its own.
describe('setSlot repaints', () => {
  it('asks the router to re-render, so the other dropdowns drop the player', () => {
    let refreshed = 0;
    setSlot({ router: { refresh: () => { refreshed += 1; } } }, 0, 'qb1');
    expect(refreshed).toBe(1);
  });

  it('does not throw without a router', () => {
    expect(() => setSlot(null, 0, 'qb1')).not.toThrow();
    expect(() => setSlot({}, 1, 'rb1')).not.toThrow();
  });

  it('leaves a re-rendered slot offering nobody who is already starting', () => {
    setSlot(null, 1, 'rb1');          // RB slot takes rb1
    const flexRow = render().match(/<td class="slot"[^>]*>FLEX<\/td>[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(flexRow).not.toContain('Ray Bee');
    expect(flexRow).toContain('Rob Bee');
  });
});

// ── Injured reserve ──────────────────────────────────────────────────────────
describe('injured reserve', () => {
  const withIR = (over = {}) => {
    _state.league.settings.rosterPositions = ['QB', 'RB', 'FLEX', 'BN', 'IR'];
    Object.assign(_state.league.assets.rosters.t1, over);
  };

  // ⚠️ THE EMPTY SLOT IS THE POINT. This section used to render nothing at all
  // until somebody was already on IR, so a manager could not see that the league
  // HAD an IR slot, let alone that one was free.
  it('shows the IR slot even when nobody is on it', () => {
    withIR();
    const html = render();
    expect(html).toContain('Injured reserve');
    expect(html).toContain('Empty IR slot');
    expect(html).toContain('0 / 1');
  });

  it('shows nothing at all for a league with no IR slots', () => {
    expect(render()).not.toContain('Injured reserve');
  });

  it('counts the occupied slots against the total', () => {
    useIndex({ ...INDEX, rb2: { ...INDEX.rb2, i: 'IR' } });
    withIR({ players: ['qb1', 'rb1', 'wr1'], ir: ['rb2'] });
    const html = render();
    expect(html).toContain('1 / 1');
    expect(html).not.toContain('Empty IR slot');
  });

  // ⚠️ IR does not count against the roster limit, so a healthy player parked
  // there is a free extra bench spot for whoever thinks to try it.
  it('disables the IR button for a healthy player', () => {
    withIR();
    const html = render();
    const row = html.match(/data-act="roster-ir" data-player="rb1"[\s\S]*?>IR<\/button>/)?.[0] ?? '';
    expect(row).toContain('disabled');
  });

  it('enables the IR button for a player carrying a reserve designation', () => {
    useIndex({ ...INDEX, rb1: { ...INDEX.rb1, i: 'IR' } });
    withIR();
    const row = render().match(/data-act="roster-ir" data-player="rb1"[\s\S]*?>IR<\/button>/)?.[0] ?? '';
    expect(row).not.toContain('disabled');
  });

  // Out is week-to-week, not a season-length reserve designation.
  it('still refuses a player who is merely Out', () => {
    useIndex({ ...INDEX, rb1: { ...INDEX.rb1, i: 'Out' } });
    withIR();
    const row = render().match(/data-act="roster-ir" data-player="rb1"[\s\S]*?>IR<\/button>/)?.[0] ?? '';
    expect(row).toContain('disabled');
  });

  it('shows the designation beside the player so the rule is visible', () => {
    useIndex({ ...INDEX, rb1: { ...INDEX.rb1, i: 'PUP' } });
    withIR();
    expect(render()).toContain('>PUP</span>');
  });

  // ⚠️ A hidden button with no explanation reads as a broken screen — the
  // manager cannot tell whether the feature is missing or the player ineligible.
  it('names who is IR-eligible when somebody is', () => {
    useIndex({ ...INDEX, rb1: { ...INDEX.rb1, i: 'IR' } });
    withIR();
    expect(render()).toMatch(/IR watchlist:[\s\S]*Ray Bee/);
  });

  it('says why the list is empty when nobody qualifies', () => {
    withIR();
    expect(render()).toMatch(/Nobody on your roster is IR-eligible/);
  });
});
