// core/league/trades.js — the trade state machine.
//
// PURE. `now` is always an argument; nothing here reads a clock.
//
// ⚠️ A TRADE MOVES THREE KINDS OF ASSET: players, FAAB budget and draft picks.
// All three must move together or none of them do — a trade that transferred the
// players but not the $40 is not a smaller trade, it is a wrong one. Since
// compare-and-swap is per-key, that means all three live in ONE storage value:
//
//     assets = { rosters, budgets, pickOwnership }
//
// This is the same conclusion the draft reached from the other direction, and it
// is the real reason the "single key" decision in the design is about ASSETS
// rather than about rosters specifically.
//
// Review and expiry use the same deadline-on-read approach as the draft clock:
// nothing fires on a timer, and whoever next reads the league resolves whatever
// has come due, with the 5-minute scheduler as a backstop.

import { executeTrade } from './rosters.js';

export const TRADE_STATUS = Object.freeze({
  PROPOSED: 'proposed',   // waiting on the other parties
  REVIEW: 'review',       // all accepted; the league may veto
  EXECUTED: 'executed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled', // withdrawn by the proposer
  VETOED: 'vetoed',
  EXPIRED: 'expired',     // nobody responded
});

const fail = (trade, error) => ({ ok: false, trade, error });
const done = (trade) => ({ ok: true, trade, error: null });

/**
 * Propose a trade.
 *
 * `legs` are player moves, `picks` are draft picks addressed by round+slot, and
 * `faab` are budget transfers. All three are optional, but a trade with none of
 * them is not a trade.
 */
export function proposeTrade({
  id, proposedBy, legs = [], picks = [], faab = [], now, expiresAt = null,
}) {
  const parties = tradeParties({ legs, picks, faab });
  if (legs.length + picks.length + faab.length === 0) {
    return fail(null, 'a trade must move at least one asset');
  }
  if (!parties.includes(String(proposedBy))) {
    return fail(null, 'the proposer must be a party to the trade');
  }
  if (parties.length < 2) return fail(null, 'a trade needs at least two teams');

  return done({
    id,
    proposedBy: String(proposedBy),
    parties,
    legs, picks, faab,
    status: TRADE_STATUS.PROPOSED,
    proposedAt: now,
    expiresAt,
    acceptances: { [String(proposedBy)]: now }, // proposing IS accepting
    vetoes: {},
    reviewEndsAt: null,
    resolvedAt: null,
  });
}

/** Every team touched by any asset in the trade. */
export function tradeParties({ legs = [], picks = [], faab = [] }) {
  const set = new Set();
  for (const l of legs) { set.add(String(l.from)); set.add(String(l.to)); }
  for (const p of picks) { set.add(String(p.slot)); set.add(String(p.to)); }
  for (const f of faab) { set.add(String(f.from)); set.add(String(f.to)); }
  return [...set];
}

/**
 * Accept, on behalf of one party.
 *
 * ⚠️ Review starts only when EVERY party has accepted. A three-team trade where
 * two agree is not two-thirds live; it is not live at all.
 */
export function acceptTrade(trade, teamId, now, settings) {
  const team = String(teamId);
  if (trade.status !== TRADE_STATUS.PROPOSED) return fail(trade, `trade is ${trade.status}`);
  if (!trade.parties.includes(team)) return fail(trade, `team ${team} is not a party to this trade`);

  const acceptances = { ...trade.acceptances, [team]: now };
  const allIn = trade.parties.every((p) => acceptances[p] !== undefined);
  if (!allIn) return done({ ...trade, acceptances });

  const reviewDays = settings?.tradeReviewDays ?? 0;
  // A league with no review period executes immediately, which is a legitimate
  // and common setting — it must not mean "review forever".
  return done({
    ...trade,
    acceptances,
    status: TRADE_STATUS.REVIEW,
    reviewEndsAt: now + reviewDays * 24 * 60 * 60 * 1000,
  });
}

/** Decline, by any party other than the proposer. */
export function rejectTrade(trade, teamId, now) {
  const team = String(teamId);
  if (trade.status !== TRADE_STATUS.PROPOSED) return fail(trade, `trade is ${trade.status}`);
  if (!trade.parties.includes(team)) return fail(trade, `team ${team} is not a party to this trade`);
  return done({ ...trade, status: TRADE_STATUS.REJECTED, resolvedAt: now });
}

/** Withdraw, by the proposer, while it is still only proposed. */
export function cancelTrade(trade, teamId, now) {
  if (String(teamId) !== trade.proposedBy) return fail(trade, 'only the proposer may cancel');
  if (trade.status !== TRADE_STATUS.PROPOSED) return fail(trade, `trade is ${trade.status}`);
  return done({ ...trade, status: TRADE_STATUS.CANCELLED, resolvedAt: now });
}

/**
 * Vote to veto, during the review period.
 *
 * ⚠️ A PARTY TO THE TRADE MAY NOT VETO IT. Otherwise one side accepts, then
 * vetoes, and uses the review period as a free option on its own agreement.
 */
export function vetoTrade(trade, teamId, now, settings) {
  const team = String(teamId);
  if (trade.status !== TRADE_STATUS.REVIEW) return fail(trade, `trade is ${trade.status}`);
  if (trade.parties.includes(team)) return fail(trade, 'a party to the trade cannot veto it');

  const vetoes = { ...trade.vetoes, [team]: now };
  const needed = settings?.vetoVotesNeeded ?? Infinity;
  if (Object.keys(vetoes).length >= needed) {
    return done({ ...trade, vetoes, status: TRADE_STATUS.VETOED, resolvedAt: now });
  }
  return done({ ...trade, vetoes });
}

/**
 * Where a trade's veto vote stands.
 *
 * PURE, and it lives beside `vetoTrade` ON PURPOSE: the eligibility rule — a
 * party to the trade cannot veto it — is enforced there and displayed from
 * here, and two copies of that rule would drift into a screen that offers a
 * vote the module refuses.
 *
 * ⚠️ THE DENOMINATOR IS ELIGIBLE VOTERS, NOT TEAMS. A veto needs
 * `vetoVotesNeeded` votes but only non-parties may cast one, so in an 8-team
 * league a two-party trade has 6 possible voters. Reporting "2 of 8" would
 * describe a vote nobody is running.
 *
 * ⚠️ `reachable` IS THE POINT OF THIS FUNCTION. The shipped default is 6, which
 * in an 8-team league means EVERY eligible team must vote to block a trade —
 * unanimity, presented as an ordinary threshold. It is not a bug in the count;
 * it is a league setting nobody could see. A screen that shows "0 of 6" without
 * saying that 6 IS everybody has told the reader nothing.
 */
export function vetoProgress(trade, settings, teamCount) {
  const parties = (trade?.parties ?? []).map(String);
  const voters = Object.keys(trade?.vetoes ?? {}).map(String);
  const total = Number(teamCount);
  // Unknown team count degrades to "cannot say" rather than to a wrong number.
  const eligible = Number.isFinite(total) ? Math.max(0, total - parties.length) : null;
  const rawNeeded = Number(settings?.vetoVotesNeeded);
  const needed = Number.isFinite(rawNeeded) && rawNeeded > 0 ? rawNeeded : null;

  return {
    cast: voters.length,
    voters,
    needed,
    eligible,
    remaining: needed === null ? null : Math.max(0, needed - voters.length),
    // Enough eligible teams exist to reach the threshold at all.
    reachable: needed === null || eligible === null ? null : needed <= eligible,
    // …and it takes every last one of them, which is worth saying out loud.
    unanimous: needed === null || eligible === null ? null : needed >= eligible && eligible > 0,
  };
}

/** A commissioner forcing the outcome either way, bypassing review. */
export function commissionerResolve(trade, approve, now) {
  if (trade.status !== TRADE_STATUS.PROPOSED && trade.status !== TRADE_STATUS.REVIEW) {
    return fail(trade, `trade is ${trade.status}`);
  }
  return done({
    ...trade,
    status: approve ? TRADE_STATUS.REVIEW : TRADE_STATUS.VETOED,
    reviewEndsAt: approve ? now : trade.reviewEndsAt,
    resolvedAt: approve ? null : now,
  });
}

/**
 * Resolve everything that has come due: reviews that have run their course, and
 * proposals nobody answered.
 *
 * Returns { trades, ready } — `ready` are the trades whose review ended and which
 * should now be applied to the league's assets.
 */
export function resolveDueTrades(trades, now) {
  const out = [];
  const ready = [];
  for (const t of trades ?? []) {
    if (t.status === TRADE_STATUS.REVIEW && t.reviewEndsAt !== null && t.reviewEndsAt <= now) {
      ready.push(t);
      out.push(t);
      continue;
    }
    if (t.status === TRADE_STATUS.PROPOSED && t.expiresAt !== null && t.expiresAt <= now) {
      out.push({ ...t, status: TRADE_STATUS.EXPIRED, resolvedAt: t.expiresAt });
      continue;
    }
    out.push(t);
  }
  return { trades: out, ready };
}

/**
 * Apply an approved trade to the league's assets.
 *
 * ⚠️ ALL THREE ASSET CLASSES OR NONE. If the player legs are refused, the budget
 * and the picks must not move either — a partially applied trade cannot be undone
 * without a commissioner, and the managers involved will disagree about what was
 * actually agreed.
 */
export function applyTrade(assets, trade) {
  if (trade.status !== TRADE_STATUS.REVIEW) {
    return { ok: false, assets, error: `trade is ${trade.status}, not ready to apply` };
  }

  const moved = executeTrade(assets.rosters, trade.legs ?? []);
  if (!moved.ok && (trade.legs ?? []).length > 0) {
    return { ok: false, assets, error: moved.error };
  }

  const budgets = { ...(assets.budgets ?? {}) };
  for (const f of trade.faab ?? []) {
    const from = String(f.from);
    const to = String(f.to);
    const amount = Number(f.amount) || 0;
    if (amount < 0) return { ok: false, assets, error: 'negative FAAB transfer' };
    if ((budgets[from] ?? 0) < amount) {
      return { ok: false, assets, error: `team ${from} cannot send ${amount} FAAB` };
    }
    budgets[from] = (budgets[from] ?? 0) - amount;
    budgets[to] = (budgets[to] ?? 0) + amount;
  }

  // Pick ownership is a list of reassignments, matching applyTradedPicks' shape.
  const pickOwnership = [...(assets.pickOwnership ?? []), ...(trade.picks ?? [])];

  return {
    ok: true,
    error: null,
    assets: { ...assets, rosters: moved.ok ? moved.rosters : assets.rosters, budgets, pickOwnership },
    trade: { ...trade, status: TRADE_STATUS.EXECUTED, resolvedAt: trade.reviewEndsAt },
  };
}

/** Is the league past its trade deadline? */
export function tradingIsOpen(settings, week) {
  if (settings?.tradesEnabled === false) return false;
  return week <= (settings?.tradeDeadlineWeek ?? Infinity);
}
