// dnd-master-prepared.js — encounters a content pack prepared (campaign.encounters), for the Encounter tab.

/** Builder entries for a prepared encounter: [{ monster, count, lootItems }]. */
export function preparedToDraft(enc, srdMonsters) {
  return (enc?.items || []).map(it => {
    const monster = (srdMonsters || []).find(m => m.id === it.id);
    return monster ? { monster, count: it.count || 1, lootItems: [] } : null;
  }).filter(Boolean);
}

/**
 * Where each combatant's token goes: the k-th monster on spawn cell k (cell centre, px), monsters past the
 * last cell at `fallback` (the old off-map column). Non-monsters get null.
 */
export function spawnPositions(order, spawn, gs, fallback) {
  let k = 0;
  return order.map(c => {
    if (c.type !== 'monster') return null;
    const cell = (spawn || [])[k++];
    return cell ? { x: (cell.cx + 0.5) * gs, y: (cell.cy + 0.5) * gs } : fallback;
  });
}
