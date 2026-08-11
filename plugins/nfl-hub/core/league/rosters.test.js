import { describe, it, expect } from 'vitest';
import {
  emptyRoster, emptyRosters, allPlayers, ownerOf,
  addPlayer, dropPlayer, moveCompartment, executeTrade,
  validateRosters, rosterCapacity,
  positionCounts, overPositionLimit, mayAddAtPosition,
} from './rosters.js';
import { normalizeSettings, FORMAT } from './settings.js';

const teams = () => emptyRosters(['t1', 't2', 't3']);

describe('emptyRosters', () => {
  it('gives every team three empty compartments', () => {
    const r = teams();
    expect(Object.keys(r)).toEqual(['t1', 't2', 't3']);
    expect(r.t1).toEqual({ players: [], ir: [], taxi: [] });
  });

  it('does not share array references between teams', () => {
    const r = teams();
    r.t1.players.push('p1');
    expect(r.t2.players).toEqual([]);
  });
});

describe('ownerOf', () => {
  it('finds a player in any compartment', () => {
    const r = teams();
    r.t2.players.push('p1');
    r.t3.ir.push('p2');
    r.t1.taxi.push('p3');
    expect(ownerOf(r, 'p1')).toBe('t2');
    expect(ownerOf(r, 'p2')).toBe('t3');
    expect(ownerOf(r, 'p3')).toBe('t1');
    expect(ownerOf(r, 'nobody')).toBe(null);
  });

  it('compares ids as strings, so 4046 and "4046" are one player', () => {
    const r = teams();
    r.t1.players.push(4046);
    expect(ownerOf(r, '4046')).toBe('t1');
  });
});

describe('addPlayer', () => {
  it('adds a free agent and does not mutate the input', () => {
    const before = teams();
    const r = addPlayer(before, 't1', 'p1');
    expect(r.ok).toBe(true);
    expect(r.rosters.t1.players).toEqual(['p1']);
    expect(before.t1.players).toEqual([]);
  });

  // ⚠️ THE INVARIANT THIS WHOLE MODULE EXISTS FOR.
  it('refuses a player already owned by ANOTHER team', () => {
    const r1 = addPlayer(teams(), 't1', 'p1');
    const r2 = addPlayer(r1.rosters, 't2', 'p1');
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('already owned by team t1');
    expect(r2.rosters.t2.players).toEqual([]);
  });

  it('refuses a player already owned by the SAME team', () => {
    const r1 = addPlayer(teams(), 't1', 'p1');
    expect(addPlayer(r1.rosters, 't1', 'p1').ok).toBe(false);
  });

  it('checks ownership across compartments, not just the active roster', () => {
    const r1 = addPlayer(teams(), 't1', 'p1', { compartment: 'ir' });
    const r2 = addPlayer(r1.rosters, 't2', 'p1');
    expect(r2.ok).toBe(false);
  });

  it('refuses an unknown team or compartment as a result, not a throw', () => {
    expect(addPlayer(teams(), 'ghost', 'p1').ok).toBe(false);
    expect(addPlayer(teams(), 't1', 'p1', { compartment: 'starters' }).ok).toBe(false);
  });
});

describe('dropPlayer', () => {
  it('removes from whichever compartment holds the player', () => {
    const r1 = addPlayer(teams(), 't1', 'p1', { compartment: 'taxi' });
    const r2 = dropPlayer(r1.rosters, 't1', 'p1');
    expect(r2.ok).toBe(true);
    expect(allPlayers(r2.rosters.t1)).toEqual([]);
    expect(ownerOf(r2.rosters, 'p1')).toBe(null);
  });

  it('refuses to drop a player the team does not own', () => {
    const r1 = addPlayer(teams(), 't1', 'p1');
    const r2 = dropPlayer(r1.rosters, 't2', 'p1');
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('does not own');
  });

  it('leaves the player available to another team afterwards', () => {
    const r1 = addPlayer(teams(), 't1', 'p1');
    const r2 = dropPlayer(r1.rosters, 't1', 'p1');
    expect(addPlayer(r2.rosters, 't2', 'p1').ok).toBe(true);
  });
});

describe('moveCompartment', () => {
  it('moves a player without changing owner, and never duplicates', () => {
    const r1 = addPlayer(teams(), 't1', 'p1');
    const r2 = moveCompartment(r1.rosters, 't1', 'p1', 'ir');
    expect(r2.ok).toBe(true);
    expect(r2.rosters.t1.players).toEqual([]);
    expect(r2.rosters.t1.ir).toEqual(['p1']);
    expect(allPlayers(r2.rosters.t1)).toEqual(['p1']);
  });

  it('refuses for a player the team does not own', () => {
    expect(moveCompartment(teams(), 't1', 'p1', 'ir').ok).toBe(false);
  });
});

describe('executeTrade', () => {
  const seeded = () => {
    let r = teams();
    r = addPlayer(r, 't1', 'a1').rosters;
    r = addPlayer(r, 't1', 'a2').rosters;
    r = addPlayer(r, 't2', 'b1').rosters;
    return r;
  };

  it('swaps players between two teams in one operation', () => {
    const r = executeTrade(seeded(), [
      { from: 't1', to: 't2', playerId: 'a1' },
      { from: 't2', to: 't1', playerId: 'b1' },
    ]);
    expect(r.ok).toBe(true);
    expect(ownerOf(r.rosters, 'a1')).toBe('t2');
    expect(ownerOf(r.rosters, 'b1')).toBe('t1');
    expect(validateRosters(r.rosters).valid).toBe(true);
  });

  it('supports a three-team trade', () => {
    let r = seeded();
    r = addPlayer(r, 't3', 'c1').rosters;
    const out = executeTrade(r, [
      { from: 't1', to: 't2', playerId: 'a1' },
      { from: 't2', to: 't3', playerId: 'b1' },
      { from: 't3', to: 't1', playerId: 'c1' },
    ]);
    expect(out.ok).toBe(true);
    expect(ownerOf(out.rosters, 'a1')).toBe('t2');
    expect(ownerOf(out.rosters, 'b1')).toBe('t3');
    expect(ownerOf(out.rosters, 'c1')).toBe('t1');
  });

  // ⚠️ ALL OR NOTHING. A half-applied trade is how a player ends up owned by
  // nobody, and it cannot be undone without a commissioner.
  it('applies nothing at all when any leg is invalid', () => {
    const before = seeded();
    const r = executeTrade(before, [
      { from: 't1', to: 't2', playerId: 'a1' },
      { from: 't2', to: 't1', playerId: 'not-owned-by-t2' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.rosters).toEqual(before);
    expect(ownerOf(r.rosters, 'a1')).toBe('t1');
  });

  // ⚠️ Validating incrementally would let leg 2 see leg 1's move and accept a
  // trade that was never legal as a whole.
  it('validates every leg against the ORIGINAL rosters', () => {
    const r = executeTrade(seeded(), [
      { from: 't1', to: 't2', playerId: 'a1' },
      // a1 is now "on" t2 mid-application, but this leg was never legal.
      { from: 't2', to: 't3', playerId: 'a1' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('two legs');
  });

  it('preserves the compartment a traded player sat in', () => {
    let r = teams();
    r = addPlayer(r, 't1', 'inj', { compartment: 'ir' }).rosters;
    const out = executeTrade(r, [{ from: 't1', to: 't2', playerId: 'inj' }]);
    expect(out.ok).toBe(true);
    expect(out.rosters.t2.ir).toEqual(['inj']);
    expect(out.rosters.t2.players).toEqual([]);
  });

  it('refuses trades to oneself, empty trades and unknown teams', () => {
    expect(executeTrade(seeded(), []).ok).toBe(false);
    expect(executeTrade(seeded(), [{ from: 't1', to: 't1', playerId: 'a1' }]).ok).toBe(false);
    expect(executeTrade(seeded(), [{ from: 't1', to: 'ghost', playerId: 'a1' }]).ok).toBe(false);
  });
});

describe('validateRosters', () => {
  it('accepts a clean structure', () => {
    const r = addPlayer(teams(), 't1', 'p1').rosters;
    expect(validateRosters(r)).toEqual({ valid: true, errors: [] });
  });

  // The corruption every other guard exists to prevent — caught even if it
  // arrives from outside these functions, e.g. a hand-edited storage value.
  it('detects the same player on two rosters', () => {
    const r = teams();
    r.t1.players.push('p1');
    r.t2.players.push('p1');
    const out = validateRosters(r);
    expect(out.valid).toBe(false);
    expect(out.errors[0]).toContain('owned by both t1 and t2');
  });

  it('detects the same player twice on ONE roster', () => {
    const r = teams();
    r.t1.players.push('p1');
    r.t1.ir.push('p1');
    expect(validateRosters(r).valid).toBe(false);
  });

  it('enforces roster, IR and taxi limits against the settings', () => {
    const settings = normalizeSettings({
      format: FORMAT.DYNASTY, rosterPositions: ['QB', 'BN'], irSlots: 1, taxiSlots: 1,
    });
    const r = teams();
    r.t1.players.push('p1', 'p2', 'p3');
    r.t1.ir.push('i1', 'i2');
    const out = validateRosters(r, settings);
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.includes('over the 2 roster spots'))).toBe(true);
    expect(out.errors.some((e) => e.includes('over the 1 slots'))).toBe(true);
  });

  // ⚠️ Not counting IR and taxi against the roster IS the point of those
  // compartments; counting them would make a legal roster look illegal.
  it('does not count IR or taxi against the roster capacity', () => {
    const settings = normalizeSettings({
      format: FORMAT.DYNASTY, rosterPositions: ['QB', 'BN', 'IR', 'TAXI'], irSlots: 1, taxiSlots: 1,
    });
    expect(rosterCapacity(settings)).toBe(2);
    const r = teams();
    r.t1.players.push('p1', 'p2');
    r.t1.ir.push('i1');
    r.t1.taxi.push('x1');
    expect(validateRosters(r, settings).valid).toBe(true);
  });
});

describe('a sequence of real operations keeps the invariant', () => {
  it('survives adds, drops, IR moves and a trade', () => {
    let r = emptyRosters(['t1', 't2']);
    for (const p of ['p1', 'p2', 'p3']) r = addPlayer(r, 't1', p).rosters;
    for (const p of ['q1', 'q2']) r = addPlayer(r, 't2', p).rosters;

    r = moveCompartment(r, 't1', 'p3', 'ir').rosters;
    r = dropPlayer(r, 't2', 'q2').rosters;
    r = addPlayer(r, 't1', 'q2').rosters;
    r = executeTrade(r, [
      { from: 't1', to: 't2', playerId: 'p1' },
      { from: 't2', to: 't1', playerId: 'q1' },
    ]).rosters;

    expect(validateRosters(r).valid).toBe(true);
    expect(ownerOf(r, 'p1')).toBe('t2');
    expect(ownerOf(r, 'q1')).toBe('t1');
    expect(ownerOf(r, 'q2')).toBe('t1');
    expect(r.t1.ir).toEqual(['p3']);
    // Every player is owned exactly once.
    const all = [...allPlayers(r.t1), ...allPlayers(r.t2)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('positional limits', () => {
  const positionOf = (id) => ({
    q1: 'QB', q2: 'QB', q3: 'QB', r1: 'RB', r2: 'RB',
  }[id] ?? null);

  it('counts only ACTIVE players — IR and taxi are exempt', () => {
    const roster = { players: ['q1', 'q2'], ir: ['q3'], taxi: ['r1'] };
    expect(positionCounts(roster, positionOf)).toEqual({ QB: 2 });
  });

  it('reports nothing over when there are no limits', () => {
    const roster = { players: ['q1', 'q2', 'q3'], ir: [], taxi: [] };
    expect(overPositionLimit(roster, {}, positionOf)).toEqual([]);
  });

  it('reports the position that is over', () => {
    const roster = { players: ['q1', 'q2', 'q3'], ir: [], taxi: [] };
    const out = overPositionLimit(roster, { positionLimits: { QB: 2 } }, positionOf);
    expect(out).toEqual([{ position: 'QB', have: 3, max: 2 }]);
  });

  // ⚠️ IR is the whole reason that compartment exists — an injured QB must not
  // count against the limit, or a league with a QB cap cannot use IR at all.
  it('does not count an IR player against the limit', () => {
    const roster = { players: ['q1', 'q2'], ir: ['q3'], taxi: [] };
    expect(overPositionLimit(roster, { positionLimits: { QB: 2 } }, positionOf)).toEqual([]);
  });

  it('allows an add that stays inside the limit', () => {
    const roster = { players: ['q1'], ir: [], taxi: [] };
    expect(mayAddAtPosition(roster, 'q2', { positionLimits: { QB: 2 } }, positionOf).ok).toBe(true);
  });

  it('refuses an add that would breach the limit', () => {
    const roster = { players: ['q1', 'q2'], ir: [], taxi: [] };
    const res = mayAddAtPosition(roster, 'q3', { positionLimits: { QB: 2 } }, positionOf);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at most 2 QB/i);
  });

  it('allows any add when the position has no limit', () => {
    const roster = { players: ['r1', 'r2'], ir: [], taxi: [] };
    expect(mayAddAtPosition(roster, 'q1', { positionLimits: { QB: 2 } }, positionOf).ok).toBe(true);
  });

  it('allows an add for an unknown position rather than guessing', () => {
    const roster = { players: [], ir: [], taxi: [] };
    expect(mayAddAtPosition(roster, 'mystery', { positionLimits: { QB: 1 } }, positionOf).ok).toBe(true);
  });

  it('is empty-safe', () => {
    expect(positionCounts(null, positionOf)).toEqual({});
    expect(overPositionLimit(null, { positionLimits: { QB: 1 } }, positionOf)).toEqual([]);
  });
});
