// dnd-master-prepared.js — encounters a content pack prepared (campaign.encounters), for the Encounter tab.
import { mapGeometry } from './lk-tavern.js';

/** Builder entries for a prepared encounter: [{ monster, count, lootItems }]. */
export function preparedToDraft(enc, srdMonsters) {
  return (enc?.items || []).map(it => {
    const monster = (srdMonsters || []).find(m => m.id === it.id);
    return monster ? { monster, count: it.count || 1, lootItems: [] } : null;
  }).filter(Boolean);
}

// Squares a token covers, as the Hub draws them (dnd-hub-state.js SIZE_CELLS; tiny takes a square like medium).
const CELLS = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };

/** A creature's size as a token's `size` ("Large" in the SRD → 'large'); anything else is medium. */
export function tokenSize(s) {
  const k = String(s || '').toLowerCase();
  return k in CELLS ? k : 'medium';
}

/**
 * Where each combatant's token goes, on the map's own squares (mapGeometry: its grid size and offsets) and where a
 * drop would snap it: odd sizes on a cell's centre, even sizes on a corner. The k-th monster covers prepared spawn
 * cell k (its top-left square); the rest stand in a column a full square right of the map, stacked by size.
 * Non-monsters get null.
 * 🔴 The column used to be at the map's edge + one square — a grid LINE, so every monster straddled two squares —
 * and prepared cells ignored the grid offset and the map's cells-across size (owner, 2026-10-08: "wonky").
 */
export function monsterSpots(order, map, spawn) {
  const { gs, ox, oy } = mapGeometry(map || {});
  const bgW = map?.bgScaledW || 0;
  const right = (map?.bgOffsetX ?? 0) + (bgW > 0 ? bgW : gs * 14);
  const col = Math.ceil((right - ox) / gs) + 1;
  let k = 0, row = 0;
  return order.map(c => {
    if (c.type !== 'monster') return null;
    const n = CELLS[tokenSize(c.size)];
    const cell = (spawn || [])[k++];
    if (cell) return { x: ox + (cell.cx + n / 2) * gs, y: oy + (cell.cy + n / 2) * gs };
    const p = { x: ox + (col + n / 2) * gs, y: oy + (row + n / 2) * gs };
    row += n;
    return p;
  });
}
