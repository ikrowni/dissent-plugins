import { describe, it, expect } from 'vitest';
import {
  TRADE_STATUS, proposeTrade, tradeParties, acceptTrade, rejectTrade, cancelTrade,
  vetoTrade, commissionerResolve, resolveDueTrades, applyTrade, tradingIsOpen, vetoProgress,
} from './trades.js';
import { normalizeSettings } from './settings.js';
import { emptyRosters, addPlayer, ownerOf } from './rosters.js';

const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const settings = normalizeSettings({ tradeReviewDays: 2, vetoVotesNeeded: 3, tradeDeadlineWeek: 12 });

const legs = [
  { from: 't1', to: 't2', playerId: 'a1' },
  { from: 't2', to: 't1', playerId: 'b1' },
];

const seededAssets = () => {
  let r = emptyRosters(['t1', 't2', 't3', 't4', 't5']);
  r = addPlayer(r, 't1', 'a1').rosters;
  r = addPlayer(r, 't2', 'b1').rosters;
  return { rosters: r, budgets: { t1: 100, t2: 100 }, pickOwnership: [] };
};

const proposed = (over = {}) => proposeTrade({
  id: 'tr1', proposedBy: 't1', legs, now: T0, ...over,
}).trade;

describe('proposeTrade', () => {
  it('records the parties and counts the proposal as an acceptance', () => {
    const t = proposed();
    expect(t.status).toBe(TRADE_STATUS.PROPOSED);
    expect(t.parties.sort()).toEqual(['t1', 't2']);
    expect(t.acceptances).toEqual({ t1: T0 });
  });

  it('refuses a trade that moves nothing', () => {
    expect(proposeTrade({ id: 'x', proposedBy: 't1', now: T0 }).ok).toBe(false);
  });

  it('refuses a proposer who is not a party', () => {
    expect(proposeTrade({ id: 'x', proposedBy: 't9', legs, now: T0 }).ok).toBe(false);
  });

  it('finds parties across players, picks and FAAB', () => {
    expect(tradeParties({
      legs: [{ from: 'a', to: 'b', playerId: 'p' }],
      picks: [{ round: 2, slot: 'c', to: 'a' }],
      faab: [{ from: 'd', to: 'b', amount: 5 }],
    }).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('supports a trade of picks only', () => {
    const r = proposeTrade({
      id: 'x', proposedBy: 't1', picks: [{ round: 2, slot: 't1', to: 't2' }], now: T0,
    });
    expect(r.ok).toBe(true);
  });
});

describe('acceptance', () => {
  it('moves to review once every party has accepted', () => {
    const t = acceptTrade(proposed(), 't2', T0, settings).trade;
    expect(t.status).toBe(TRADE_STATUS.REVIEW);
    expect(t.reviewEndsAt).toBe(T0 + 2 * DAY);
  });

  // ⚠️ A three-team trade with two acceptances is not two-thirds live.
  it('stays proposed until the LAST party accepts', () => {
    const three = proposeTrade({
      id: 'x', proposedBy: 't1', now: T0,
      legs: [
        { from: 't1', to: 't2', playerId: 'a1' },
        { from: 't2', to: 't3', playerId: 'b1' },
        { from: 't3', to: 't1', playerId: 'c1' },
      ],
    }).trade;
    const afterOne = acceptTrade(three, 't2', T0, settings).trade;
    expect(afterOne.status).toBe(TRADE_STATUS.PROPOSED);
    const afterTwo = acceptTrade(afterOne, 't3', T0, settings).trade;
    expect(afterTwo.status).toBe(TRADE_STATUS.REVIEW);
  });

  // A league with no review period is a common setting — it must not mean
  // "review forever".
  it('sets a review that ends immediately when the league has no review period', () => {
    const none = normalizeSettings({ tradeReviewDays: 0 });
    const t = acceptTrade(proposed(), 't2', T0, none).trade;
    expect(t.reviewEndsAt).toBe(T0);
    expect(resolveDueTrades([t], T0).ready).toHaveLength(1);
  });

  it('refuses acceptance from a non-party or in the wrong state', () => {
    expect(acceptTrade(proposed(), 't9', T0, settings).ok).toBe(false);
    const inReview = acceptTrade(proposed(), 't2', T0, settings).trade;
    expect(acceptTrade(inReview, 't2', T0, settings).ok).toBe(false);
  });
});

describe('reject and cancel', () => {
  it('lets a party reject', () => {
    expect(rejectTrade(proposed(), 't2', T0).trade.status).toBe(TRADE_STATUS.REJECTED);
  });

  it('lets only the proposer cancel', () => {
    expect(cancelTrade(proposed(), 't1', T0).trade.status).toBe(TRADE_STATUS.CANCELLED);
    expect(cancelTrade(proposed(), 't2', T0).ok).toBe(false);
  });

  it('cannot cancel once review has started', () => {
    const inReview = acceptTrade(proposed(), 't2', T0, settings).trade;
    expect(cancelTrade(inReview, 't1', T0).ok).toBe(false);
  });
});

describe('veto', () => {
  const inReview = () => acceptTrade(proposed(), 't2', T0, settings).trade;

  it('vetoes once the threshold is reached', () => {
    let t = inReview();
    t = vetoTrade(t, 't3', T0, settings).trade;
    t = vetoTrade(t, 't4', T0, settings).trade;
    expect(t.status).toBe(TRADE_STATUS.REVIEW);
    t = vetoTrade(t, 't5', T0, settings).trade;
    expect(t.status).toBe(TRADE_STATUS.VETOED);
  });

  // ⚠️ Otherwise a party accepts, then vetoes, using the review period as a free
  // option on its own agreement.
  it('refuses a veto from a party to the trade', () => {
    const r = vetoTrade(inReview(), 't1', T0, settings);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('cannot veto');
  });

  it('counts one veto per team however often they vote', () => {
    let t = inReview();
    t = vetoTrade(t, 't3', T0, settings).trade;
    t = vetoTrade(t, 't3', T0 + 1, settings).trade;
    expect(Object.keys(t.vetoes)).toEqual(['t3']);
    expect(t.status).toBe(TRADE_STATUS.REVIEW);
  });

  it('cannot veto a trade that is not in review', () => {
    expect(vetoTrade(proposed(), 't3', T0, settings).ok).toBe(false);
  });
});

describe('commissionerResolve', () => {
  it('can force a trade straight to review, bypassing the wait', () => {
    const t = commissionerResolve(proposed(), true, T0).trade;
    expect(t.status).toBe(TRADE_STATUS.REVIEW);
    expect(resolveDueTrades([t], T0).ready).toHaveLength(1);
  });

  it('can kill a trade outright', () => {
    expect(commissionerResolve(proposed(), false, T0).trade.status).toBe(TRADE_STATUS.VETOED);
  });

  it('cannot resolve an already-finished trade', () => {
    const dead = rejectTrade(proposed(), 't2', T0).trade;
    expect(commissionerResolve(dead, true, T0).ok).toBe(false);
  });
});

describe('resolveDueTrades', () => {
  it('reports a review that has run its course as ready', () => {
    const t = acceptTrade(proposed(), 't2', T0, settings).trade;
    expect(resolveDueTrades([t], T0 + DAY).ready).toHaveLength(0);
    expect(resolveDueTrades([t], T0 + 2 * DAY).ready).toHaveLength(1);
  });

  it('expires a proposal nobody answered', () => {
    const t = proposed({ expiresAt: T0 + DAY });
    const out = resolveDueTrades([t], T0 + 2 * DAY);
    expect(out.trades[0].status).toBe(TRADE_STATUS.EXPIRED);
    expect(out.trades[0].resolvedAt).toBe(T0 + DAY);
    expect(out.ready).toHaveLength(0);
  });

  it('leaves a proposal with no expiry alone forever', () => {
    expect(resolveDueTrades([proposed()], T0 + 400 * DAY).trades[0].status).toBe(TRADE_STATUS.PROPOSED);
  });
});

describe('applyTrade', () => {
  const ready = () => acceptTrade(proposed(), 't2', T0, settings).trade;

  it('moves the players and marks the trade executed', () => {
    const out = applyTrade(seededAssets(), ready());
    expect(out.ok).toBe(true);
    expect(ownerOf(out.assets.rosters, 'a1')).toBe('t2');
    expect(ownerOf(out.assets.rosters, 'b1')).toBe('t1');
    expect(out.trade.status).toBe(TRADE_STATUS.EXECUTED);
  });

  it('transfers FAAB', () => {
    const t = acceptTrade(
      proposeTrade({ id: 'x', proposedBy: 't1', legs, faab: [{ from: 't1', to: 't2', amount: 40 }], now: T0 }).trade,
      't2', T0, settings,
    ).trade;
    const out = applyTrade(seededAssets(), t);
    expect(out.assets.budgets).toEqual({ t1: 60, t2: 140 });
  });

  it('records traded picks in the shape applyTradedPicks expects', () => {
    const t = acceptTrade(
      proposeTrade({ id: 'x', proposedBy: 't1', picks: [{ round: 2, slot: 't1', to: 't2' }], now: T0 }).trade,
      't2', T0, settings,
    ).trade;
    const out = applyTrade(seededAssets(), t);
    expect(out.assets.pickOwnership).toEqual([{ round: 2, slot: 't1', to: 't2' }]);
  });

  // ⚠️ A trade that moved the players but not the $40 is not a smaller trade,
  // it is a wrong one.
  it('applies nothing at all when the FAAB leg cannot be paid', () => {
    const before = seededAssets();
    const t = acceptTrade(
      proposeTrade({ id: 'x', proposedBy: 't1', legs, faab: [{ from: 't1', to: 't2', amount: 500 }], now: T0 }).trade,
      't2', T0, settings,
    ).trade;
    const out = applyTrade(before, t);
    expect(out.ok).toBe(false);
    expect(ownerOf(out.assets.rosters, 'a1')).toBe('t1');
    expect(out.assets.budgets).toEqual({ t1: 100, t2: 100 });
  });

  it('applies nothing when a player leg is invalid', () => {
    const t = acceptTrade(
      proposeTrade({ id: 'x', proposedBy: 't1', legs: [{ from: 't1', to: 't2', playerId: 'not-owned' }], now: T0 }).trade,
      't2', T0, settings,
    ).trade;
    const out = applyTrade(seededAssets(), t);
    expect(out.ok).toBe(false);
  });

  it('refuses to apply a trade that is not in review', () => {
    expect(applyTrade(seededAssets(), proposed()).ok).toBe(false);
  });
});

describe('tradingIsOpen', () => {
  it('closes after the deadline week', () => {
    expect(tradingIsOpen(settings, 12)).toBe(true);
    expect(tradingIsOpen(settings, 13)).toBe(false);
  });

  it('respects a league that disabled trading entirely', () => {
    expect(tradingIsOpen(normalizeSettings({ tradesEnabled: false }), 1)).toBe(false);
  });
});

// 🔴 THE VOTE WAS FULLY IMPLEMENTED AND COMPLETELY INVISIBLE. `vetoTrade` has
// counted ballots since the engine shipped and the module has always routed
// them, but a trade in review showed the word "review" and a date — no tally,
// no threshold, no indication a vote was running at all. This is what the
// screen reads to say otherwise.
describe('vetoProgress', () => {
  const t = (over = {}) => ({ parties: ['t1', 't2'], vetoes: {}, ...over });

  it('counts ballots cast and how many remain', () => {
    const v = vetoProgress(t({ vetoes: { t3: 1, t4: 2 } }), { vetoVotesNeeded: 4 }, 8);
    expect(v.cast).toBe(2);
    expect(v.needed).toBe(4);
    expect(v.remaining).toBe(2);
    expect(v.voters).toEqual(['t3', 't4']);
  });

  // ⚠️ THE DENOMINATOR IS ELIGIBLE VOTERS, NOT TEAMS — a party cannot veto its
  // own trade, so "2 of 8" would describe a vote nobody is running.
  it('excludes the trading parties from the eligible count', () => {
    expect(vetoProgress(t(), { vetoVotesNeeded: 3 }, 8).eligible).toBe(6);
    expect(vetoProgress(t({ parties: ['t1', 't2', 't3'] }), { vetoVotesNeeded: 3 }, 8).eligible).toBe(5);
  });

  // ⚠️ THE SHIPPED DEFAULT IS UNANIMITY AT 8 TEAMS. 6 needed, 6 eligible — every
  // last team must vote to block, presented as an ordinary threshold.
  it('flags a threshold that means every eligible team', () => {
    expect(vetoProgress(t(), { vetoVotesNeeded: 6 }, 8).unanimous).toBe(true);
    expect(vetoProgress(t(), { vetoVotesNeeded: 5 }, 8).unanimous).toBe(false);
  });

  it('flags a threshold no league could ever reach', () => {
    expect(vetoProgress(t(), { vetoVotesNeeded: 7 }, 8).reachable).toBe(false);
    expect(vetoProgress(t(), { vetoVotesNeeded: 6 }, 8).reachable).toBe(true);
  });

  it('never reports a negative remainder once the threshold is passed', () => {
    const v = vetoProgress(t({ vetoes: { t3: 1, t4: 1, t5: 1 } }), { vetoVotesNeeded: 2 }, 8);
    expect(v.remaining).toBe(0);
  });

  // Degrades to "cannot say" rather than to a wrong number.
  it('reports null rather than guessing without a team count or a threshold', () => {
    expect(vetoProgress(t(), { vetoVotesNeeded: 3 }, undefined).eligible).toBe(null);
    expect(vetoProgress(t(), {}, 8).needed).toBe(null);
    expect(vetoProgress(t(), { vetoVotesNeeded: 0 }, 8).needed).toBe(null);
  });

  it('agrees with vetoTrade about who may vote', () => {
    const trade = { ...t(), status: TRADE_STATUS.REVIEW };
    // A party is refused by the engine…
    expect(vetoTrade(trade, 't1', 1, { vetoVotesNeeded: 3 }).ok).toBe(false);
    // …and is not counted among the eligible here.
    expect(vetoProgress(trade, { vetoVotesNeeded: 3 }, 8).eligible).toBe(6);
  });
});
