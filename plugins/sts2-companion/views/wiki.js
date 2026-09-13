// views/wiki.js — the Wiki: tabs, filters, search, grid. Detail pages: wiki-detail.js.

import { h, clear } from '../core/dom.js';
import { filterItems } from '../core/search.js';
import { renderDetail, removeTips } from './wiki-detail.js';

const TABS = [
  { key: 'cards', kind: 'card', label: 'Cards', art: 'card', icon: false },
  { key: 'relics', kind: 'relic', label: 'Relics', art: 'relic', icon: true },
  { key: 'potions', kind: 'potion', label: 'Potions', art: 'potion', icon: true },
  { key: 'powers', kind: 'power', label: 'Keywords & Powers', art: 'power', icon: true },
  { key: 'monsters', kind: 'monster', label: 'Enemies', art: 'monster', icon: false },
  { key: 'events', kind: 'event', label: 'Events', art: null, icon: true },
];
const COLORS = ['ironclad', 'silent', 'defect', 'regent', 'necrobinder', 'colorless', 'curse', 'status'];

export async function mountWiki(root, ctx) {
  const state = { tab: 'cards', q: '', color: '', type: '', rarity: '', cost: '', trail: [] };
  let observer = null;

  const input = h('input', { type: 'search', placeholder: 'Search cards, relics, enemies…', 'aria-label': 'Search' });
  const filters = h('span', { class: 'filters' });
  const tabs = h('div', { class: 'wiki-tabs', role: 'tablist' },
    TABS.map((t) => h('button', { type: 'button', class: 'tab', role: 'tab', dataset: { tab: t.key }, 'aria-selected': String(t.key === state.tab),
      onclick: () => { state.tab = t.key; state.trail = []; syncTabs(); paint(); } }, t.label)));
  const body = h('div', { class: 'wiki-body' });
  const bar = h('div', { class: 'wiki-bar' }, input, filters);
  clear(root).append(h('div', { class: 'wiki' }, h('div', { class: 'wiki-bar' }, tabs), bar, body));

  input.addEventListener('input', () => { state.q = input.value; state.trail = []; paint(); });

  const select = (label, key, options) => h('select', { 'aria-label': label,
    onchange: (e) => { state[key] = e.target.value; paint(); } },
    h('option', { value: '' }, label), options.map((o) => h('option', { value: String(o) }, String(o))));

  function syncTabs() {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
    clear(filters);
    if (state.tab === 'cards') {
      state.color = state.type = state.rarity = state.cost = '';
      filters.append(
        select('Character', 'color', COLORS),
        select('Type', 'type', ['Attack', 'Skill', 'Power', 'Status', 'Curse']),
        select('Rarity', 'rarity', ['Basic', 'Common', 'Uncommon', 'Rare', 'Ancient']),
        select('Cost', 'cost', [0, 1, 2, 3]),
      );
    }
  }

  const tile = (tab, item) => {
    const img = h('img', { alt: item.name, loading: 'lazy', decoding: 'async' });
    const ph = h('span', { class: 'ph' });
    const el = h('button', { type: 'button', class: `tile${tab.icon ? ' icon' : ''}`, dataset: { id: item.id },
      onclick: () => open({ kind: tab.kind, id: item.id }) },
      tab.art ? ph : null, h('span', { class: 'label' }, item.name));
    if (tab.art) {
      el.dataset.art = `${tab.art}:${item.id}`;
      el._img = img;
      el._ph = ph;
    }
    return el;
  };

  // Images load only when their tile scrolls near the viewport — only visible packs download.
  function watch(grid) {
    observer?.disconnect();
    const load = async (el) => {
      const url = await ctx.art.url(el.dataset.art);
      if (url && el._ph.isConnected) { el._img.src = url; el._ph.replaceWith(el._img); }
    };
    if (typeof IntersectionObserver === 'undefined') {
      for (const el of grid.querySelectorAll('[data-art]')) load(el);
      return;
    }
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); load(e.target); }
    }, { rootMargin: '400px' });
    for (const el of grid.querySelectorAll('[data-art]')) observer.observe(el);
  }

  async function open(ref) {
    state.trail.push(ref);
    await paint();
  }

  async function paint() {
    removeTips();
    const tab = TABS.find((t) => t.key === state.tab);
    if (state.trail.length) {
      const ref = state.trail[state.trail.length - 1];
      clear(body).append(
        h('button', { type: 'button', class: 'tab back', onclick: () => { state.trail.pop(); paint(); } }, '← Back'),
        await renderDetail(ref, { ...ctx, open }),
      );
      return;
    }
    const items = filterItems(await ctx.data.list(tab.kind), state);
    if (!items.length) {
      clear(body).append(h('p', { class: 'empty' }, 'Nothing matches that search.'));
      return;
    }
    const grid = h('div', { class: 'grid' }, items.map((it) => tile(tab, it)));
    clear(body).append(grid);
    watch(grid);
  }

  syncTabs();
  await paint();

  return {
    destroy() {
      removeTips();
      observer?.disconnect();
      ctx.art.releaseAll();
    },
  };
}
