// core/sleeper-league.js — the league transactions feed.
//
// Measured against 292 live transactions across all 17 weeks of the fixture league on
// 2026-08-08. Three things that payload teaches, all of which this module encodes:
//
//   1. 57 of 292 (19.5%) have status "failed" — a failed waiver claim looks structurally
//      identical to a successful one. Rendering them the same way shows players joining
//      rosters they never joined.
//   2. A TRADE is the same player id in BOTH `adds` and `drops`, pointing at different
//      rosters. It is one transfer, not two moves.
//   3. Traded draft picks use ROSTER ids in owner_id/previous_owner_id (not user ids),
//      and the season can be a future year.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** `adds`/`drops` are dicts of player_id -> roster_id, or null. */
const entries = (dict) => (dict && typeof dict === 'object' && !Array.isArray(dict)
  ? Object.entries(dict).map(([playerId, rosterId]) => ({
    playerId: String(playerId), rosterId: num(rosterId),
  }))
  : []);

/**
 * Split adds/drops into true transfers and one-sided moves.
 *
 * A player present on both sides moved BETWEEN rosters — that is the trade shape. Anything
 * left is a genuine acquisition or release.
 */
export function splitMoves(addDict, dropDict) {
  const adds = entries(addDict);
  const drops = entries(dropDict);
  const dropBy = new Map(drops.map((d) => [d.playerId, d.rosterId]));

  const transfers = [];
  const pureAdds = [];
  for (const a of adds) {
    if (dropBy.has(a.playerId)) {
      transfers.push({
        playerId: a.playerId,
        fromRosterId: dropBy.get(a.playerId),
        toRosterId: a.rosterId,
      });
    } else {
      pureAdds.push(a);
    }
  }
  const moved = new Set(transfers.map((t) => t.playerId));
  return { transfers, adds: pureAdds, drops: drops.filter((d) => !moved.has(d.playerId)) };
}

/** Traded picks. owner_id / previous_owner_id are ROSTER ids, and season may be future. */
function parsePicks(list) {
  if (!Array.isArray(list)) return [];
  return list.map((p) => ({
    season: p?.season != null ? String(p.season) : null,
    round: num(p?.round),
    fromRosterId: num(p?.previous_owner_id),
    toRosterId: num(p?.owner_id),
  }));
}

/**
 * FAAB moved by a trade. Never observed non-empty across 292 live transactions, so the
 * element shape is UNMEASURED — passed through as-is rather than reshaped into fields we
 * have never actually seen. A non-array (which we have also never seen) yields [].
 */
function parseBudget(list) {
  return Array.isArray(list) ? list : [];
}

export function parseTransactions(json) {
  if (!Array.isArray(json)) return [];
  return json.map((t) => {
    const { transfers, adds, drops } = splitMoves(t?.adds, t?.drops);
    const status = t?.status ?? null;
    return {
      id: t?.transaction_id ?? null,
      type: t?.type ?? null,
      status,
      // One boolean the views branch on, so no view has to know the vocabulary.
      succeeded: status === 'complete',
      week: num(t?.leg),
      created: num(t?.created) ?? 0,
      statusUpdated: num(t?.status_updated),
      rosterIds: Array.isArray(t?.roster_ids) ? t.roster_ids.map(Number) : [],
      consenterIds: Array.isArray(t?.consenter_ids) ? t.consenter_ids.map(Number) : [],
      creator: t?.creator ?? null,
      transfers,
      adds,
      drops,
      picks: parsePicks(t?.draft_picks),
      budgetMoves: parseBudget(t?.waiver_budget),
      faabBid: num(t?.settings?.waiver_bid),
      note: t?.metadata?.notes ?? null,
    };
  });
}

/** Group a parsed feed into weeks, newest week and newest item first. */
export function groupByWeek(list) {
  const byWeek = new Map();
  for (const t of list ?? []) {
    const w = t.week ?? 0;
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(t);
  }
  return [...byWeek.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([week, items]) => ({
      week,
      items: items.sort((a, b) => (b.created ?? 0) - (a.created ?? 0)),
    }));
}
