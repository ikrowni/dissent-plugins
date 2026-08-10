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
    setSlot(0, 'qb1');
    expect(_state.lineup).toEqual(['qb1', null, null]);
  });

  it('clears a slot with an empty value', () => {
    setSlot(0, 'qb1');
    setSlot(0, '');
    expect(_state.lineup[0]).toBe(null);
  });

  // ⚠️ Starting someone already in another slot MOVES them. Cloning would put
  // one player in two slots, which the module rejects — so the UI would offer a
  // lineup that can never be saved.
  it('moves a player rather than cloning them', () => {
    setSlot(1, 'rb1');
    setSlot(2, 'rb1');
    expect(_state.lineup).toEqual([null, null, 'rb1']);
  });

  it('ignores an out-of-range slot instead of growing the array', () => {
    setSlot(9, 'qb1');
    setSlot(-1, 'qb1');
    expect(_state.lineup).toHaveLength(3);
    expect(_state.lineup.every((x) => x === null)).toBe(true);
  });

  // ⚠️ The lineup is POSITIONAL — a hole must stay a hole. Compacting it shifts
  // every slot after the gap and starts the wrong players.
  it('keeps holes rather than compacting them', () => {
    setSlot(0, 'qb1');
    setSlot(2, 'wr1');
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
    setSlot(0, 'qb1');
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
