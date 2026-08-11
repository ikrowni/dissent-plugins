import { describe, it, expect } from 'vitest';
import {
  availablePool, filterPool, poolCounts, matchesFilter, unfilledSlots, POOL_FILTERS,
} from './draft-pool.js';

const INDEX = {
  qb1: { n: 'Quinn Back', p: 'QB' },
  qb2: { n: 'Quentin Arm', p: 'QB' },
  rb1: { n: 'Ray Bee', p: 'RB' },
  rb2: { n: 'Rob Bee', p: 'RB' },
  wr1: { n: 'Will Rec', p: 'WR' },
  te1: { n: 'Tay End', p: 'TE' },
  k1: { n: 'Kip Boot', p: 'K' },
  d1: { n: 'Chicago Bears', p: 'DEF' },
};
const positionOf = (id) => INDEX[id]?.p ?? null;
const nameOf = (id) => INDEX[id]?.n ?? '';
const RANKING = ['qb1', 'rb1', 'wr1', 'rb2', 'te1', 'qb2', 'k1', 'd1'];

describe('availablePool', () => {
  it('lists everybody in ranking order when nothing is taken', () => {
    const pool = availablePool({ ranking: RANKING, positionOf });
    expect(pool.map((e) => e.id)).toEqual(RANKING);
  });

  it('resolves each entry to a position', () => {
    const pool = availablePool({ ranking: RANKING, positionOf });
    expect(pool[0]).toEqual({ id: 'qb1', pos: 'QB', rank: 1 });
  });

  it('excludes players already drafted', () => {
    const pool = availablePool({ ranking: RANKING, taken: ['rb1', 'wr1'], positionOf });
    expect(pool.map((e) => e.id)).toEqual(['qb1', 'rb2', 'te1', 'qb2', 'k1', 'd1']);
  });

  it('accepts a Set of taken ids as well as an array', () => {
    const pool = availablePool({ ranking: RANKING, taken: new Set(['qb1']), positionOf });
    expect(pool.map((e) => e.id)).not.toContain('qb1');
  });

  // ⚠️ THE RANK IS THE ORIGINAL RANK. Renumbering the remaining players from 1
  // on every pick hides the only thing the number is for — how far somebody has
  // slid past where they were supposed to go.
  it('keeps the original rank after players are taken, rather than renumbering', () => {
    const pool = availablePool({ ranking: RANKING, taken: ['qb1', 'rb1'], positionOf });
    expect(pool[0]).toMatchObject({ id: 'wr1', rank: 3 });
  });

  // A duplicated id would otherwise render two rows, each with a Draft button.
  it('lists a duplicated id once, at its first rank', () => {
    const pool = availablePool({ ranking: ['qb1', 'rb1', 'qb1'], positionOf });
    expect(pool.map((e) => e.id)).toEqual(['qb1', 'rb1']);
    expect(pool[0].rank).toBe(1);
  });

  it('survives an unknown player rather than dropping them', () => {
    const pool = availablePool({ ranking: ['ghost'], positionOf });
    expect(pool).toEqual([{ id: 'ghost', pos: '', rank: 1 }]);
  });

  it('returns nothing for a missing ranking instead of throwing', () => {
    expect(availablePool()).toEqual([]);
    expect(availablePool({ ranking: null })).toEqual([]);
  });
});

describe('matchesFilter', () => {
  it('lets everybody through on ALL', () => {
    expect(matchesFilter('QB', 'ALL')).toBe(true);
    expect(matchesFilter('DEF', undefined)).toBe(true);
  });

  it('matches a position exactly', () => {
    expect(matchesFilter('RB', 'RB')).toBe(true);
    expect(matchesFilter('WR', 'RB')).toBe(false);
  });

  // ⚠️ FLEX is a SET, not a position. A quarterback is not flex-eligible, and a
  // board that offered one there would be describing a lineup nobody can set.
  it('treats FLEX as RB/WR/TE and excludes the quarterback', () => {
    expect(matchesFilter('RB', 'FLEX')).toBe(true);
    expect(matchesFilter('WR', 'FLEX')).toBe(true);
    expect(matchesFilter('TE', 'FLEX')).toBe(true);
    expect(matchesFilter('QB', 'FLEX')).toBe(false);
    expect(matchesFilter('K', 'FLEX')).toBe(false);
  });
});

describe('filterPool', () => {
  const pool = availablePool({ ranking: RANKING, positionOf });

  // ⚠️ THE WHOLE POINT OF THE FEATURE. A manager on the clock for a quarterback
  // gets the quarterbacks, best first, without typing anything.
  it('gives one position, still in ranking order', () => {
    const rows = filterPool(pool, { filter: 'QB', nameOf });
    expect(rows.map((e) => e.id)).toEqual(['qb1', 'qb2']);
  });

  it('narrows by name within the filter', () => {
    const rows = filterPool(pool, { filter: 'RB', query: 'rob', nameOf });
    expect(rows.map((e) => e.id)).toEqual(['rb2']);
  });

  it('ignores case and surrounding space in the query', () => {
    expect(filterPool(pool, { query: '  BEE ', nameOf }).map((e) => e.id))
      .toEqual(['rb1', 'rb2']);
  });

  // ⚠️ Ordered by DRAFT VALUE, never by how well the name matched. Re-sorting on
  // match quality would put a replacement-level player above an elite one for no
  // better reason than spelling.
  it('keeps draft order rather than re-sorting on the match', () => {
    const rows = filterPool(pool, { query: 'e', nameOf });
    const ranks = rows.map((e) => e.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('returns everything when the query is blank', () => {
    expect(filterPool(pool, { query: '   ', nameOf })).toHaveLength(RANKING.length);
  });
});

describe('poolCounts', () => {
  it('counts each filter over the whole pool', () => {
    const counts = poolCounts(availablePool({ ranking: RANKING, positionOf }));
    expect(counts.ALL).toBe(8);
    expect(counts.QB).toBe(2);
    expect(counts.RB).toBe(2);
    expect(counts.FLEX).toBe(4); // rb1, rb2, wr1, te1
    expect(counts.DEF).toBe(1);
  });

  it('covers every filter the row renders, so no tab shows a blank badge', () => {
    const counts = poolCounts(availablePool({ ranking: RANKING, positionOf }));
    for (const f of POOL_FILTERS) expect(counts[f]).toBeTypeOf('number');
  });

  it('drops the count as players are drafted', () => {
    const counts = poolCounts(availablePool({ ranking: RANKING, taken: ['qb1'], positionOf }));
    expect(counts.QB).toBe(1);
  });
});

describe('unfilledSlots', () => {
  const owned = (...positions) => positions.map((p, i) => ({ id: `p${i}`, pos: p }));

  it('reports every slot for an empty roster', () => {
    expect(unfilledSlots(['QB', 'RB', 'FLEX'], [])).toEqual(['QB', 'RB', 'FLEX']);
  });

  it('reports nothing once every slot is covered', () => {
    expect(unfilledSlots(['QB', 'RB'], owned('QB', 'RB'))).toEqual([]);
  });

  // ⚠️ FLEX IS RESOLVED LAST. A team holding one RB against ['RB','FLEX'] needs a
  // FLEX — letting FLEX claim the running back first would report a need for an
  // RB the team already has.
  it('fills the named slots before the flex', () => {
    expect(unfilledSlots(['RB', 'FLEX'], owned('RB'))).toEqual(['FLEX']);
  });

  it('lets a spare receiver cover the flex', () => {
    expect(unfilledSlots(['RB', 'FLEX'], owned('RB', 'WR'))).toEqual([]);
  });

  it('does not let a quarterback cover a flex', () => {
    expect(unfilledSlots(['QB', 'FLEX'], owned('QB', 'QB'))).toEqual(['FLEX']);
  });

  it('counts duplicate slots separately', () => {
    expect(unfilledSlots(['RB', 'RB'], owned('RB'))).toEqual(['RB']);
  });
});

// ── Flex variants beyond the literal 'FLEX' ──────────────────────────────────
// ⚠️ `slots.js` has supported FLEX, WRRB_FLEX, REC_FLEX, SUPER_FLEX and
// IDP_FLEX from the start. This module carried its OWN hardcoded flex set and
// matched only the string 'FLEX', so every other variant fell through to the
// exact-position branch — where it looks for a player whose POSITION is
// literally "SUPER_FLEX", i.e. nobody.
describe('flex variants in unfilledSlots', () => {
  it('treats SUPER_FLEX as filled by a QB', () => {
    expect(unfilledSlots(['SUPER_FLEX'], [{ pos: 'QB' }])).toEqual([]);
  });

  it('treats SUPER_FLEX as filled by an RB', () => {
    expect(unfilledSlots(['SUPER_FLEX'], [{ pos: 'RB' }])).toEqual([]);
  });

  it('leaves SUPER_FLEX unfilled when only a kicker is left', () => {
    expect(unfilledSlots(['SUPER_FLEX'], [{ pos: 'K' }])).toEqual(['SUPER_FLEX']);
  });

  it('treats WRRB_FLEX as filled by a WR but not a TE', () => {
    expect(unfilledSlots(['WRRB_FLEX'], [{ pos: 'WR' }])).toEqual([]);
    expect(unfilledSlots(['WRRB_FLEX'], [{ pos: 'TE' }])).toEqual(['WRRB_FLEX']);
  });

  it('treats REC_FLEX as filled by a TE but not an RB', () => {
    expect(unfilledSlots(['REC_FLEX'], [{ pos: 'TE' }])).toEqual([]);
    expect(unfilledSlots(['REC_FLEX'], [{ pos: 'RB' }])).toEqual(['REC_FLEX']);
  });

  // ⚠️ Exact slots must still be filled FIRST, or a superflex swallows the QB
  // and the QB slot reports unfilled with a quarterback sitting in the flex.
  it('fills the exact QB slot before the superflex', () => {
    expect(unfilledSlots(['QB', 'SUPER_FLEX'], [{ pos: 'QB' }, { pos: 'RB' }])).toEqual([]);
  });
});
