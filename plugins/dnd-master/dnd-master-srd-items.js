// dnd-master-srd-items.js — the SRD's magic items in the Items tab, for the table's rules (Table rules → Rules: 2014 =
// SRD 5.1, 2024 = SRD 5.2.1; lk-srd-edition.js). Folded away until the DM opens it; "+ Add" puts one in the campaign's
// items the way a book's item arrives (dnd-master-main.js addSrdItem → addBookItem). The search redraws the list only.
import { esc } from '../plugin-sdk.js';
import { loadSrd, browsable } from './lk-srd-edition.js';
import { rulesEdition } from './lk-table-rules.js';

let _items = [], _edition = null, _open = false, _query = '';

/** The edition's items, loaded once per edition. */
export async function loadSrdItems(settings) {
  const ed = rulesEdition(settings);
  if (ed === _edition) return;
  _items = await loadSrd(new URL('./dnd-srd/', document.baseURI).href, 'magic-items', ed);
  _edition = ed;
}

/** The SRD item `id` of the table's edition (or, saved under the other rules, the other's). */
export const srdItem = id => _items.find(x => x.id === id) || null;

/** The items whose name holds `q`, A–Z. Pure. */
export function matchItems(items, q) {
  const s = String(q || '').trim().toLowerCase();
  return browsable(items).filter(x => !s || x.name.toLowerCase().includes(s))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The folded section, for the Items tab; `have` = the ids already in the campaign. */
export function srdItemsHtml(have) {
  const n = browsable(_items).length;
  const head = '<button onclick="toggleSrdItems()" aria-expanded="' + _open + '" style="display:flex;width:100%;align-items:center;' +
    'justify-content:space-between;background:none;border:none;padding:0;margin:10px 0 6px;cursor:pointer;color:var(--gold);' +
    'font-size:11px;font-weight:700;letter-spacing:.05em">SRD MAGIC ITEMS (' + esc(_edition || '2014') + ' rules) <span>' +
    n + ' ' + (_open ? '▲' : '▼') + '</span></button>';
  if (!_open) return head;
  return head + '<input id="srd-item-search" type="search" placeholder="Search SRD items…" aria-label="Search SRD items" value="' +
    esc(_query) + '" oninput="srdItemSearch(this.value)" style="width:100%;margin-bottom:6px;font-size:11px">' +
    '<div id="srd-item-list">' + _list(have) + '</div>';
}

let _have = new Set();
function _list(have) {
  if (have) _have = new Set(have);
  const found = matchItems(_items, _query), shown = found.slice(0, 40);
  if (!shown.length) return '<div style="font-size:11px;color:var(--muted);text-align:center;padding:8px">No items match</div>';
  return shown.map(x => '<div class="item-row" title="' + esc(String(x.desc || '').slice(0, 400)) + '">' +
    '<span style="flex:1;font-size:11px;font-weight:600">' + esc(x.name) +
      ' <span style="font-weight:400;color:var(--muted);font-size:10px">' + esc(String(x.rarity || '').toLowerCase()) +
      (x.requires_attunement ? ' · attunement' : '') + '</span></span>' +
    (_have.has(x.id)
      ? '<span style="font-size:10px;color:var(--muted)">added</span>'
      : '<button class="btn btn-ghost" onclick="addSrdItem(\'' + esc(x.id) + '\')" style="font-size:10px;padding:2px 8px">+ Add</button>') +
  '</div>').join('') + (found.length > shown.length
    ? '<div style="font-size:10px;color:var(--muted);text-align:center;padding:4px">' + (found.length - shown.length) + ' more: search to narrow</div>' : '');
}

export function toggleSrdItems() { _open = !_open; }
export function srdItemSearch(q) {
  _query = q || '';
  const el = document.getElementById('srd-item-list');
  if (el) el.innerHTML = _list();
}
