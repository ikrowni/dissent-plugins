// dnd-master-item-filter.js — the item library's kinds and search (owner, 2026-10-06: "some method of organization or
// filters for armor, consumables, weapons"). Pure.

/** The library's kinds, in the order the chips show. An item of a type not named here (the forge's "misc") is Other. */
export const ITEM_GROUPS = [['weapon', 'Weapons'], ['armor', 'Armour'], ['consumable', 'Consumables'], ['magic', 'Magic'], ['other', 'Other']];
const KNOWN = new Set(ITEM_GROUPS.map(g => g[0]).filter(g => g !== 'other'));
export const groupOf = item => (KNOWN.has(item?.type) ? item.type : 'other');

/** How many items each kind has: { all, weapon, armor, … }. */
export function groupCounts(items) {
  const out = { all: items.length };
  for (const [g] of ITEM_GROUPS) out[g] = 0;
  for (const it of items) out[groupOf(it)]++;
  return out;
}

/** The items to list: of kind `group` ('all' for every one) whose name holds `q`, A–Z. */
export function filterItems(items, group = 'all', q = '') {
  const s = String(q).trim().toLowerCase();
  return items.filter(it => (group === 'all' || groupOf(it) === group) && (!s || String(it.name || '').toLowerCase().includes(s)))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
}
