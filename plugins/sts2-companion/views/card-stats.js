// views/card-stats.js — the user's card stats (game.saves.profileStats) as a sortable table,
// with per-character records above it.

import { h, clear, append } from '../core/dom.js';
import { humanizeId } from '../core/data.js';
import { cardStatRows, sortRows } from '../core/runs.js';
import { statusBlock } from './status.js';

const COLUMNS = [
  ['name', 'Card'], ['picked', 'Picked'], ['skipped', 'Skipped'], ['pickRate', 'Pick rate'],
  ['won', 'Won'], ['lost', 'Lost'], ['winRate', 'Win rate'],
];
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export async function renderCardStats(stats, ctx) {
  if (stats?.status !== 'ok') return statusBlock(stats);
  const rows = await cardStatRows(ctx.data, stats);
  let sort = { key: 'picked', dir: 'desc' };

  const tbody = h('tbody');
  const heads = COLUMNS.map(([key, label]) => h('th', { scope: 'col' },
    h('button', { type: 'button', class: 'sort', dataset: { sort: key }, onclick: () => {
      sort = { key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' };
      paint();
    } }, label)));

  function paint() {
    heads.forEach((th, i) => th.setAttribute('aria-sort', COLUMNS[i][0] === sort.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'));
    append(clear(tbody), sortRows(rows, sort.key, sort.dir).map((r) => h('tr', { dataset: { winRate: r.winRate == null ? '' : String(r.winRate) } },
      h('th', { scope: 'row', class: r.unknown ? 'is-unknown' : null }, r.name),
      h('td', {}, String(r.picked)), h('td', {}, String(r.skipped)), h('td', {}, pct(r.pickRate)),
      h('td', {}, String(r.won)), h('td', {}, String(r.lost)), h('td', {}, pct(r.winRate)))));
  }
  paint();

  const characters = h('div', { class: 'characters panels' }, (stats.characters ?? []).map((c) => h('section', { class: 'panel' },
    h('h3', {}, humanizeId(c.id)),
    h('p', { class: 'sub' }, `${c.wins} wins · ${c.losses} losses · best streak ${c.best_streak} · max ascension ${c.max_ascension}`))));

  return h('div', { class: 'card-stats' }, characters,
    h('div', { class: 'table-wrap' }, h('table', { class: 'stats' }, h('thead', {}, h('tr', {}, heads)), tbody)));
}
