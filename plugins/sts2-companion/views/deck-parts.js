// views/deck-parts.js — pieces Deck, Builder and Run History share: a deck grid, the energy
// curve, keyword coverage, a relic row, and the art loader.

import { h } from '../core/dom.js';
import { barChart } from '../core/chart.js';
import { energyCurve } from '../core/deck.js';
import { saveIdToDataId } from '../core/data.js';

/** Swap every `[data-art]` placeholder under root for its image. No art (unknown) keeps the placeholder. */
export function loadArt(root, ctx) {
  for (const el of root.querySelectorAll('[data-art]')) {
    ctx.art.url(el.dataset.art).then((url) => {
      if (url && el.parentNode) el.replaceWith(h('img', { src: url, alt: el.dataset.alt ?? '', decoding: 'async' }));
    }).catch(() => {});
  }
}

const upgradeMark = (n) => (n > 1 ? `+${n}` : n === 1 ? '+' : '');

/**
 * One distinct card. ⚠️ No upgraded card art ships (the node's 16 MB plugin cap), so an upgraded
 * copy is the base art with a badge — the same rule as the Wiki.
 * @param actions optional (row) => Node — builder controls, rendered under the label
 */
export function deckTile(row, { actions } = {}) {
  const { card } = row;
  const label = `${card.unknown ? card.id : card.name}${upgradeMark(row.upgrades)}`;
  const art = card.unknown
    ? h('span', { class: 'ph' }, 'Not in this data build')
    : h('span', { class: 'ph', dataset: { art: `card:${card.id}`, alt: label } });
  return h('div', {
    class: `tile deck-tile${row.upgrades ? ' upgraded' : ''}${card.unknown ? ' is-unknown' : ''}`,
    dataset: { card: card.id, upgrades: String(row.upgrades) },
    title: card.unknown ? `${row.saveId} — not in this data build; the game may have changed since it was made` : null,
  },
  h('span', { class: 'art' }, art,
    row.count > 1 ? h('span', { class: 'count' }, `×${row.count}`) : null,
    row.upgrades ? h('span', { class: 'badge' }, 'Upgraded') : null),
  h('span', { class: 'label' }, label),
  row.enchantment ? h('span', { class: 'label ench' }, row.enchantment) : null,
  actions ? actions(row) : null);
}

export function deckGrid(groups, opts = {}) {
  return h('div', { class: 'deck' }, groups.map((g) => h('section', { class: 'deck-group' },
    h('h3', {}, `${g.type} · ${g.count}`),
    h('div', { class: 'grid deck-grid' }, g.items.map((row) => deckTile(row, opts))))));
}

export function curvePanel(entries, title = 'Energy curve') {
  const { buckets, unknown } = energyCurve(entries);
  const summary = `${title}: ${buckets.map((b) => `${b.n} costing ${b.label}`).join(', ')}`;
  return h('section', { class: 'panel curve' }, h('h3', {}, title), barChart(buckets, { label: summary }),
    unknown ? h('p', { class: 'sub' }, `${unknown} card${unknown === 1 ? '' : 's'} not in this data build, not counted`) : null);
}

/** `rows` from keywordCoverage (`{ term, n }`) or compareCoverage (`{ term, a, b }`, pass `b`). */
export function coveragePanel(rows, { a = 'Cards', b = null } = {}) {
  const body = rows.length
    ? h('table', { class: 'cov' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Keyword or power'), h('th', { scope: 'col' }, a), b ? h('th', { scope: 'col' }, b) : null)),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('th', { scope: 'row' }, r.term), h('td', {}, String(r.a ?? r.n)), b ? h('td', {}, String(r.b)) : null))))
    : h('p', { class: 'sub' }, 'No keywords or powers in this deck.');
  return h('section', { class: 'panel coverage' }, h('h3', {}, 'Keyword coverage'), body);
}

/** Relics or potions by save id (`RELIC.X`), unknown ids kept and marked. */
export async function relicRow(ctx, ids, kind = 'relic') {
  const items = await Promise.all((ids ?? []).map((raw) => ctx.data.get(kind, saveIdToDataId(String(raw)).id)));
  return h('div', { class: 'relics' }, items.map((it) => h('span', {
    class: `relic${it.unknown ? ' is-unknown' : ''}`,
    title: it.unknown ? `${it.id} — not in this data build` : it.name,
  },
  it.unknown ? h('span', { class: 'ph icon' }) : h('span', { class: 'ph icon', dataset: { art: `${kind}:${it.id}`, alt: it.name } }),
  h('span', { class: 'label' }, it.unknown ? it.id : it.name))));
}
