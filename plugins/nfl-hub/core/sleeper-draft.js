// core/sleeper-draft.js — draft metadata, picks, and the board grid.
//
// Two measured facts make this the cheapest surface in the whole hub (2026-08-08):
//
//   1. Each pick carries `metadata` INLINE — first_name, last_name, position, team,
//      injury_status. Unlike every other fantasy surface, the board needs NO player-index
//      join and no second fetch.
//   2. Each pick carries BOTH `round` and `draft_slot`. The grid is therefore addressed
//      directly and snake-vs-linear ordering never has to be reconstructed — `pick_no` is
//      display only. That also means an auction or a third draft type cannot break the
//      layout.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function parseDrafts(json) {
  if (!Array.isArray(json)) return [];
  return json.map((d) => ({
    draftId: d?.draft_id ?? null,
    leagueId: d?.league_id ?? null,
    status: d?.status ?? null,
    type: d?.type ?? null,
    season: d?.season != null ? String(d.season) : null,
    startTime: num(d?.start_time),
    rounds: num(d?.settings?.rounds) ?? 0,
    teams: num(d?.settings?.teams) ?? 0,
    // `draft_order` is user_id -> slot. Kept for labelling; the board itself derives
    // slot -> roster from the picks, which needs no extra fetch.
    draftOrder: d?.draft_order ?? {},
  }));
}

export function parseDraftPicks(json) {
  if (!Array.isArray(json)) return [];
  return json.map((p) => {
    const m = p?.metadata ?? {};
    const first = m.first_name ?? '';
    const last = m.last_name ?? '';
    const name = `${first} ${last}`.trim();
    return {
      pickNo: num(p?.pick_no),
      round: num(p?.round),
      draftSlot: num(p?.draft_slot),
      rosterId: num(p?.roster_id),
      pickedBy: p?.picked_by ?? null,
      playerId: p?.player_id != null ? String(p.player_id) : null,
      name: name || 'Unknown',
      position: m.position ?? '',
      team: m.team ?? '',
      injuryStatus: m.injury_status || null,
      yearsExp: num(m.years_exp),
      // Sleeper sends null, not false, for a non-keeper.
      isKeeper: p?.is_keeper === true,
    };
  });
}

/**
 * Grid the picks into rounds x slots.
 *
 * A missing pick stays null so the column a team actually drafted from never shifts —
 * shifting later picks left would silently reattribute every pick in the round.
 */
export function draftBoard(picks) {
  const list = (picks ?? []).filter((p) => p.round != null && p.draftSlot != null);
  if (!list.length) return { rounds: [], slots: [], slotRoster: {} };

  const maxRound = Math.max(...list.map((p) => p.round));
  const maxSlot = Math.max(...list.map((p) => p.draftSlot));
  const slots = Array.from({ length: maxSlot }, (_, i) => i + 1);

  const slotRoster = {};
  for (const p of list) {
    if (p.rosterId != null && slotRoster[p.draftSlot] === undefined) {
      slotRoster[p.draftSlot] = p.rosterId;
    }
  }

  const at = new Map(list.map((p) => [`${p.round}:${p.draftSlot}`, p]));
  const rounds = Array.from({ length: maxRound }, (_, i) => ({
    round: i + 1,
    cells: slots.map((s) => at.get(`${i + 1}:${s}`) ?? null),
  }));

  return { rounds, slots, slotRoster };
}
