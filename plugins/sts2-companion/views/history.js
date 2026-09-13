// views/history.js — Run History: finished runs newest first, paged by id; a run's detail; and
// the user's card stats. Everything is read from this computer by the desktop app; nothing is
// uploaded.

import { h, clear } from '../core/dom.js';
import { saves } from '../core/host.js';
import { humanizeId } from '../core/data.js';
import { outcome, formatDuration } from '../core/runs.js';
import { statusBlock } from './status.js';
import { renderRunDetail } from './run-detail.js';
import { renderCardStats } from './card-stats.js';
import { loadArt } from './deck-parts.js';

export const PAGE = 20;
const TABS = [['runs', 'Runs'], ['stats', 'Card stats']];

export async function mountHistory(root, ctx) {
  const state = { tab: 'runs', runs: [], done: false, skipped: 0, failed: null, open: null, player: 1 };
  let alive = true;
  let paints = 0;

  const tabs = h('div', { class: 'wiki-tabs', role: 'tablist' }, TABS.map(([key, label]) =>
    h('button', { type: 'button', class: 'tab', role: 'tab', dataset: { tab: key }, 'aria-selected': String(key === state.tab),
      onclick: () => { state.tab = key; state.open = null; paint(); } }, label)));
  const body = h('div', { class: 'section-body' });
  clear(root).append(h('div', { class: 'section' }, h('div', { class: 'wiki-bar' }, tabs), body));

  /**
   * ⚠️ Rust's `runs` takes `limit` ids, THEN drops unreadable files into `skipped`, and has no
   * cursor past a skipped id. A page with nothing readable returns `runs: []`, which as a cursor
   * would mean "from the top" — so it ends paging instead of looping.
   */
  async function loadPage() {
    const before = state.runs.at(-1)?.id;
    const r = await saves('runs', { limit: PAGE, ...(before ? { before } : {}) });
    if (r?.status !== 'ok') { state.failed = r; state.done = true; return; }
    state.runs.push(...r.runs);
    state.skipped += r.skipped ?? 0;
    state.done = r.runs.length === 0 || r.runs.length + (r.skipped ?? 0) < PAGE;
  }

  async function runRow(s) {
    const killer = s.killed_by ? (await ctx.data.label(s.killed_by)).name : null;
    const date = Number.isFinite(s.started_at) ? new Date(s.started_at * 1000).toLocaleDateString() : '';
    return h('button', { type: 'button', class: `run-row ${s.win ? 'win' : 'loss'}`, dataset: { run: s.id },
      onclick: () => { state.open = s.id; state.player = 1; paint(); } },
    h('strong', {}, outcome(s)), ' ',
    h('span', {}, [s.characters.map(humanizeId).join(' + '), `${s.floors} floors`, s.ascension ? `A${s.ascension}` : null,
      formatDuration(s.run_time), killer ? `killed by ${killer}` : null, date].filter(Boolean).join(' · ')));
  }

  async function paint() {
    const mine = ++paints;
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
    let el;
    if (state.tab === 'stats') {
      el = await renderCardStats(await saves('profileStats'), ctx);
    } else if (state.open) {
      const detail = await renderRunDetail(await saves('run', { id: state.open }), ctx,
        { player: state.player, onPlayer: (n) => { state.player = n; paint(); } });
      el = h('div', {}, h('button', { type: 'button', class: 'tab back', dataset: { act: 'back' }, onclick: () => { state.open = null; paint(); } }, '← All runs'), detail);
    } else {
      if (!state.runs.length && !state.done) await loadPage();
      if (state.failed) el = statusBlock(state.failed);
      else if (!state.runs.length) el = h('p', { class: 'empty' }, state.skipped ? 'Your finished runs could not be read.' : 'No finished runs yet.');
      else {
        el = h('div', { class: 'run-list' },
          await Promise.all(state.runs.map(runRow)),
          state.skipped ? h('p', { class: 'sub' }, 'Some runs could not be read — most likely saved by a different game version.') : null,
          state.done ? null : h('button', { type: 'button', class: 'chip', dataset: { act: 'more' }, onclick: async () => { await loadPage(); paint(); } }, 'Load more'));
      }
    }
    if (!alive || mine !== paints) return;
    clear(body).append(el);
    loadArt(body, ctx);
  }

  await paint();
  return { destroy() { alive = false; ctx.art.releaseAll(); } };
}
