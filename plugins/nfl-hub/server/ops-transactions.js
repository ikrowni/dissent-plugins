// server/ops-transactions.js — waivers and trades.
//
// ⚠️ WAIVER CLAIMS ARE SUBMITTED BY USERS, BUT RESOLVED BY THE SCHEDULER, and
// those are different authorities. Letting a user trigger resolution would let
// the first manager awake on Wednesday decide when waivers clear — and would put
// a 12-team FAAB run on the 2 s invoke budget instead of the 5 s scheduled one.

import { KEY, read, mutate, loadLeague } from "./store.js";
import { requireTeamControl, requireCommissioner, requireUser, requireScheduled, isCommissioner } from "./auth.js";
import { resolveWaivers, remainingBudget, CLAIM_STATUS } from "../core/league/waivers.js";
import {
  onWaivers, removeFromWire, clearExpired, recordAcquisition, wirePlayers,
} from "../core/league/waiver-wire.js";
import {
  proposeTrade, acceptTrade, rejectTrade, cancelTrade, vetoTrade,
  commissionerResolve, resolveDueTrades, applyTrade, tradingIsOpen, TRADE_STATUS,
} from "../core/league/trades.js";

const refuse = (msg) => { throw new Error(msg); };

/** Submit a waiver claim. Appended to a contended list, so it swaps. */
export function submitClaim({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  if (!Number.isInteger(week) || week < 1) refuse("week must be a positive integer");

  const claim = {
    teamId,
    playerId: String(payload?.playerId ?? ""),
    dropPlayerId: payload?.dropPlayerId ? String(payload.dropPlayerId) : null,
    bid: Number(payload?.bid ?? 0),
    submittedAt: Date.now(),
    submittedBy: p.userId,
  };
  if (!claim.playerId) refuse("playerId required");
  if (claim.bid < 0) refuse("bid cannot be negative");

  mutate(KEY.waivers(lg, season, week), (claims) => {
    const list = claims ?? [];
    // Re-submitting for the same player REPLACES the earlier claim rather than
    // stacking a second one — otherwise a manager who changed their bid would
    // have two live claims and could win the same player twice.
    const without = list.filter((c) => !(c.teamId === teamId && c.playerId === claim.playerId));
    return [...without, claim];
  }, []);

  return { submitted: claim.playerId, bid: claim.bid, season, week };
}

/** Withdraw a pending claim. */
export function cancelClaim({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const playerId = String(payload?.playerId ?? "");

  mutate(KEY.waivers(lg, season, week), (claims) =>
    (claims ?? []).filter((c) => !(c.teamId === teamId && c.playerId === playerId)), []);
  return { cancelled: playerId };
}

/** A team's own pending claims, plus what it has left to spend. */
export function listClaims({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const claims = read(KEY.waivers(lg, season, week), []);

  const mine = Object.keys(teams).filter((t) =>
    teams[t].ownerId === p.userId || (teams[t].coOwners ?? []).includes(p.userId));

  return {
    // ⚠️ Only your own claims. Waivers are BLIND — returning everyone's bids
    // would turn a blind auction into an open one.
    claims: claims.filter((c) => mine.includes(c.teamId) || isCommissioner(meta, p.userId)),
    budgets: Object.fromEntries(mine.map((t) => [t, remainingBudget(assets.budgets, t, meta.settings)])),
    pendingCount: claims.length,
  };
}

/**
 * Run waivers. SCHEDULED ONLY.
 *
 * Single-writer by construction, which is what lets a 12-team FAAB run fit the
 * scheduled budget: nothing contends during resolution.
 */
export function runWaivers({ p, payload }) {
  const err = requireScheduled(p);
  if (err) refuse(err);

  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);

  const claims = read(KEY.waivers(lg, season, week), []);
  if (claims.length === 0) return { processed: 0, results: [] };

  const now = Date.now();
  let results = [];
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    const out = resolveWaivers(claims, {
      rosters: assets.rosters,
      settings: meta.settings,
      budgets: assets.budgets,
      priority: meta.waiverPriority ?? {},
    });
    results = out.results.map((r) => ({
      teamId: r.claim.teamId, playerId: r.claim.playerId, status: r.status, reason: r.reason,
    }));

    // ⚠️ A WON PLAYER COMES OFF THE WIRE. Left on it he would stay unaddable
    // for the rest of his clear period even though somebody now owns him, and
    // the next sweep would "clear" a rostered player into free agency.
    //
    // ⚠️ Recorded as acquired via WAIVERS, not free_agency — a claimed player
    // dropped again within a day still goes to the wire. Only a free-agent
    // pickup is exempt.
    let wire = assets.wire ?? {};
    let acquired = assets.acquired ?? {};
    for (const r of out.results) {
      if (r.status !== CLAIM_STATUS.WON) continue;
      const pid = String(r.claim.playerId);
      wire = removeFromWire(wire, pid);
      acquired = recordAcquisition(acquired, pid, { at: now, via: "waivers" });
    }

    return { ...assets, rosters: out.rosters, budgets: out.budgets, wire, acquired };
  }, null);

  // The claim list is cleared only after the assets write succeeded. Clearing
  // first would lose every claim if the swap then failed.
  mutate(KEY.waivers(lg, season, week), () => [], []);
  return { processed: results.length, results };
}

/** Propose a trade. */
export function proposeLeagueTrade({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const week = Number(payload?.week ?? 1);
  if (!tradingIsOpen(meta.settings, week)) refuse("trading is closed for this league");

  const from = String(payload?.fromTeamId ?? "");
  const err = requireTeamControl(p, teams, meta, from);
  if (err) refuse(err);

  const id = `tr${Date.now().toString(36)}`;
  const res = proposeTrade({
    id,
    proposedBy: from,
    legs: payload?.legs ?? [],
    picks: payload?.picks ?? [],
    faab: payload?.faab ?? [],
    now: Date.now(),
    expiresAt: payload?.expiresAt ?? null,
  });
  if (!res.ok) refuse(res.error);

  mutate(KEY.trade(lg, id), () => res.trade, null);
  mutate(KEY.tradeIndex(lg), (list) => [...(list ?? []), id], []);
  return { tradeId: id, status: res.trade.status, parties: res.trade.parties };
}

/** Accept, reject, cancel or veto — one op, because they share every check. */
export function respondToTrade({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const tradeId = String(payload?.tradeId ?? "");
  const teamId = String(payload?.teamId ?? "");
  const action = String(payload?.action ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  let out = null;
  mutate(KEY.trade(lg, tradeId), (t) => {
    if (!t) refuse(`no such trade: ${tradeId}`);
    const now = Date.now();
    let res;
    switch (action) {
      case "accept": res = acceptTrade(t, teamId, now, meta.settings); break;
      case "reject": res = rejectTrade(t, teamId, now); break;
      case "cancel": res = cancelTrade(t, teamId, now); break;
      case "veto": res = vetoTrade(t, teamId, now, meta.settings); break;
      default: refuse(`unknown action: ${action}`);
    }
    if (!res.ok) refuse(res.error);
    out = { tradeId, status: res.trade.status, reviewEndsAt: res.trade.reviewEndsAt };
    return res.trade;
  }, null);
  return out;
}

/** Commissioner: force a trade through or kill it. */
export function commissionerTrade({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  const tradeId = String(payload?.tradeId ?? "");
  const approve = Boolean(payload?.approve);
  let out = null;
  mutate(KEY.trade(lg, tradeId), (t) => {
    if (!t) refuse(`no such trade: ${tradeId}`);
    const res = commissionerResolve(t, approve, Date.now());
    if (!res.ok) refuse(res.error);
    out = { tradeId, status: res.trade.status };
    return res.trade;
  }, null);
  return out;
}

/** Trades visible to the caller. */
export function listTrades({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const ids = read(KEY.tradeIndex(lg), []);
  return ids.map((id) => read(KEY.trade(lg, id), null)).filter(Boolean);
}

/**
 * Execute trades whose review period has ended. SCHEDULED ONLY.
 *
 * ⚠️ The trade record and the assets are two keys and cannot move atomically, so
 * the ORDER matters: assets first, then the trade is marked executed. If the
 * second write is lost, the next tick sees a trade still in review whose legs no
 * longer apply and refuses it — visible and recoverable. The reverse order would
 * mark a trade executed that never moved anything, which is silent.
 */
export function settleTrades({ p, payload }) {
  const err = requireScheduled(p);
  if (err) refuse(err);

  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);

  const ids = read(KEY.tradeIndex(lg), []);
  const trades = ids.map((id) => read(KEY.trade(lg, id), null)).filter(Boolean);
  const due = resolveDueTrades(trades, Date.now());

  const settled = [];
  for (const trade of due.ready) {
    let applied = null;
    mutate(KEY.assets(lg), (a) => {
      const res = applyTrade(a ?? { rosters: {}, budgets: {}, pickOwnership: [] }, trade);
      if (!res.ok) { applied = { ok: false, error: res.error }; return a; }
      applied = { ok: true, trade: res.trade };
      return res.assets;
    }, null);

    if (applied?.ok) {
      mutate(KEY.trade(lg, trade.id), () => applied.trade, null);
      settled.push({ tradeId: trade.id, status: TRADE_STATUS.EXECUTED });
    } else {
      settled.push({ tradeId: trade.id, status: "failed", error: applied?.error ?? "unknown" });
    }
  }

  // Expiries are pure state changes with nothing to apply.
  for (const t of due.trades) {
    if (t.status === TRADE_STATUS.EXPIRED) {
      mutate(KEY.trade(lg, t.id), () => t, null);
    }
  }

  return { settled };
}

function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  return lg;
}


/**
 * Sweep everyone whose waiver period is up.
 *
 * ⚠️ THE SWEEP IS HOUSEKEEPING, NOT THE RULE. `onWaivers()` answers from the
 * clock, so a player is addable the moment he clears whether or not this has
 * run — a late tick must never keep a free agent locked up. This only prunes
 * the record so it does not grow forever.
 */
export function sweepWaiverWire(lg, now = Date.now()) {
  let cleared = [];
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    const out = clearExpired(assets.wire ?? {}, now);
    if (out.cleared.length === 0) return assets;
    return { ...assets, wire: out.wire };
  }, null);

  const settled = read(KEY.assets(lg), { wire: {} });
  cleared = Object.keys(settled.wire ?? {});
  return { onWire: cleared.length };
}


/** Who is currently on waivers, soonest to clear first. Any member may look. */
export function getWaiverWire({ payload }) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  const assets = read(KEY.assets(lg), { wire: {} });
  return { wire: wirePlayers(assets.wire ?? {}, Date.now()) };
}
