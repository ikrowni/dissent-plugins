import { describe, it, expect } from 'vitest';
import {
  rolloverSeason, keeperSlotsRemaining, taxiEligible, taxiGraduates, rookieDraftOrder,
} from './keepers.js';
import { normalizeSettings, FORMAT } from './settings.js';

const redraft = normalizeSettings({ format: FORMAT.REDRAFT });
const keeper = normalizeSettings({ format: FORMAT.KEEPER, maxKeepers: 2 });
const dynasty = normalizeSettings({ format: FORMAT.DYNASTY, taxiSlots: 3, taxiYears: 2, irSlots: 2 });

const rosters = () => ({
  t1: { players: ['a1', 'a2', 'a3'], ir: ['a4'], taxi: ['a5'] },
  t2: { players: ['b1', 'b2'], ir: [], taxi: [] },
});

describe('rolloverSeason — redraft', () => {
  it('returns everyone to the pool', () => {
    const out = rolloverSeason(rosters(), redraft);
    expect(out.rosters.t1).toEqual({ players: [], ir: [], taxi: [] });
    expect(out.released.sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2']);
  });

  it('ignores keeper elections entirely', () => {
    const out = rolloverSeason(rosters(), redraft, { t1: ['a1', 'a2'] });
    expect(out.rosters.t1.players).toEqual([]);
    expect(out.errors).toEqual([]);
  });
});

describe('rolloverSeason — keeper', () => {
  it('keeps the elected players and releases the rest', () => {
    const out = rolloverSeason(rosters(), keeper, { t1: ['a1', 'a3'] });
    expect(out.rosters.t1.players.sort()).toEqual(['a1', 'a3']);
    expect(out.released).toContain('a2');
    expect(out.rosters.t2.players).toEqual([]);
  });

  it('enforces maxKeepers and says which election was dropped', () => {
    const out = rolloverSeason(rosters(), keeper, { t1: ['a1', 'a2', 'a3'] });
    expect(out.rosters.t1.players).toHaveLength(2);
    expect(out.errors.some((e) => e.includes('more than 2 keepers'))).toBe(true);
  });

  // ⚠️ Reported, not thrown — one manager's bad election must not stop the whole
  // league starting its season.
  it('reports an election for a player the team does not own, and rolls the rest over anyway', () => {
    const out = rolloverSeason(rosters(), keeper, { t1: ['not-mine'], t2: ['b1'] });
    expect(out.errors[0]).toContain('does not own');
    expect(out.rosters.t2.players).toEqual(['b1']);
  });

  it('counts a duplicate election once', () => {
    const out = rolloverSeason(rosters(), keeper, { t1: ['a1', 'a1'] });
    expect(out.rosters.t1.players).toEqual(['a1']);
    expect(out.errors).toEqual([]);
  });

  it('can keep a player who was on IR', () => {
    const out = rolloverSeason(rosters(), keeper, { t1: ['a4'] });
    expect(out.rosters.t1.players).toEqual([]);
    // a4 was kept but IR clears at rollover, so he is not on the active list
    // either — the caller places him. What matters is he is not released.
    expect(out.released).not.toContain('a4');
  });

  it('clears IR at season roll', () => {
    const out = rolloverSeason(rosters(), keeper, { t1: ['a1'] });
    expect(out.rosters.t1.ir).toEqual([]);
  });
});

describe('rolloverSeason — dynasty', () => {
  // ⚠️ Treating dynasty as "keepers with a big limit" quietly drops everyone
  // parked off the active roster.
  it('keeps the WHOLE roster including IR, with no elections needed', () => {
    const out = rolloverSeason(rosters(), dynasty);
    expect(out.rosters.t1.players.sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(out.released).toEqual([]);
  });

  it('keeps the taxi squad on taxi, not on the active roster', () => {
    const out = rolloverSeason(rosters(), dynasty);
    expect(out.rosters.t1.taxi).toEqual(['a5']);
    expect(out.rosters.t1.players).not.toContain('a5');
  });

  it('ignores keeper elections — everyone is kept regardless', () => {
    const out = rolloverSeason(rosters(), dynasty, { t1: ['a1'] });
    expect(out.rosters.t1.players).toHaveLength(4);
    expect(out.errors).toEqual([]);
  });

  it('drops taxi in a keeper league, which has no taxi squad', () => {
    const out = rolloverSeason(rosters(), keeper, { t1: ['a1'] });
    expect(out.rosters.t1.taxi).toEqual([]);
  });
});

describe('keeperSlotsRemaining', () => {
  it('counts down from maxKeepers in a keeper league', () => {
    expect(keeperSlotsRemaining(keeper, [])).toBe(2);
    expect(keeperSlotsRemaining(keeper, ['a1'])).toBe(1);
    expect(keeperSlotsRemaining(keeper, ['a1', 'a2', 'a3'])).toBe(0);
  });

  it('is zero for redraft and unlimited for dynasty', () => {
    expect(keeperSlotsRemaining(redraft, [])).toBe(0);
    expect(keeperSlotsRemaining(dynasty, ['a1', 'a2', 'a3'])).toBe(Infinity);
  });
});

describe('taxiEligible', () => {
  const rookie = { rookieDraftedBy: 't1', draftedSeason: 2025 };

  it('allows a rookie inside the taxi window', () => {
    expect(taxiEligible(rookie, dynasty, 2026)).toBe(true);
  });

  // ⚠️ Otherwise a manager stashes a starter off the roster cap indefinitely.
  it('graduates a player once taxiYears has elapsed', () => {
    expect(taxiEligible(rookie, dynasty, 2027)).toBe(false);
  });

  it('refuses a veteran unless the league allows them', () => {
    const vet = { rookieDraftedBy: null, draftedSeason: 2025 };
    expect(taxiEligible(vet, dynasty, 2026)).toBe(false);
    expect(taxiEligible(vet, { ...dynasty, taxiAllowVets: true }, 2026)).toBe(true);
  });

  it('is false in any format but dynasty, and with no taxi slots', () => {
    expect(taxiEligible(rookie, keeper, 2026)).toBe(false);
    expect(taxiEligible(rookie, { ...dynasty, taxiSlots: 0 }, 2026)).toBe(false);
  });

  it('handles missing player data without throwing', () => {
    expect(taxiEligible(null, dynasty, 2026)).toBe(false);
    expect(taxiEligible({ rookieDraftedBy: 't1' }, dynasty, 2026)).toBe(false);
  });
});

describe('taxiGraduates', () => {
  const players = {
    young: { rookieDraftedBy: 't1', draftedSeason: 2026 },
    old: { rookieDraftedBy: 't1', draftedSeason: 2024 },
  };

  it('names only the players who must leave taxi', () => {
    const roster = { players: [], ir: [], taxi: ['young', 'old'] };
    expect(taxiGraduates(roster, dynasty, 2026, (id) => players[id])).toEqual(['old']);
  });

  it('returns names rather than moving anyone', () => {
    const roster = { players: [], ir: [], taxi: ['old'] };
    taxiGraduates(roster, dynasty, 2026, (id) => players[id]);
    expect(roster.taxi).toEqual(['old']);
  });
});

describe('rookieDraftOrder', () => {
  it('gives the worst record the first pick', () => {
    const order = rookieDraftOrder([
      { teamId: 'good', wins: 11, pointsFor: 1600 },
      { teamId: 'bad', wins: 3, pointsFor: 1000 },
      { teamId: 'mid', wins: 7, pointsFor: 1300 },
    ]);
    expect(order).toEqual(['bad', 'mid', 'good']);
  });

  it('is deterministic for completely tied teams', () => {
    const tied = [{ teamId: 'z', wins: 5, pointsFor: 900 }, { teamId: 'a', wins: 5, pointsFor: 900 }];
    expect(rookieDraftOrder(tied)).toEqual(['a', 'z']);
    expect(rookieDraftOrder([...tied].reverse())).toEqual(['a', 'z']);
  });
});
