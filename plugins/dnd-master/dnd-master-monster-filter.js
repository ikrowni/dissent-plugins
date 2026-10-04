// dnd-master-monster-filter.js — search, filter and sort for the DM's monster lists (Monsters and Encounter tabs).
// Pure: no DOM. The filter bar's HTML is built here too so both tabs show the same controls (owner request
// 2026-10-04: filter by CR, type, alphabetical, HP).
import { esc } from '../plugin-sdk.js';

export const CR_STEPS = [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

/** A CR as a number: SRD monsters carry 0.25, books and custom NPCs carry "1/4". Unknown → null. */
export function crValue(cr) {
  if (typeof cr === 'number') return Number.isFinite(cr) ? cr : null;
  const s = String(cr ?? '').trim();
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;
}

export const crLabel = v => v === 0.125 ? '1/8' : v === 0.25 ? '1/4' : v === 0.5 ? '1/2' : String(v);

/** One word a DM would filter by: "humanoid (goblinoid)" → humanoid, "swarm of Tiny beasts" → swarm. */
export function typeOf(m) {
  const t = String(m?.type || '').toLowerCase().replace(/\(.*\)/, '').trim();
  return t.startsWith('swarm') ? 'swarm' : t;
}

/** Where a creature came from: the DM's own NPCs, a book, or the SRD. */
export const sourceOf = m => m?._isCustom ? 'custom' : m?.source?.title ? 'book' : 'srd';

export const typesIn = list => [...new Set(list.map(typeOf).filter(Boolean))].sort();

export const DEFAULT_FILTER = Object.freeze({ q: '', type: '', crMin: '', crMax: '', source: '', sort: 'name' });

const SORTS = {
  name:     (a, b) => a.name.localeCompare(b.name),
  'cr':     (a, b) => (crValue(a.cr) ?? -1) - (crValue(b.cr) ?? -1) || a.name.localeCompare(b.name),
  'cr-desc':(a, b) => (crValue(b.cr) ?? -1) - (crValue(a.cr) ?? -1) || a.name.localeCompare(b.name),
  'hp':     (a, b) => (Number(a.hp) || 0) - (Number(b.hp) || 0) || a.name.localeCompare(b.name),
  'hp-desc':(a, b) => (Number(b.hp) || 0) - (Number(a.hp) || 0) || a.name.localeCompare(b.name),
};

/** Every creature in `list` that passes `f`, sorted. A creature with no known CR is dropped only by a CR bound. */
export function applyFilter(list, f = DEFAULT_FILTER) {
  const q = String(f.q || '').trim().toLowerCase();
  const min = f.crMin === '' || f.crMin == null ? null : Number(f.crMin);
  const max = f.crMax === '' || f.crMax == null ? null : Number(f.crMax);
  const out = list.filter(m => {
    if (q && !String(m.name || '').toLowerCase().includes(q)) return false;
    if (f.type && typeOf(m) !== f.type) return false;
    if (f.source && sourceOf(m) !== f.source) return false;
    if (min != null || max != null) {
      const cr = crValue(m.cr);
      if (cr == null || (min != null && cr < min) || (max != null && cr > max)) return false;
    }
    return true;
  });
  return out.sort(SORTS[f.sort] || SORTS.name);
}

const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(label) + '</option>';
const sel = (prefix, key, title, opts) =>
  '<select class="search-input mf-sel" title="' + title + '" onchange="monsterFilterSet(\'' + prefix + '\',\'' + key + '\',this.value)">' + opts + '</select>';

/** The controls under a search box. `prefix` names the tab ('mon' | 'enc'); `hasCustom` shows the source choice. */
export function filterBarHtml(prefix, f, types, { hasCustom = false, hasBook = false } = {}) {
  const crOpts = (cur, word) => CR_STEPS.map(v => opt(v, word + ' CR ' + crLabel(v), cur)).join('');
  const sources = [['', 'All sources'], ['srd', 'Rules (SRD)']];
  if (hasBook) sources.push(['book', 'From books']);
  if (hasCustom) sources.push(['custom', 'My NPCs & creatures']);
  return '<div class="mf-bar">' +
    sel(prefix, 'type', 'Type', opt('', 'All types', f.type) + types.map(t => opt(t, t[0].toUpperCase() + t.slice(1), f.type)).join('')) +
    sel(prefix, 'sort', 'Sort', opt('name', 'A–Z', f.sort) + opt('cr', 'CR ↑', f.sort) + opt('cr-desc', 'CR ↓', f.sort) +
      opt('hp', 'HP ↑', f.sort) + opt('hp-desc', 'HP ↓', f.sort)) +
    sel(prefix, 'crMin', 'Lowest CR', opt('', 'Any lowest CR', f.crMin) + crOpts(f.crMin, 'From')) +
    sel(prefix, 'crMax', 'Highest CR', opt('', 'Any highest CR', f.crMax) + crOpts(f.crMax, 'To')) +
    (sources.length > 2 ? sel(prefix, 'source', 'Source', sources.map(([v, l]) => opt(v, l, f.source)).join('')) : '') +
    (isFiltered(f) ? '<button class="mf-clear" onclick="monsterFilterClear(\'' + prefix + '\')">Clear filters</button>' : '') +
  '</div>';
}

export const isFiltered = f => !!(f.type || f.crMin !== '' || f.crMax !== '' || f.source || f.sort !== 'name');

/** "Showing 40 of 112" when the list is cut short, so a DM knows to narrow it. */
export const moreLine = (shown, total) => total > shown
  ? '<div style="font-size:10px;color:var(--muted);padding:4px 8px">Showing ' + shown + ' of ' + total + ' — search or filter to narrow it.</div>'
  : '';

// ── Each tab's filter, kept for the session (switching tabs keeps it) ─────────────────────────────────────────────
const _filters = {};
const _redraw = {};
export const getFilter = prefix => (_filters[prefix] ||= { ...DEFAULT_FILTER });
/** `redraw()` draws the tab's filter bar and list again; typing in the search box does not call it. */
export function onFilterChange(prefix, redraw) { _redraw[prefix] = redraw; }
export function monsterFilterSet(prefix, key, value) {
  if (!(key in DEFAULT_FILTER)) return;
  getFilter(prefix)[key] = value;
  _redraw[prefix]?.();
}
export function monsterFilterClear(prefix) {
  _filters[prefix] = { ...DEFAULT_FILTER, q: getFilter(prefix).q };
  _redraw[prefix]?.();
}
