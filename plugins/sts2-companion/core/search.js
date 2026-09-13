// core/search.js — pure filtering and search over bundled data. No DOM.

const strip = (s) => String(s ?? '').replace(/\[[^\]]*\]/g, ' ').toLowerCase();
const norm = (s) => strip(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** 0 = no match. A name match outranks a text match; a prefix outranks a substring. */
export function searchScore(item, query) {
  const q = norm(query);
  if (!q) return 0;
  const name = norm(item.name);
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  const body = norm([item.description, item.upgradeDescription, (item.keywords ?? []).join(' ')].join(' '));
  return body.includes(q) ? 20 : 0;
}

/**
 * @param {object[]} items
 * @param {{ q?: string, color?: string, type?: string, rarity?: string, cost?: number }} f
 *   cost 3 means "3 or more"; empty fields do not filter.
 */
export function filterItems(items, f = {}) {
  let out = items.filter((x) =>
    (!f.color || x.color === f.color || x.pool === f.color) &&
    (!f.type || x.type === f.type) &&
    (!f.rarity || x.rarity === f.rarity) &&
    (f.cost == null || f.cost === '' || (Number(f.cost) >= 3 ? x.cost >= 3 : x.cost === Number(f.cost))));
  if (f.q && norm(f.q)) {
    out = out.map((x) => [searchScore(x, f.q), x]).filter(([s]) => s > 0)
      .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map(([, x]) => x);
  } else {
    out = [...out].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  }
  return out;
}
