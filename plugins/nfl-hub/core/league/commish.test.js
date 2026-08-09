import { describe, it, expect } from 'vitest';
import {
  COMMISH_ACTION, forceLineup, forceAdd, forceDrop, reverseTrade,
  editScore, setBudget, replaceManager, appendAudit, verifyAfterCommishAction,
} from './commish.js';
import { emptyRosters, addPlayer, ownerOf } from './rosters.js';
import { normalizeSettings } from './settings.js';

const T0 = 1_700_000_000_000;
const settings = normalizeSettings({ rosterPositions: ['QB', 'RB', 'BN'] });

const assets = () => {
  let r = emptyRosters(['t1', 't2']);
  r = addPlayer(r, 't1', 'a1').rosters;
  r = addPlayer(r, 't2', 'b1').rosters;
  return { rosters: r, budgets: { t1: 100, t2: 100 }, pickOwnership: [] };
};

describe('every action produces an audit entry', () => {
  // ⚠️ The audit comes back BESIDE the new state so a caller cannot apply the
  // change while forgetting to record it. An unlogged force-set lineup is
  // indistinguishable from cheating.
  it('audits a forced lineup, with the previous value', () => {
    const first = forceLineup({
      lineups: {}, teamId: 't1', week: 3, season: 2026, lineup: ['a1'], actorId: 'u1', at: T0,
    });
    expect(first.audit.action).toBe(COMMISH_ACTION.FORCE_LINEUP);
    expect(first.audit.detail.previous).toBe(null);

    const second = forceLineup({
      lineups: first.lineups, teamId: 't1', week: 3, season: 2026,
      lineup: ['a2'], actorId: 'u1', at: T0, reason: 'manager absent',
    });
    expect(second.audit.detail.previous).toEqual(['a1']);
    expect(second.audit.detail.reason).toBe('manager absent');
  });

  it('audits a forced add and drop', () => {
    const added = forceAdd({ assets: assets(), teamId: 't1', playerId: 'free', actorId: 'u1', at: T0 });
    expect(added.ok).toBe(true);
    expect(added.audit.action).toBe(COMMISH_ACTION.FORCE_ADD);
    expect(ownerOf(added.assets.rosters, 'free')).toBe('t1');

    const dropped = forceDrop({ assets: added.assets, teamId: 't1', playerId: 'free', actorId: 'u1', at: T0 });
    expect(dropped.audit.action).toBe(COMMISH_ACTION.FORCE_DROP);
    expect(ownerOf(dropped.assets.rosters, 'free')).toBe(null);
  });

  it('records the actor on every entry', () => {
    const out = setBudget({ assets: assets(), teamId: 't1', amount: 50, actorId: 'commish-9', at: T0 });
    expect(out.audit.actorId).toBe('commish-9');
    expect(out.audit.at).toBe(T0);
  });
});

describe('forceAdd / forceDrop still respect ownership', () => {
  // Commissioner tools bypass waivers and limits, not the core invariant.
  it('refuses to add a player another team owns', () => {
    const out = forceAdd({ assets: assets(), teamId: 't1', playerId: 'b1', actorId: 'u1', at: T0 });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('already owned');
    expect(out.audit).toBe(null);
  });

  it('refuses to drop a player the team does not own', () => {
    const out = forceDrop({ assets: assets(), teamId: 't1', playerId: 'b1', actorId: 'u1', at: T0 });
    expect(out.ok).toBe(false);
  });
});

describe('editScore', () => {
  // ⚠️ A correction nobody can compare against the original is a rewrite.
  it('keeps the previous value in the audit entry', () => {
    const first = editScore({
      scores: {}, season: 2026, week: 5, teamId: 't1', points: 101.5, actorId: 'u1', at: T0,
    });
    expect(first.scores['2026:w5'].t1).toBe(101.5);
    expect(first.audit.detail.previous).toBe(null);

    const corrected = editScore({
      scores: first.scores, season: 2026, week: 5, teamId: 't1',
      points: 98, actorId: 'u1', at: T0, reason: 'stat correction',
    });
    expect(corrected.audit.detail).toMatchObject({ previous: 101.5, next: 98, reason: 'stat correction' });
  });

  it('does not disturb other teams or other weeks', () => {
    const a = editScore({ scores: {}, season: 2026, week: 5, teamId: 't1', points: 100, actorId: 'u1', at: T0 });
    const b = editScore({ scores: a.scores, season: 2026, week: 6, teamId: 't2', points: 90, actorId: 'u1', at: T0 });
    expect(b.scores['2026:w5'].t1).toBe(100);
    expect(b.scores['2026:w6'].t2).toBe(90);
  });
});

describe('setBudget', () => {
  it('sets the budget and records what it was', () => {
    const out = setBudget({ assets: assets(), teamId: 't1', amount: 42, actorId: 'u1', at: T0 });
    expect(out.assets.budgets.t1).toBe(42);
    expect(out.audit.detail.previous).toBe(100);
  });

  it('refuses a negative or non-numeric budget', () => {
    expect(setBudget({ assets: assets(), teamId: 't1', amount: -1, actorId: 'u1', at: T0 }).ok).toBe(false);
    expect(setBudget({ assets: assets(), teamId: 't1', amount: 'lots', actorId: 'u1', at: T0 }).ok).toBe(false);
  });
});

describe('replaceManager', () => {
  const teams = () => ({ t1: { ownerId: 'old', coOwners: ['co'] }, t2: { ownerId: 'other' } });

  it('changes the owner and clears co-owners', () => {
    const out = replaceManager({ teams: teams(), teamId: 't1', userId: 'new', actorId: 'u1', at: T0 });
    expect(out.teams.t1).toEqual({ ownerId: 'new', coOwners: [] });
    expect(out.audit.detail).toMatchObject({ previous: 'old', next: 'new' });
  });

  it('leaves other teams alone and refuses an unknown team', () => {
    const out = replaceManager({ teams: teams(), teamId: 't1', userId: 'new', actorId: 'u1', at: T0 });
    expect(out.teams.t2.ownerId).toBe('other');
    expect(replaceManager({ teams: teams(), teamId: 'ghost', userId: 'x', actorId: 'u1', at: T0 }).ok).toBe(false);
  });
});

describe('reverseTrade', () => {
  const executed = {
    id: 'tr1',
    legs: [{ from: 't1', to: 't2', playerId: 'a1' }, { from: 't2', to: 't1', playerId: 'b1' }],
    faab: [],
  };

  const afterTrade = () => {
    const a = assets();
    // Apply the trade by hand so the fixture reflects a real post-trade state.
    a.rosters = { t1: { players: ['b1'], ir: [], taxi: [] }, t2: { players: ['a1'], ir: [], taxi: [] } };
    return a;
  };

  it('puts both players back where they started', () => {
    const out = reverseTrade({ assets: afterTrade(), trade: executed, actorId: 'u1', at: T0 });
    expect(out.ok).toBe(true);
    expect(ownerOf(out.assets.rosters, 'a1')).toBe('t1');
    expect(ownerOf(out.assets.rosters, 'b1')).toBe('t2');
    expect(out.audit.action).toBe(COMMISH_ACTION.REVERSE_TRADE);
  });

  it('returns transferred FAAB', () => {
    const trade = { ...executed, faab: [{ from: 't1', to: 't2', amount: 30 }] };
    const a = afterTrade();
    a.budgets = { t1: 70, t2: 130 };
    const out = reverseTrade({ assets: a, trade, actorId: 'u1', at: T0 });
    expect(out.assets.budgets).toEqual({ t1: 100, t2: 100 });
  });

  // ⚠️ Reconstructing the original position would mean taking a player from
  // whoever holds him now — a second trade the commissioner did not authorise.
  it('refuses when a traded player has moved on since', () => {
    const a = afterTrade();
    a.rosters.t2.players = []; // a1 was dropped after the trade
    const out = reverseTrade({ assets: a, trade: executed, actorId: 'u1', at: T0 });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('no longer on team');
  });

  it('refuses when the received FAAB has already been spent', () => {
    const trade = { ...executed, faab: [{ from: 't1', to: 't2', amount: 30 }] };
    const a = afterTrade();
    a.budgets = { t1: 70, t2: 5 };
    const out = reverseTrade({ assets: a, trade, actorId: 'u1', at: T0 });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('already spent');
  });

  it('changes nothing at all when it refuses', () => {
    const before = afterTrade();
    before.rosters.t2.players = [];
    const snapshot = JSON.parse(JSON.stringify(before));
    reverseTrade({ assets: before, trade: executed, actorId: 'u1', at: T0 });
    expect(before).toEqual(snapshot);
  });
});

describe('appendAudit', () => {
  it('appends newest last and never mutates the log', () => {
    const a = appendAudit([], { action: 'x' });
    const b = appendAudit(a, { action: 'y' });
    expect(b.map((e) => e.action)).toEqual(['x', 'y']);
    expect(a).toHaveLength(1);
  });

  it('is a no-op for a null audit, so a refused action logs nothing', () => {
    expect(appendAudit([{ action: 'x' }], null)).toEqual([{ action: 'x' }]);
  });
});

describe('verifyAfterCommishAction', () => {
  // Commissioner tools may break a roster LIMIT; they must never break the
  // one-player-one-team invariant.
  it('treats duplicate ownership as fatal', () => {
    const a = assets();
    a.rosters.t2.players.push('a1');
    const out = verifyAfterCommishAction(a, settings);
    expect(out.valid).toBe(false);
    expect(out.fatal[0]).toContain('owned by both');
  });

  it('treats an over-limit roster as a warning, not a failure', () => {
    const a = assets();
    a.rosters.t1.players.push('x1', 'x2', 'x3', 'x4');
    const out = verifyAfterCommishAction(a, settings);
    expect(out.valid).toBe(true);
    expect(out.warnings.some((w) => w.includes('roster spots'))).toBe(true);
  });

  it('passes a clean league', () => {
    expect(verifyAfterCommishAction(assets(), settings)).toEqual({ valid: true, fatal: [], warnings: [] });
  });
});
