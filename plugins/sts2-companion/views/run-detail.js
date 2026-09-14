// views/run-detail.js — one finished run: header, player switch, HP chart, floor timeline
// (rooms, picks against skips, relics, potions, upgrades, removals), and the final deck.

import { h } from '../core/dom.js';
import { humanizeId } from '../core/data.js';
import { lineChart } from '../core/chart.js';
import { resolveCards, groupDeck } from '../core/deck.js';
import { floorRows, hpSeries, actMarks, floorChanges, outcome, formatDuration } from '../core/runs.js';
import { deckGrid, relicRow } from './deck-parts.js';
import { statusBlock } from './status.js';

/** A save id as an inline name; an id the data lacks shows raw and marked. */
async function name(ctx, raw, cls = '') {
  const l = await ctx.data.label(raw);
  return h('span', { class: `name ${cls}${l.unknown ? ' is-unknown' : ''}`.trim(), title: l.unknown ? `${raw} — not in this data build` : null }, l.name);
}

async function line(ctx, label, ids, cls) {
  if (!ids.length) return null;
  const names = await Promise.all(ids.map((id) => name(ctx, id, cls)));
  return h('div', { class: 'change' }, h('span', { class: 'what' }, `${label} `), names.flatMap((n, i) => (i ? [', ', n] : [n])));
}

async function floorItem(ctx, row) {
  const c = floorChanges(row.stats);
  const rooms = await Promise.all(row.rooms.filter((r) => r.id).map(async (r) =>
    h('span', { class: 'room' }, await name(ctx, r.id), r.turns ? ` · ${r.turns} turn${r.turns === 1 ? '' : 's'}` : '')));
  // A shop's cards were for sale, not offered as a reward.
  const shop = row.type === 'shop';
  const offered = c.cardPicked.length || c.cardSkipped.length
    ? h('div', { class: 'change' }, h('span', { class: 'what' }, shop ? 'Shop cards ' : 'Card reward '),
      ...(await Promise.all(c.cardPicked.map((id) => name(ctx, id, 'picked')))).flatMap((n) => [n, ' ']),
      c.cardPicked.length ? '' : h('span', { class: 'sub' }, shop ? 'none bought: ' : 'skipped: '),
      ...(await Promise.all(c.cardSkipped.map((id) => name(ctx, id, 'skipped')))).flatMap((n) => [n, ' ']))
    : null;
  const transformed = await Promise.all(c.transformed.map(async (t) =>
    h('div', { class: 'change' }, h('span', { class: 'what' }, 'Transformed '), await name(ctx, t.from), ' → ', await name(ctx, t.to))));
  return h('li', { class: `floor type-${row.type}`, dataset: { floor: String(row.floor) } },
    h('div', { class: 'floor-head' },
      h('strong', {}, `Floor ${row.floor}`), ` · Act ${row.act} · ${humanizeId(row.type)}`, rooms.length ? ' · ' : '', rooms,
      row.stats ? h('span', { class: 'hp' }, `${row.stats.hp}/${row.stats.max_hp} HP${c.damage ? ` (−${c.damage})` : ''}`) : null),
    offered,
    await line(ctx, 'Gained', c.gained),
    await line(ctx, 'Relic', c.relics),
    await line(ctx, 'Potion', c.potions),
    await line(ctx, 'Upgraded', c.upgraded),
    await line(ctx, 'Removed', c.removed),
    transformed,
    c.rest.length ? h('div', { class: 'change' }, h('span', { class: 'what' }, 'Rest '), c.rest.map(humanizeId).join(', ')) : null,
    await line(ctx, 'Used', c.potionsUsed));
}

export async function renderRunDetail(run, ctx, { player = 1, onPlayer } = {}) {
  if (run?.status !== 'ok') return statusBlock(run);
  const s = run.summary;
  const rows = floorRows(run, player);
  const me = run.players.find((p) => p.player === player) ?? run.players[0];
  const killer = s.killed_by ? await ctx.data.label(s.killed_by) : null;
  const started = Number.isFinite(s.started_at) ? new Date(s.started_at * 1000).toLocaleString() : '';

  return h('div', { class: 'run-detail' },
    h('header', { class: 'run-head' },
      h('h2', {}, `${outcome(s)} · ${s.characters.map(humanizeId).join(' + ')}`),
      h('p', { class: 'sub' }, [started, `${s.floors} floors`, formatDuration(s.run_time), s.ascension ? `Ascension ${s.ascension}` : null,
        killer ? `killed by ${killer.name}` : null, s.build ? `game ${s.build}` : null].filter(Boolean).join(' · '))),
    run.players.length > 1
      ? h('div', { class: 'wiki-bar', role: 'group', 'aria-label': 'Player' }, run.players.map((p) => h('button', {
        type: 'button', class: 'chip', dataset: { player: String(p.player) }, 'aria-pressed': String(p.player === player),
        onclick: () => onPlayer?.(p.player) }, `Player ${p.player} · ${humanizeId(p.character)}${p.player === run.summary?.you ? ' (you)' : ''}`)))
      : null,
    h('section', { class: 'panel' }, h('h3', {}, 'HP by floor'),
      lineChart(hpSeries(rows), { label: `HP by floor for player ${player}`, marks: actMarks(rows) })),
    h('ol', { class: 'timeline' }, await Promise.all(rows.map((r) => floorItem(ctx, r)))),
    h('section', { class: 'panel' }, h('h3', {}, 'Relics'), await relicRow(ctx, me.relics)),
    me.potions?.length ? h('section', { class: 'panel' }, h('h3', {}, 'Potions'), await relicRow(ctx, me.potions, 'potion')) : null,
    h('h3', {}, 'Final deck'),
    deckGrid(groupDeck(await resolveCards(ctx.data, me.deck))));
}
