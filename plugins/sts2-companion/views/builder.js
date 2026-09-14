// views/builder.js — named archetypes per character: a deck built from the bundled cards, its
// curve and coverage, and a comparison with the run in progress. Works on web; only Compare needs
// the desktop app.

import { h, clear, append } from '../core/dom.js';
import { store, saves } from '../core/host.js';
import { filterItems } from '../core/search.js';
import { createArchetypes, newArchetypeId } from '../core/archetypes.js';
import { resolveCards, groupDeck, keywordCoverage, compareCoverage, characterColor, defaultPlayer } from '../core/deck.js';
import { humanizeId } from '../core/data.js';
import { deckGrid, curvePanel, coveragePanel, loadArt } from './deck-parts.js';
import { statusBlock } from './status.js';

export const CHARACTERS = ['ironclad', 'silent', 'defect', 'regent', 'necrobinder'];
const RESULTS = 24;

export async function mountBuilder(root, ctx) {
  const archetypes = createArchetypes(store);
  const state = { character: CHARACTERS[0], current: null, q: '', compare: null, confirmDelete: false, refocus: false };
  let alive = true;

  // ⚠️ The node allows 60 personal-storage writes a minute per user (router.go). Edits repaint at
  // once and are written after a pause, so building a deck click by click costs a few writes.
  const delay = ctx.saveDelayMs ?? 800;
  let pending = null;
  let timer = null;
  async function flush() {
    clearTimeout(timer);
    timer = null;
    const arch = pending;
    pending = null;
    if (arch) await archetypes.save(arch);
  }
  function persist() {
    pending = state.current;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
    return paint();
  }

  const matches = (row) => (c) => c.id === row.card.id && (c.upgrades ?? 0) === row.upgrades;

  function tileActions(row) {
    const cards = state.current.cards;
    return h('span', { class: 'tile-actions' },
      h('button', { type: 'button', class: 'chip', dataset: { act: 'remove' }, 'aria-label': `Remove one ${row.card.name}`,
        onclick: () => { const i = cards.findIndex(matches(row)); if (i >= 0) cards.splice(i, 1); persist(); } }, '−'),
      h('button', { type: 'button', class: 'chip', dataset: { act: 'upgrade' }, 'aria-pressed': String(row.upgrades > 0),
        onclick: () => { const c = cards.find(matches(row)); if (c) c.upgrades = c.upgrades ? 0 : 1; persist(); } }, 'Upgraded'));
  }

  async function comparison(entries) {
    if (!state.compare) return h('div', { class: 'panels' }, curvePanel(entries), coveragePanel(keywordCoverage(entries)));
    if (state.compare.status !== 'ok') {
      return h('div', {}, statusBlock(state.compare), h('div', { class: 'panels' }, curvePanel(entries), coveragePanel(keywordCoverage(entries))));
    }
    const player = state.compare.players.find((p) => p.player === defaultPlayer(state.compare)) ?? state.compare.players[0];
    const run = await resolveCards(ctx.data, player.deck);
    const other = characterColor(player.character) !== state.current.character
      ? h('p', { class: 'sub' }, `Your current run is ${humanizeId(player.character)}.`) : null;
    return h('div', {}, other, h('div', { class: 'panels' },
      curvePanel(entries, 'This archetype'), curvePanel(run, 'Current run'),
      coveragePanel(compareCoverage(keywordCoverage(entries), keywordCoverage(run)), { a: 'Archetype', b: 'Current run' })));
  }

  async function editor() {
    const arch = state.current;
    const entries = await resolveCards(ctx.data, arch.cards);
    const pool = (await ctx.data.list('card')).filter((c) => c.color === arch.character || c.color === 'colorless');

    const results = h('div', { class: 'picker-results' });
    const search = h('input', { type: 'search', placeholder: 'Add a card…', 'aria-label': 'Add a card', value: state.q });
    const showResults = () => {
      const found = state.q.trim() ? filterItems(pool, { q: state.q }).slice(0, RESULTS) : [];
      append(clear(results), found.map((c) => h('button', { type: 'button', class: 'chip', dataset: { add: c.id },
        onclick: () => { arch.cards.push({ id: c.id, upgrades: 0 }); state.refocus = true; persist(); } }, `+ ${c.name}`)));
    };
    search.addEventListener('input', () => { state.q = search.value; showResults(); });
    showResults();
    if (state.refocus) { state.refocus = false; queueMicrotask(() => search.focus()); }

    const del = h('button', { type: 'button', class: 'chip', dataset: { act: 'delete' },
      onclick: async () => {
        if (!state.confirmDelete) { state.confirmDelete = true; await paint(); return; }
        pending = null;
        await archetypes.remove(arch.id);
        Object.assign(state, { current: null, confirmDelete: false, compare: null });
        await paint();
      } }, state.confirmDelete ? 'Really delete?' : 'Delete');

    return h('div', { class: 'arch-editor' },
      h('div', { class: 'wiki-bar' }, h('h2', {}, `${arch.name} · ${entries.length} cards`),
        h('button', { type: 'button', class: 'chip', dataset: { act: 'compare' }, onclick: async () => { state.compare = await saves('currentRun'); await paint(); } }, 'Compare with current run'),
        del),
      h('div', { class: 'wiki-bar' }, search), results,
      await comparison(entries),
      entries.length ? deckGrid(groupDeck(entries), { actions: tileActions }) : h('p', { class: 'empty' }, 'Search above to add cards.'));
  }

  async function paint() {
    if (!alive) return;
    const list = await archetypes.list(state.character);
    const name = h('input', { type: 'text', maxlength: 60, placeholder: 'New archetype name', 'aria-label': 'New archetype name' });
    const createIt = async () => {
      await flush();
      Object.assign(state, { current: await archetypes.save({ id: newArchetypeId(), name: name.value, character: state.character, cards: [] }), compare: null, confirmDelete: false });
      await paint();
    };
    // ⚠️ No <form>: the plugin CSP sets form-action 'none'. Enter is handled by hand.
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') createIt(); });

    const view = h('div', { class: 'builder' },
      h('div', { class: 'wiki-bar' },
        h('select', { 'aria-label': 'Character', onchange: async (e) => { await flush(); Object.assign(state, { character: e.target.value, current: null, compare: null, confirmDelete: false }); paint(); } },
          CHARACTERS.map((c) => h('option', { value: c, selected: c === state.character }, humanizeId(c)))),
        name, h('button', { type: 'button', class: 'chip', dataset: { act: 'create' }, onclick: createIt }, 'Create')),
      h('div', { class: 'wiki-bar arch-list' }, list.map((a) => h('button', { type: 'button', class: 'chip', dataset: { arch: a.id }, 'aria-pressed': String(state.current?.id === a.id),
        onclick: async () => { await flush(); Object.assign(state, { current: await archetypes.get(a.id), compare: null, confirmDelete: false }); await paint(); } }, a.name))),
      state.current ? await editor()
        : h('p', { class: 'empty' }, list.length ? 'Pick an archetype, or name a new one.' : `No ${humanizeId(state.character)} archetypes yet. Name one to start.`));
    if (!alive) return;
    clear(root).append(view);
    loadArt(root, ctx);
  }

  await paint();
  return { destroy() { alive = false; return flush(); } };
}
