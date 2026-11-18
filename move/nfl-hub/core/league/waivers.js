// core/league/waivers.js — resolving a batch of waiver claims.
//
// PURE. One function turns a pile of blind claims into an ordered, deterministic
// set of outcomes.
//
// ⚠️ RESOLUTION IS A SINGLE-WRITER BATCH, and that is a deliberate design choice
// rather than an implementation detail. Claims are APPENDED by many managers all
// week (contended — that key needs compare-and-swap), but they are RESOLVED by
// one scheduled run over the collected pile. Nothing contends during resolution,
// which is what lets a 12-team FAAB run fit inside the node's 5-second scheduled
// budget.
//
// ⚠️ EVERY CLAIM IS VALIDATED AT EXECUTION TIME, not at submission time. Budget
// spent and roster spots filled by earlier claims in the same batch must be
// visible to later ones — a team that wins a $90 bid cannot then also win a $20
// one on a $100 budget.

import { WAIVER_TYPE } from './settings.js';
import { addPlayer, dropPlayer, ownerOf, rosterCapacity } from './rosters.js';

export const CLAIM_STATUS = Object.freeze({
  WON: 'won',
  LOST: 'lost',        // somebody outbid or outranked them
  INVALID: 'invalid',  // could never have succeeded
});

/**
 * Order claims into the sequence they will be processed in.
 *
 * FAAB: highest bid first, ties broken by waiver priority (lower number = better
 * position), then by submission time so the order is total and deterministic.
 *
 * Rolling / reverse-standings: priority alone, then submission time.
 *
 * ⚠️ THE ORDER MUST BE TOTAL. Two claims that compare equal would resolve in
 * whatever order the array happened to be in, which means the same batch could
 * resolve differently on a retry — and a waiver run that is not reproducible
 * cannot be explained to the manager who lost.
 */
export function orderClaims(claims, { waiverType, priority = {} }) {
  const pri = (teamId) => priority[String(teamId)] ?? Number.MAX_SAFE_INTEGER;
  return [...claims].sort((a, b) => {
    if (waiverType === WAIVER_TYPE.FAAB) {
      const bid = (Number(b.bid) || 0) - (Number(a.bid) || 0);
      if (bid !== 0) return bid;
    }
    const p = pri(a.teamId) - pri(b.teamId);
    if (p !== 0) return p;
    return (a.submittedAt ?? 0) - (b.submittedAt ?? 0);
  });
}

/**
 * Resolve a whole batch.
 *
 * Returns { results, rosters, budgets, priority } — new values throughout, never
 * mutating the inputs.
 *
 * `priority` maps teamId → waiver position (1 is best). In a rolling league a
 * winner drops to the back; in reverse-standings it is recomputed from the table
 * elsewhere and left alone here.
 */
export function resolveWaivers(claims, {
  rosters, settings, budgets = {}, priority = {}, isAvailable = null,
}) {
  const waiverType = settings?.waiverType;
  const ordered = orderClaims(claims ?? [], { waiverType, priority });

  let workingRosters = rosters;
  const workingBudgets = { ...budgets };
  let workingPriority = { ...priority };
  const results = [];

  for (const claim of ordered) {
    const team = String(claim.teamId);
    const playerId = String(claim.playerId);
    const bid = Number(claim.bid) || 0;

    const reject = (status, reason) => results.push({ claim, status, reason });

    if (!workingRosters?.[team]) { reject(CLAIM_STATUS.INVALID, `no such team: ${team}`); continue; }

    // Someone earlier in this batch may already have taken the player, and he
    // may have been rostered all along.
    const owner = ownerOf(workingRosters, playerId);
    if (owner) {
      reject(owner === team ? CLAIM_STATUS.INVALID : CLAIM_STATUS.LOST,
        owner === team ? 'already on this roster' : `claimed by team ${owner}`);
      continue;
    }
    if (isAvailable && !isAvailable(playerId)) {
      reject(CLAIM_STATUS.INVALID, 'player is not a free agent');
      continue;
    }

    if (waiverType === WAIVER_TYPE.FAAB) {
      const remaining = workingBudgets[team] ?? settings?.waiverBudget ?? 0;
      if (bid < 0) { reject(CLAIM_STATUS.INVALID, 'negative bid'); continue; }
      // ⚠️ Checked against the budget as it stands NOW, so a team's own earlier
      // win in this same batch has already been deducted.
      if (bid > remaining) {
        reject(CLAIM_STATUS.INVALID, `bid ${bid} exceeds remaining budget ${remaining}`);
        continue;
      }
    }

    // The drop, if any, happens first — it is what makes room.
    let candidate = workingRosters;
    if (claim.dropPlayerId) {
      const dropped = dropPlayer(candidate, team, String(claim.dropPlayerId));
      if (!dropped.ok) { reject(CLAIM_STATUS.INVALID, dropped.error); continue; }
      candidate = dropped.rosters;
    }

    const capacity = rosterCapacity(settings);
    if ((candidate[team].players ?? []).length >= capacity) {
      reject(CLAIM_STATUS.INVALID, `roster is full (${capacity}) and no drop was named`);
      continue;
    }

    const added = addPlayer(candidate, team, playerId);
    if (!added.ok) { reject(CLAIM_STATUS.INVALID, added.error); continue; }

    workingRosters = added.rosters;
    if (waiverType === WAIVER_TYPE.FAAB) {
      workingBudgets[team] = (workingBudgets[team] ?? settings?.waiverBudget ?? 0) - bid;
    }
    if (waiverType === WAIVER_TYPE.ROLLING) {
      workingPriority = demoteToBack(workingPriority, team);
    }
    results.push({ claim, status: CLAIM_STATUS.WON, reason: null, spent: bid });
  }

  return { results, rosters: workingRosters, budgets: workingBudgets, priority: workingPriority };
}

/**
 * Move a team to the back of the waiver order, closing the gap it leaves.
 *
 * ⚠️ Everyone who was BEHIND the winner moves up one. Simply setting the winner
 * to `numTeams` leaves a hole and eventually two teams sharing a position, at
 * which point the order stops being total and ties resolve arbitrarily.
 */
export function demoteToBack(priority, teamId) {
  const team = String(teamId);
  const was = priority[team];
  if (was === undefined) return { ...priority };
  const out = {};
  let last = 0;
  for (const [id, pos] of Object.entries(priority)) {
    out[id] = pos > was ? pos - 1 : pos;
    last = Math.max(last, pos);
  }
  out[team] = last;
  return out;
}

/** Waiver order derived from standings — worst record picks first. */
export function priorityFromStandings(standings = []) {
  const out = {};
  [...standings]
    .sort((a, b) => (a.wins - b.wins) || (a.pointsFor - b.pointsFor))
    .forEach((row, i) => { out[String(row.teamId)] = i + 1; });
  return out;
}

/** What a team has left to spend. */
export function remainingBudget(budgets, teamId, settings) {
  return budgets?.[String(teamId)] ?? settings?.waiverBudget ?? 0;
}
