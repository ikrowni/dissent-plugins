import { describe, it, expect } from 'vitest';
import {
  subEligible, validateAutoSubs, resolveAutoSubs, playedThisWeek,
} from './autosubs.js';

describe('subEligible', () => {
  it('accepts a sub whose position satisfies the starter slot', () => {
    expect(subEligible({ starterSlot: 'RB', subPosition: 'RB' })).toBe(true);
  });

  it('rejects a sub whose position does not', () => {
    expect(subEligible({ starterSlot: 'RB', subPosition: 'WR' })).toBe(false);
  });

  // ⚠️ Eligibility is against the SLOT. A flex starter who happens to be an RB
  // may be backed by any flex-eligible player.
  it('lets a WR back up a flex starter', () => {
    expect(subEligible({ starterSlot: 'FLEX', subPosition: 'WR' })).toBe(true);
  });

  it('rejects a QB backing up a plain flex', () => {
    expect(subEligible({ starterSlot: 'FLEX', subPosition: 'QB' })).toBe(false);
  });

  it('accepts a QB backing up a superflex', () => {
    expect(subEligible({ starterSlot: 'SUPER_FLEX', subPosition: 'QB' })).toBe(true);
  });

  it('rejects bench slots as starters', () => {
    expect(subEligible({ starterSlot: 'BN', subPosition: 'RB' })).toBe(false);
    expect(subEligible({ starterSlot: 'IR', subPosition: 'RB' })).toBe(false);
  });

  it('is false on missing input', () => {
    expect(subEligible({})).toBe(false);
    expect(subEligible({ starterSlot: 'RB' })).toBe(false);
    expect(subEligible()).toBe(false);
  });
});

describe('validateAutoSubs', () => {
  const starterSlots = ['QB', 'RB', 'RB', 'FLEX'];
  const lineup = ['qb1', 'rb1', 'rb2', 'wr1'];
  const positionOf = (id) => ({
    qb1: 'QB', rb1: 'RB', rb2: 'RB', wr1: 'WR',
    benchRb: 'RB', benchWr: 'WR', benchQb: 'QB',
  }[id] ?? null);
  const roster = ['qb1', 'rb1', 'rb2', 'wr1', 'benchRb', 'benchWr', 'benchQb'];
  const base = { lineup, starterSlots, positionOf, roster, maxSubs: 2 };

  it('accepts a legal set', () => {
    expect(validateAutoSubs({ ...base, subs: { rb1: 'benchRb' } }).ok).toBe(true);
  });

  it('refuses more subs than the league allows', () => {
    const r = validateAutoSubs({
      ...base, subs: { rb1: 'benchRb', rb2: 'benchWr', wr1: 'benchQb' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at most 2/i);
  });

  it('refuses when the league has AutoSubs off', () => {
    const r = validateAutoSubs({ ...base, maxSubs: 0, subs: { rb1: 'benchRb' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not enabled/i);
  });

  // ⚠️ Sleeper is explicit: a sub can only match to one starter.
  it('refuses one sub covering two starters', () => {
    const r = validateAutoSubs({ ...base, subs: { rb1: 'benchRb', rb2: 'benchRb' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/more than one/i);
  });

  it('refuses a sub who is already starting', () => {
    const r = validateAutoSubs({ ...base, subs: { rb1: 'rb2' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already starting/i);
  });

  it('refuses a starter who is not in the lineup', () => {
    const r = validateAutoSubs({ ...base, subs: { nobody: 'benchRb' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not in the lineup/i);
  });

  it('refuses a sub who is not on the roster', () => {
    const r = validateAutoSubs({ ...base, subs: { rb1: 'stranger' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not on the roster/i);
  });

  it('refuses an ineligible position', () => {
    const r = validateAutoSubs({ ...base, subs: { qb1: 'benchRb' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot back up/i);
  });

  it('accepts a flex starter backed by a different eligible position', () => {
    expect(validateAutoSubs({ ...base, subs: { wr1: 'benchRb' } }).ok).toBe(true);
  });

  it('accepts an empty set as clearing them', () => {
    expect(validateAutoSubs({ ...base, subs: {} }).ok).toBe(true);
    expect(validateAutoSubs({ ...base }).ok).toBe(true);
  });
});

describe('playedThisWeek', () => {
  it('is true when gp is 1', () => {
    expect(playedThisWeek({ gp: 1, pts_ppr: 12.3 })).toBe(true);
  });

  // ⚠️ Playing and scoring nothing is NOT a did-not-play. Substituting here
  // would be the feature taking points off a manager who did nothing wrong.
  it('is true for a player who played and scored nothing', () => {
    expect(playedThisWeek({ gp: 1 })).toBe(true);
  });

  it('is false when gp is missing', () => {
    expect(playedThisWeek({ pts_ppr: null })).toBe(false);
  });

  it('is false with no stats row at all', () => {
    expect(playedThisWeek(null)).toBe(false);
    expect(playedThisWeek(undefined)).toBe(false);
  });

  it('never infers play from points', () => {
    expect(playedThisWeek({ pts_ppr: 22.5 })).toBe(false);
  });
});

describe('resolveAutoSubs', () => {
  const starterSlots = ['QB', 'RB', 'RB'];
  const lineup = ['qb1', 'rb1', 'rb2'];
  const stats = { qb1: { gp: 1 }, rb2: { gp: 1 }, benchRb: { gp: 1 } };
  const statsOf = (id) => stats[id] ?? null;

  it('swaps a starter who did not play', () => {
    const r = resolveAutoSubs({ lineup, starterSlots, subs: { rb1: 'benchRb' }, statsOf });
    expect(r.lineup).toEqual(['qb1', 'benchRb', 'rb2']);
    expect(r.applied).toEqual([{ slot: 'RB', out: 'rb1', in: 'benchRb' }]);
  });

  it('leaves a starter who played alone', () => {
    const r = resolveAutoSubs({ lineup, starterSlots, subs: { rb2: 'benchRb' }, statsOf });
    expect(r.lineup).toEqual(lineup);
    expect(r.applied).toEqual([]);
  });

  // The sub is a replacement for an absence, not an upgrade.
  it('does not swap when the sub also did not play', () => {
    const r = resolveAutoSubs({ lineup, starterSlots, subs: { rb1: 'ghost' }, statsOf });
    expect(r.lineup).toEqual(lineup);
    expect(r.applied).toEqual([]);
  });

  it('never re-checks the roster limit', () => {
    const r = resolveAutoSubs({
      lineup, starterSlots, subs: { rb1: 'benchRb' }, statsOf, rosterOverLimit: true,
    });
    expect(r.lineup).toEqual(['qb1', 'benchRb', 'rb2']);
  });

  it('ignores a designation whose starter left the lineup', () => {
    const r = resolveAutoSubs({ lineup, starterSlots, subs: { traded: 'benchRb' }, statsOf });
    expect(r.lineup).toEqual(lineup);
    expect(r.applied).toEqual([]);
  });

  it('is a no-op with no designations', () => {
    expect(resolveAutoSubs({ lineup, starterSlots, subs: {}, statsOf }).lineup).toEqual(lineup);
    expect(resolveAutoSubs({ lineup, starterSlots, statsOf }).lineup).toEqual(lineup);
  });

  it('does not mutate the lineup it was given', () => {
    const original = [...lineup];
    resolveAutoSubs({ lineup, starterSlots, subs: { rb1: 'benchRb' }, statsOf });
    expect(lineup).toEqual(original);
  });

  it('applies two independent subs in one week', () => {
    const two = ['qb1', 'rb1', 'rb2'];
    const s = { benchRb: { gp: 1 }, benchRb2: { gp: 1 }, qb1: { gp: 1 } };
    const r = resolveAutoSubs({
      lineup: two, starterSlots, subs: { rb1: 'benchRb', rb2: 'benchRb2' },
      statsOf: (id) => s[id] ?? null,
    });
    expect(r.lineup).toEqual(['qb1', 'benchRb', 'benchRb2']);
    expect(r.applied).toHaveLength(2);
  });
});
