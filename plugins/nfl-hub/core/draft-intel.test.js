import { describe, it, expect } from 'vitest';
import { recentPicks, detectRun, RUN_WINDOW, RUN_THRESHOLD } from './draft-intel.js';

/** picks keyed by overall, exactly as core/league/draft.js:118 writes them. */
const picksOf = (...ids) => Object.fromEntries(
  ids.map((id, i) => [i + 1, { playerId: String(id), teamId: `t${i % 4}`, at: 1000 + i, auto: false }]),
);
const posMap = {
  a: 'RB', b: 'RB', c: 'WR', d: 'RB', e: 'QB', f: 'RB', g: 'TE', h: 'WR',
};
const positionOf = (id) => posMap[id] ?? null;

describe('recentPicks', () => {
  it('returns the last N picks, most recent first', () => {
    const got = recentPicks(picksOf('a', 'b', 'c', 'd'), 2);
    expect(got.map((p) => p.playerId)).toEqual(['d', 'c']);
  });

  it('orders by overall NUMERICALLY, not by object key string order', () => {
    // ⚠️ Object.keys gives '10' before '9' as strings. A board past nine picks
    // would report the wrong "most recent" pick and the run window would be junk.
    const picks = {};
    for (let i = 1; i <= 12; i += 1) picks[i] = { playerId: `p${i}`, teamId: 't', at: i, auto: false };
    expect(recentPicks(picks, 1)[0].playerId).toBe('p12');
  });

  it('returns everything when fewer picks than the window exist', () => {
    expect(recentPicks(picksOf('a', 'b'), 6)).toHaveLength(2);
  });

  it('returns an empty array for an empty or missing board', () => {
    expect(recentPicks({}, 6)).toEqual([]);
    expect(recentPicks(undefined, 6)).toEqual([]);
  });
});

describe('detectRun', () => {
  it('reports a run when the threshold is met inside the window', () => {
    // last 6 = f e d c b a -> RB QB RB WR RB RB = 4 RB
    const run = detectRun(picksOf('a', 'b', 'c', 'd', 'e', 'f'), { positionOf });
    expect(run).toEqual({ pos: 'RB', count: 4, window: 6 });
  });

  it('reports nothing when the threshold is not met', () => {
    // last 6 = h g f e d c -> WR TE RB QB RB WR = 2 RB, 2 WR
    const run = detectRun(picksOf('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), { positionOf });
    expect(run).toBeNull();
  });

  it('never counts a pick from outside the window', () => {
    // ⚠️ MUTATION CHECK. Nine picks, the first three all RB, the last six only
    // three RB. A window off by one — 7 instead of 6 — pulls a fourth RB in and
    // announces a run that is not happening. That error is invisible on screen.
    const map = {
      p1: 'RB', p2: 'RB', p3: 'RB', p4: 'WR', p5: 'RB', p6: 'QB',
      p7: 'RB', p8: 'TE', p9: 'RB',
    };
    const picks = {};
    for (let i = 1; i <= 9; i += 1) picks[i] = { playerId: `p${i}`, teamId: 't', at: i, auto: false };
    // last 6 = p9..p4 -> RB TE RB QB RB WR = 3 RB. Threshold is 4.
    expect(detectRun(picks, { positionOf: (id) => map[id] ?? null })).toBeNull();
    // Widening by exactly one pulls in p3 (RB) and would wrongly fire.
    expect(detectRun(picks, { positionOf: (id) => map[id] ?? null, window: 7 }))
      .toEqual({ pos: 'RB', count: 4, window: 7 });
  });

  it('ignores picks whose position is unknown rather than grouping them together', () => {
    // ⚠️ Without this, five unresolved ids become a run on position "".
    const picks = picksOf('x1', 'x2', 'x3', 'x4', 'x5', 'x6');
    expect(detectRun(picks, { positionOf: () => null })).toBeNull();
  });

  it('reports the position with the most picks when two qualify', () => {
    const map = { q1: 'RB', q2: 'RB', q3: 'RB', q4: 'RB', q5: 'RB', q6: 'WR' };
    const picks = {};
    for (let i = 1; i <= 6; i += 1) picks[i] = { playerId: `q${i}`, teamId: 't', at: i, auto: false };
    expect(detectRun(picks, { positionOf: (id) => map[id] ?? null }))
      .toEqual({ pos: 'RB', count: 5, window: 6 });
  });

  it('exposes its constants so the view and the tests cannot disagree', () => {
    expect(RUN_WINDOW).toBe(6);
    expect(RUN_THRESHOLD).toBe(4);
  });
});
