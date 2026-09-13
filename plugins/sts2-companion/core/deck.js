// core/deck.js — deck maths over the game.saves projection and builder archetypes. No DOM.
//
// Save ids are prefixed (`CARD.BASH`); the data is keyed `BASH`. A card the data lacks — one
// removed since this data build, like CARD.GRAPPLE in the owner's v0.99.1 run — stays in the deck
// as the data module's explicit unknown record: counted apart, never dropped, never blank.

import { saveIdToDataId } from './data.js';

const TYPE_ORDER = ['Attack', 'Skill', 'Power', 'Status', 'Curse', 'Quest', 'Unknown'];
export const CURVE_BUCKETS = ['0', '1', '2', '3+', 'X', 'Unplayable'];

/** `CHARACTER.IRONCLAD` → `ironclad`, the card data's `color`. */
export function characterColor(raw) {
  return saveIdToDataId(String(raw ?? '')).id.toLowerCase();
}

/** Projection deck (`[{ id, upgrades, enchantment? }]`) or archetype cards → `[{ saveId, card, upgrades, enchantment }]`. */
export async function resolveCards(data, deck) {
  return Promise.all((deck ?? []).map(async (c) => ({
    saveId: c.id,
    card: await data.get('card', saveIdToDataId(String(c.id)).id),
    upgrades: c.upgrades ?? 0,
    enchantment: c.enchantment ?? null,
  })));
}

const rank = (type) => { const i = TYPE_ORDER.indexOf(type); return i < 0 ? TYPE_ORDER.length : i; };

/** Identical cards (same id, upgrades, enchantment) as one row with a count, grouped by type. */
export function groupDeck(entries) {
  const rows = new Map();
  for (const e of entries) {
    const key = `${e.card.id}|${e.upgrades}|${e.enchantment ?? ''}`;
    if (!rows.has(key)) rows.set(key, { ...e, count: 0 });
    rows.get(key).count += 1;
  }
  const groups = new Map();
  for (const row of rows.values()) {
    const type = row.card.unknown ? 'Unknown' : row.card.type;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(row);
  }
  return [...groups]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([type, items]) => ({
      type,
      count: items.reduce((n, r) => n + r.count, 0),
      items: items.sort((a, b) => (a.card.cost ?? 99) - (b.card.cost ?? 99)
        || a.card.name.localeCompare(b.card.name) || a.upgrades - b.upgrades),
    }));
}

/**
 * The bucket a card's energy cost falls in.
 * ⚠️ BASE cost: the data carries no upgraded cost, so an upgrade that lowers a cost is not shown.
 */
export function costBucket(card) {
  if (card.xCost) return 'X';
  if ((card.keywords ?? []).includes('Unplayable') || card.cost < 0) return 'Unplayable';
  return card.cost >= 3 ? '3+' : String(card.cost);
}

export function energyCurve(entries) {
  const counts = Object.fromEntries(CURVE_BUCKETS.map((b) => [b, 0]));
  let unknown = 0;
  for (const { card } of entries) {
    if (card.unknown) unknown += 1;
    else counts[costBucket(card)] += 1;
  }
  return { buckets: CURVE_BUCKETS.map((label) => ({ label, n: counts[label] })), unknown };
}

/** How many cards carry each keyword or apply each power, most-covered first. */
export function keywordCoverage(entries) {
  const counts = new Map();
  for (const { card } of entries) {
    if (card.unknown) continue;
    for (const term of new Set([...(card.keywords ?? []), ...(card.powers ?? []).map((p) => p.power)])) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return [...counts].map(([term, n]) => ({ term, n })).sort((a, b) => b.n - a.n || a.term.localeCompare(b.term));
}

/** Two coverages side by side: every term in either, `a` and `b` counts. */
export function compareCoverage(a, b) {
  const rows = new Map();
  for (const { term, n } of a) rows.set(term, { term, a: n, b: 0 });
  for (const { term, n } of b) rows.set(term, { term, a: rows.get(term)?.a ?? 0, b: n });
  return [...rows.values()].sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || x.term.localeCompare(y.term));
}
