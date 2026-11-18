// core/league/commish.js — privileged operations.
//
// PURE. Every function takes the league state and returns a new one plus an
// audit entry; nothing here writes storage or reads a clock.
//
// ⚠️ EVERY COMMISSIONER ACTION IS AUDITED, WITHOUT EXCEPTION. These are exactly
// the operations that decide a season and exactly the ones a losing manager will
// question. An unlogged force-set lineup is indistinguishable from cheating, and
// the commissioner has no way to prove otherwise. The audit entry is therefore
// returned BESIDE the new state rather than as an optional extra, so a caller
// cannot apply the change while forgetting to record it.
//
// ⚠️ THIS MODULE DOES NOT CHECK WHO IS ASKING. Authorisation belongs to the
// caller — the server module checks the acting user against the league's
// commissioner list before invoking any of this. Putting the check here as well
// would create a second definition of who a commissioner is, and the two would
// eventually disagree.

import { addPlayer, dropPlayer, executeTrade, ownerOf, validateRosters } from './rosters.js';

export const COMMISH_ACTION = Object.freeze({
  FORCE_LINEUP: 'force_lineup',
  FORCE_ADD: 'force_add',
  FORCE_DROP: 'force_drop',
  FORCE_TRADE: 'force_trade',
  REVERSE_TRADE: 'reverse_trade',
  EDIT_SCORE: 'edit_score',
  SET_BUDGET: 'set_budget',
  REPLACE_MANAGER: 'replace_manager',
});

/** One immutable record of something a commissioner did. */
function entry(action, actorId, at, detail) {
  return { action, actorId: String(actorId), at, detail };
}

const fail = (error) => ({ ok: false, error, audit: null });

/**
 * Force a team's lineup for a week.
 *
 * The commissioner's most common intervention — an absent manager with a bye-week
 * starter — and the one most worth logging, because it changes a result.
 */
export function forceLineup({ lineups, teamId, week, season, lineup, actorId, at, reason = null }) {
  const key = `${season}:w${week}:${teamId}`;
  const previous = lineups?.[key] ?? null;
  return {
    ok: true,
    error: null,
    lineups: { ...(lineups ?? {}), [key]: [...lineup] },
    audit: entry(COMMISH_ACTION.FORCE_LINEUP, actorId, at, {
      teamId: String(teamId), season, week, previous, next: [...lineup], reason,
    }),
  };
}

/** Put a free agent on a roster, ignoring waivers and roster limits. */
export function forceAdd({ assets, teamId, playerId, actorId, at, reason = null }) {
  const res = addPlayer(assets.rosters, teamId, playerId);
  if (!res.ok) return fail(res.error);
  return {
    ok: true,
    error: null,
    assets: { ...assets, rosters: res.rosters },
    audit: entry(COMMISH_ACTION.FORCE_ADD, actorId, at, {
      teamId: String(teamId), playerId: String(playerId), reason,
    }),
  };
}

/** Remove a player from a roster. */
export function forceDrop({ assets, teamId, playerId, actorId, at, reason = null }) {
  const res = dropPlayer(assets.rosters, teamId, playerId);
  if (!res.ok) return fail(res.error);
  return {
    ok: true,
    error: null,
    assets: { ...assets, rosters: res.rosters },
    audit: entry(COMMISH_ACTION.FORCE_DROP, actorId, at, {
      teamId: String(teamId), playerId: String(playerId), reason,
    }),
  };
}

/**
 * Undo an executed trade by running its legs backwards.
 *
 * ⚠️ REVERSAL CAN LEGITIMATELY FAIL, and must say so rather than half-applying.
 * If a player from the trade has since been dropped or traded on, the original
 * position no longer exists — reconstructing it would mean taking a player from
 * whoever holds him now, which is a second unrelated trade the commissioner did
 * not authorise.
 */
export function reverseTrade({ assets, trade, actorId, at, reason = null }) {
  const legs = (trade?.legs ?? []).map((l) => ({ from: l.to, to: l.from, playerId: l.playerId }));
  if (legs.length === 0 && (trade?.faab ?? []).length === 0) {
    return fail('this trade moved no players or FAAB to reverse');
  }

  for (const leg of legs) {
    const owner = ownerOf(assets.rosters, leg.playerId);
    if (owner !== String(leg.from)) {
      return fail(`player ${leg.playerId} is no longer on team ${leg.from} — reverse it by hand`);
    }
  }

  const moved = executeTrade(assets.rosters, legs);
  if (!moved.ok && legs.length > 0) return fail(moved.error);

  const budgets = { ...(assets.budgets ?? {}) };
  for (const f of trade?.faab ?? []) {
    const amount = Number(f.amount) || 0;
    if ((budgets[String(f.to)] ?? 0) < amount) {
      return fail(`team ${f.to} has already spent the ${amount} FAAB it received`);
    }
    budgets[String(f.to)] -= amount;
    budgets[String(f.from)] = (budgets[String(f.from)] ?? 0) + amount;
  }

  return {
    ok: true,
    error: null,
    assets: { ...assets, rosters: moved.ok ? moved.rosters : assets.rosters, budgets },
    audit: entry(COMMISH_ACTION.REVERSE_TRADE, actorId, at, { tradeId: trade?.id ?? null, reason }),
  };
}

/**
 * Correct a recorded score.
 *
 * ⚠️ The PREVIOUS value goes in the audit entry. A correction nobody can compare
 * against the original is not a correction, it is a rewrite.
 */
export function editScore({ scores, season, week, teamId, points, actorId, at, reason = null }) {
  const key = `${season}:w${week}`;
  const weekScores = { ...(scores?.[key] ?? {}) };
  const previous = weekScores[String(teamId)] ?? null;
  weekScores[String(teamId)] = Number(points);

  return {
    ok: true,
    error: null,
    scores: { ...(scores ?? {}), [key]: weekScores },
    audit: entry(COMMISH_ACTION.EDIT_SCORE, actorId, at, {
      teamId: String(teamId), season, week, previous, next: Number(points), reason,
    }),
  };
}

/** Set a team's FAAB budget outright. */
export function setBudget({ assets, teamId, amount, actorId, at, reason = null }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return fail('budget must be a number of at least 0');
  const previous = assets.budgets?.[String(teamId)] ?? null;
  return {
    ok: true,
    error: null,
    assets: { ...assets, budgets: { ...(assets.budgets ?? {}), [String(teamId)]: value } },
    audit: entry(COMMISH_ACTION.SET_BUDGET, actorId, at, {
      teamId: String(teamId), previous, next: value, reason,
    }),
  };
}

/**
 * Hand a team to a different manager.
 *
 * The roster is untouched — a team changing hands keeps its players, its record
 * and its budget. Only who controls it changes.
 */
export function replaceManager({ teams, teamId, userId, actorId, at, reason = null }) {
  const team = teams?.[String(teamId)];
  if (!team) return fail(`no such team: ${teamId}`);
  const previous = team.ownerId ?? null;
  return {
    ok: true,
    error: null,
    teams: { ...teams, [String(teamId)]: { ...team, ownerId: String(userId), coOwners: [] } },
    audit: entry(COMMISH_ACTION.REPLACE_MANAGER, actorId, at, {
      teamId: String(teamId), previous, next: String(userId), reason,
    }),
  };
}

/**
 * Append to the audit log, newest last.
 *
 * ⚠️ APPEND ONLY. Nothing in this module edits or removes an entry, and nothing
 * should: a commissioner who can quietly rewrite the log has the same problem as
 * one who never wrote it.
 */
export function appendAudit(log, audit) {
  if (!audit) return log ?? [];
  return [...(log ?? []), audit];
}

/**
 * Check the league is still coherent after a privileged change.
 *
 * Commissioner tools deliberately bypass the ordinary rules, so this is the
 * backstop: they may break a roster LIMIT, but they must never break the
 * one-player-one-team invariant.
 */
export function verifyAfterCommishAction(assets, settings) {
  const result = validateRosters(assets?.rosters ?? {}, settings);
  const fatal = result.errors.filter((e) => e.includes('owned by both') || e.includes('appears twice'));
  return { valid: fatal.length === 0, fatal, warnings: result.errors.filter((e) => !fatal.includes(e)) };
}
