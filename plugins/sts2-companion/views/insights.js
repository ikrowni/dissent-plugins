// views/insights.js — the user's own figures: where runs end, how build types do, and which picks go
// with winning. Read from this computer's saves by the desktop app; nothing is uploaded.

import { h, clear } from '../core/dom.js';
import { saves, local } from '../core/host.js';
import { humanizeId } from '../core/data.js';
import { loadDigests } from '../core/digestStore.js';
import { insights } from '../core/insights.js';
import { barChart } from '../core/chart.js';
import { statusBlock } from './status.js';

export const CHARACTERS = ['CHARACTER.IRONCLAD', 'CHARACTER.SILENT', 'CHARACTER.DEFECT', 'CHARACTER.NECROBINDER', 'CHARACTER.REGENT'];
const TOP_ENCOUNTERS = 10;
const TOP_CARDS = 15;

const pct = (v) => `${Math.round(v * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A rate as text: "30% (11–60%, n=10)", "— (n=3)" under the minimum. */
export function rateText(r) {
  if (r.rate == null) return `— (n=${r.n})`;
  return `${pct(r.rate)} (${pct(r.low)}–${pct(r.high)}, n=${r.n})`;
}

const rateCell = (r) => h('td', { class: r.lowSample ? 'low-sample' : null, title: r.lowSample ? 'Few runs — treat with care' : null }, rateText(r));

export async function mountInsights(root, ctx) {
  const state = { character: null, digests: null, status: 'ok', progress: null };
  let alive = true;
  let loads = 0;
  let paints = 0; // as views/history.js: a slower paint must not overwrite a newer one

  const filters = h('div', { class: 'wiki-tabs', role: 'group', 'aria-label': 'Character' },
    [null, ...CHARACTERS].map((id) => h('button', {
      type: 'button', class: 'tab', dataset: { character: id ?? 'all' }, 'aria-pressed': String(id === state.character),
      onclick: () => { state.character = id; paint(); },
    }, id ? humanizeId(id) : 'All')));
  const body = h('div', { class: 'section-body insights' });
  clear(root).append(h('div', { class: 'section' }, h('div', { class: 'wiki-bar' }, filters), body));

  async function load() {
    const mine = ++loads;
    state.progress = { done: 0, total: 0 };
    paint();
    const r = await loadDigests({
      saves, local, data: ctx.data,
      onProgress: (p) => { if (alive && mine === loads) { state.progress = p; paint(); } },
    });
    if (!alive || mine !== loads) return;
    state.progress = null;
    state.status = r.status;
    state.digests = r.status === 'ok' ? r.digests : null;
    await paint();
  }

  async function encounterTable(list) {
    const shown = list.filter((e) => e.deaths > 0).slice(0, TOP_ENCOUNTERS);
    if (!shown.length) return h('p', { class: 'empty' }, 'No run has ended in a fight yet.');
    const rows = await Promise.all(shown.map(async (e) => h('tr', { dataset: { encounter: e.id } },
      h('th', { scope: 'row' }, (await ctx.data.label(e.id)).name),
      h('td', {}, String(e.fought)), h('td', {}, String(e.deaths)), rateCell(e.rate))));
    return h('div', { class: 'table-wrap' }, h('table', { class: 'stats' },
      h('thead', {}, h('tr', {}, ['Encounter', 'Fought', 'Ended runs', 'Death rate'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows)));
  }

  function buildTable(r) {
    if (!r.soloRuns) return h('p', { class: 'empty' }, 'Build types come from solo runs — a co-op save cannot say which deck was yours.');
    return h('div', { class: 'table-wrap' }, h('table', { class: 'stats' },
      h('thead', {}, h('tr', {}, ['Build', 'Runs', 'Wins', 'Win rate', 'Median floor'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, r.buildTypes.map((b) => h('tr', { dataset: { build: b.label } },
        h('th', { scope: 'row' }, b.label), h('td', {}, String(b.runs)), h('td', {}, String(b.wins)),
        rateCell(b.rate), h('td', {}, b.medianFloor == null ? '—' : String(b.medianFloor)))))));
  }

  async function cardTable(r) {
    if (!r.soloRuns) return h('p', { class: 'empty' }, 'Card picks come from solo runs — a co-op save cannot say which picks were yours.');
    const shown = r.cards.filter((c) => c.impact != null).slice(0, TOP_CARDS);
    if (!shown.length) return h('p', { class: 'empty' }, 'Not enough picks yet: a card needs 5 runs picking it and 5 skipping it.');
    const rows = await Promise.all(shown.map(async (c) => h('tr', { dataset: { card: c.id } },
      h('th', { scope: 'row' }, (await ctx.data.label(c.id)).name),
      h('td', {}, String(c.offered)), h('td', {}, String(c.picked)),
      rateCell(c.pickedRate), rateCell(c.skippedRate),
      h('td', {}, `${c.impact >= 0 ? '+' : '−'}${Math.round(Math.abs(c.impact) * 100)} pts`))));
    return h('div', {},
      h('p', { class: 'sub' }, 'Wins when picked against wins when skipped. It shows what went together, not what caused what.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'stats' },
        h('thead', {}, h('tr', {}, ['Card', 'Offered', 'Picked', 'Win rate picked', 'Win rate skipped', 'Difference'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows))));
  }

  async function paint() {
    const mine = ++paints;
    for (const b of filters.children) b.setAttribute('aria-pressed', String((b.dataset.character === 'all' ? null : b.dataset.character) === state.character));
    let el;
    if (state.progress) {
      el = h('p', { class: 'empty' }, state.progress.total
        ? `Reading your runs… ${state.progress.done} of ${state.progress.total}`
        : 'Reading your runs…');
    } else if (state.status !== 'ok') {
      el = statusBlock({ status: state.status });
    } else {
      const r = insights(state.digests ?? [], { character: state.character });
      el = h('div', {},
        h('p', { class: 'sub', dataset: { part: 'summary' } },
          `${plural(r.runs, 'run', 'runs')} · ${plural(r.wins, 'win', 'wins')} · ${r.soloRuns} solo · ${r.coopRuns} co-op`),
        h('section', { class: 'panel', dataset: { part: 'survival' } },
          h('h3', {}, 'Where runs end'),
          barChart(r.floorBuckets, { label: 'Floor reached' }),
          await encounterTable(r.encounters),
          r.damageByAct.length
            ? h('p', { class: 'sub' }, r.damageByAct.map((a) => `Act ${a.act}: ${a.mean} damage taken on average (n=${a.n})`).join(' · '))
            : null),
        h('section', { class: 'panel', dataset: { part: 'builds' } }, h('h3', {}, 'Build types'), buildTable(r)),
        h('section', { class: 'panel', dataset: { part: 'cards' } }, h('h3', {}, 'Card picks'), await cardTable(r)));
    }
    if (!alive || mine !== paints) return;
    clear(body).append(el);
  }

  const off = ctx.onSavesChanged(() => { load(); });
  await load();
  return { destroy() { alive = false; off(); } };
}
