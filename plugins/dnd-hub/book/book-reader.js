// book-reader.js — the DM's Book panel in a campaign (plan 2026-10-04 book import, stage C): read the story and
// share a section with the players (it becomes a shared journal page and pops up over their map), add a book
// monster to the encounter (the DM sidebar's builder), add a book item to the campaign's items. Also sends the
// campaign's book monsters to the DM sidebar, which cannot read the Hub's library itself.
import { esc, localPublish, requestWithTransfer } from '../../plugin-sdk.js';
import { realtimePublish } from '../dnd-hub-publish.js';
import { icon } from '../lk-icons.js';
import { MAP, serverData, userId } from '../dnd-hub-state.js?v=20261014b';
import { saveHubDm } from '../dnd-hub-storage.js?v=20261014b';
import { EV } from '../dnd-hub-event-types.js?v=20261014b';
import { campaignBooks, listBooks, attachBook, loadBookPicture } from './book-library.js';
import { addMapFromBuffer } from '../dnd-hub-map-bg.js?v=20261014b';
import { showHandoutOverlay } from '../dnd-hub-pins.js?v=20261014b';
import { guarded } from '../lk-upload.js';
import { guide } from '../lk-guide-ui.js';

let R = null; // { books, book, tab, section, monster, q, library }
const camp = () => serverData?.campaigns?.[MAP.campaignId];

/** Tell this screen's DM sidebar which monsters the campaign's books add. Quiet when there are none. */
export async function sendBookMonsters(campaignId) {
  const c = serverData?.campaigns?.[campaignId];
  if (!c || c.dmUserId !== userId) return;
  const books = Object.keys(c.bookFiles || {}).length ? await campaignBooks(c).catch(() => []) : [];
  localPublish('dnd-master', EV.BOOK_MONSTERS, { type: EV.BOOK_MONSTERS, campaignId, monsters: books.flatMap(b => b.monsters || []) });
}

export async function toggleBookPanel() {
  const old = document.getElementById('book-panel');
  if (old) { old.remove(); R = null; return; }
  const el = document.createElement('div');
  el.id = 'book-panel'; el.className = 'bk-panel';
  document.getElementById('map-root')?.appendChild(el);
  R = { books: null, book: 0, tab: 'story', section: null, monster: null, q: '', library: null };
  draw();
  R.books = await campaignBooks(camp()).catch(() => []);
  if (!R.books.length) R.library = await listBooks().catch(() => ({ books: [] }));
  R.section = R.books[0]?.story?.[0]?.id || null;
  draw();
  if (R.books.length) setTimeout(() => guide('dm:book'), 400);
}

const shared = sid => Object.values(camp()?.journals || {}).some(j => j.source?.section === sid);

function draw() {
  const el = document.getElementById('book-panel');
  if (!el || !R) return;
  const head = `<div class="bk-panel-head">${icon('book-open', { size: 16 })}<span class="lk-title">Book</span>
    <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="toggleBookPanel()" aria-label="Close">${icon('x', { size: 14 })}</button></div>`;
  if (R.books == null) { el.innerHTML = head + '<div class="bk-empty">Opening the book…</div>'; return; }
  if (!R.books.length) {
    const lib = R.library?.books || [];
    el.innerHTML = head + `<div class="bk-panel-body"><p class="bk-help">This campaign uses no book yet. A book brings its
      monsters into your encounter builder, its story here to read and share, and its spells and items to your players.</p>
      ${lib.map(b => `<button class="bk-pick" onclick="bookUseHere('${esc(b.fileId)}')"><b>${esc(b.title)}</b><span>Use in this campaign</span></button>`).join('')}
      <button class="btn btn-gold" style="margin-top:10px" onclick="showLibrary()">${lib.length ? 'Import another book' : 'Import a book'}</button></div>`;
    return;
  }
  const b = R.books[R.book] || R.books[0];
  const tabs = [['story', 'Story', b.story.length], ['images', 'Maps & art', (b.images || []).length], ['monsters', 'Monsters', b.monsters.length], ['items', 'Items', b.items.length]];
  el.innerHTML = head + `
    ${R.books.length > 1 ? `<div class="bk-books">${R.books.map((x, i) => `<button aria-pressed="${i === R.book}" onclick="bookPanelBook(${i})">${esc(x.title)}</button>`).join('')}</div>` : `<div class="bk-panel-title">${esc(b.title)}</div>`}
    <div class="bk-tabs small">${tabs.map(([k, l, n]) => `<button aria-selected="${R.tab === k}" ${n ? '' : 'disabled'} onclick="bookPanelTab('${k}')">${l} <span>${n}</span></button>`).join('')}</div>
    <div class="bk-panel-body">${R.tab === 'story' ? storyView(b) : R.tab === 'images' ? picturesView(b) : R.tab === 'monsters' ? listView(b.monsters, 'monster') : listView(b.items, 'item')}</div>`;
}

function storyView(b) {
  const s = b.story.find(x => x.id === R.section) || b.story[0];
  let chapter = null;
  const toc = b.story.map(x => {
    const head = x.chapter !== chapter ? `<div class="bk-toc-ch">${esc(x.chapter || 'Introduction')}</div>` : '';
    chapter = x.chapter;
    return head + (x.title !== x.chapter ? `<button class="bk-toc-s" aria-current="${x.id === s?.id}" onclick="bookPanelSection('${esc(x.id)}')">${esc(x.title)}${shared(x.id) ? ' <span title="Shared with the players">✓</span>' : ''}</button>`
      : `<button class="bk-toc-s top" aria-current="${x.id === s?.id}" onclick="bookPanelSection('${esc(x.id)}')">Opening${shared(x.id) ? ' <span>✓</span>' : ''}</button>`);
  }).join('');
  return `<div class="bk-reader"><nav class="bk-toc">${toc}</nav>
    <article class="bk-page">${s ? `<h3>${esc(s.title)}</h3><div class="bk-story">${s.html}</div>
      <div class="bk-page-actions"><button class="btn btn-gold btn-sm" onclick="bookShareSection('${esc(s.id)}')">${shared(s.id) ? 'Show the players again' : 'Share with the players'}</button>
      <span>${shared(s.id) ? 'In the party journal.' : 'It goes to the party journal and pops up on their map.'}</span></div>` : ''}</article></div>`;
}

function listView(list, kind) {
  const q = R.q.toLowerCase();
  const shown = list.filter(e => !q || e.name.toLowerCase().includes(q)).slice(0, 200);
  const sel = kind === 'monster' ? R.monster : R.item;
  return `<input type="search" class="bk-search" placeholder="Search…" value="${esc(R.q)}" oninput="bookPanelFilter(this.value)" aria-label="Search">
    <div class="bk-rows">${shown.map(e => `<div class="bk-row ${sel === e.id ? 'open' : ''}">
      <button class="bk-row-head plain" onclick="bookPanelOpen('${kind}','${esc(e.id)}')"><b>${esc(e.name)}</b>
        <span>${kind === 'monster' ? `CR ${e.cr ?? '?'} · ${esc(e.type || '')} · ${e.hp ?? '?'} HP` : esc(`${e.category || ''}, ${String(e.rarity || '').toLowerCase()}`)}</span></button>
      ${sel === e.id ? `<div class="bk-preview">${kind === 'monster'
        ? `<p><b>AC</b> ${e.ac} · <b>HP</b> ${e.hp} (${esc(e.hp_dice || '')}) · ${['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => `<b>${a.toUpperCase()}</b> ${e[a]}`).join(' ')}</p>
           ${(e.actions || []).slice(0, 4).map(a => `<p><b><i>${esc(a.name)}.</i></b> ${esc(a.desc.slice(0, 200))}</p>`).join('')}
           <button class="btn btn-gold btn-sm" onclick="bookAddMonster('${esc(e.id)}')">Add to the encounter</button>`
        : `<p>${esc(e.desc.slice(0, 600)).replace(/\n/, '<br>')}</p>
           <button class="btn btn-gold btn-sm" onclick="bookAddItem('${esc(e.id)}')">${camp()?.items?.[e.id] ? 'In your items ✓' : 'Add to your items'}</button>`}</div>` : ''}</div>`).join('')}</div>`;
}

// ── Maps & art ───────────────────────────────────────────────────────────────────────────────────────────────
const _thumbs = new Map(); // picture file id → object URL (this session)
// A picture from a PDF is known by its page; a loose one (a card deck, a handout folder) by its set and name.
const picLabel = p => (p.page ? `page ${p.page}` : [p.group, p.title].filter(Boolean).join(' · ') || 'picture');
function picturesView(b) {
  // The book's own pictures first, then each set (folder) under its name: a 40-card deck stays together.
  const pics = [...(b.images || [])].sort((x, y) => (x.page ? 0 : 1) - (y.page ? 0 : 1) || String(x.group || '').localeCompare(String(y.group || '')));
  queueMicrotask(() => pics.forEach(p => loadThumb(p)));
  let lastSet = null;
  const setHead = p => {
    const set = p.page ? null : (p.group || 'Pictures');
    if (set === lastSet) return '';
    lastSet = set;
    return set ? `<div class="bk-set-head">${esc(set)}</div>` : '';
  };
  return `<p class="bk-help">A map becomes the table's map for everyone; art pops up on the players' screens.</p>
    <div class="bk-grid small">${pics.map(p => `${setHead(p)}<div class="bk-pic kept">
      <div class="bk-pic-img" data-pic="${esc(p.id)}">${_thumbs.get(p.id) ? `<img src="${_thumbs.get(p.id)}" alt="${esc(p.title)}">` : '<span>…</span>'}</div>
      <div class="bk-pic-foot"><span>${p.kind === 'map' ? 'Map' : 'Art'} · ${esc(picLabel(p))}</span></div>
      <div class="bk-pic-actions">
        <button class="btn btn-gold btn-sm" onclick="bookUseMap('${esc(p.id)}')">Use as the map</button>
        <button class="btn btn-ghost btn-sm" onclick="bookShowPicture('${esc(p.id)}')">Show the players</button></div>
    </div>`).join('') || '<div class="bk-empty">This book has no pictures.</div>'}</div>`;
}
// Pictures are known by their own id: several can share one file (a pack, book-picture-pack.js).
async function loadThumb(p) {
  if (_thumbs.has(p.id)) return;
  _thumbs.set(p.id, null);
  try {
    const buf = await loadBookPicture(p);
    _thumbs.set(p.id, URL.createObjectURL(new Blob([buf], { type: 'image/webp' })));
    const box = document.querySelector(`#book-panel [data-pic="${CSS.escape(p.id)}"]`);
    if (box) box.innerHTML = `<img src="${_thumbs.get(p.id)}" alt="">`;
  } catch { _thumbs.delete(p.id); }
}
const picOf = id => R?.books?.[R.book]?.images?.find(p => p.id === id);

/** A book picture becomes the campaign's map, on every screen (a campaign copy: players cannot read the book). */
export async function bookUseMap(picId) {
  const p = picOf(picId);
  if (!p || !confirm(`Make "${p.title}" the map for everyone? The current map stays in your maps.`)) return;
  try {
    const buf = await loadBookPicture(p);
    await addMapFromBuffer(buf, `${R.books[R.book].title} - ${picLabel(p)}`, 'image/webp');
    document.getElementById('book-panel')?.remove(); R = null;
  } catch (e) { if (!e?.shown) alert(`The map could not be made (${e?.message || e}).`); }
}

/** Show a book picture to the players: a campaign copy, popped up over their map (and the DM's). */
export async function bookShowPicture(picId) {
  const c = camp(), p = picOf(picId);
  if (!c || !p) return;
  try {
    const data = await loadBookPicture(p);
    const res = await guarded(requestWithTransfer)('files:upload', { data, name: `${p.title}.webp`, mime: 'image/webp',
      attachContext: `campaign:${c.id}` }, [data], 120000);
    const title = p.page ? `${R.books[R.book].title}, page ${p.page}` : (p.title || R.books[R.book].title);
    await realtimePublish(EV.HANDOUT_PUSH, { type: EV.HANDOUT_PUSH, campaignId: c.id, title, content: '', imageFileId: res.id, fromUserId: userId });
    showHandoutOverlay({ title, content: '', imageFileId: res.id });
  } catch (e) { if (!e?.shown) alert(`The picture could not be shown (${e?.message || e}).`); }
}

export function bookPanelTab(t) { R.tab = t; R.q = ''; draw(); }
export function bookPanelBook(i) { R.book = i; R.section = R.books[i]?.story?.[0]?.id || null; draw(); }
export function bookPanelSection(id) { R.section = id; draw(); document.querySelector('#book-panel .bk-page')?.scrollTo?.(0, 0); }
export function bookPanelFilter(v) { R.q = v; draw(); const i = document.querySelector('#book-panel .bk-search'); i?.focus(); i?.setSelectionRange(v.length, v.length); }
export function bookPanelOpen(kind, id) { if (kind === 'monster') R.monster = R.monster === id ? null : id; else R.item = R.item === id ? null : id; draw(); }

const htmlToText = html => String(html).replace(/<\/(p|h4|blockquote)>/g, '\n\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();

export async function bookShareSection(sid) {
  const c = camp(), b = R.books[R.book], s = b?.story.find(x => x.id === sid);
  if (!c || !s) return;
  const id = `book-${b.id}-${sid}`.slice(0, 120);
  const content = htmlToText(s.html);
  c.journals = c.journals || {};
  c.journals[id] = { ...(c.journals[id] || {}), id, title: s.title, content, visibility: 'player',
    createdAt: c.journals[id]?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), source: { book: b.id, section: sid } };
  await saveHubDm(serverData);
  await realtimePublish(EV.HANDOUT_PUSH, { type: EV.HANDOUT_PUSH, campaignId: c.id, journalId: id, title: s.title, content, fromUserId: userId });
  draw();
}

export function bookAddMonster(id) {
  localPublish('dnd-master', EV.BOOK_ADD_MONSTER, { type: EV.BOOK_ADD_MONSTER, campaignId: MAP.campaignId, monsterId: id });
}

export async function bookAddItem(id) {
  const c = camp(), it = R.books[R.book]?.items.find(x => x.id === id);
  if (!c || !it || c.items?.[id]) return;
  c.items = { ...(c.items || {}), [id]: { id, name: it.name, type: it.category === 'Weapon' ? 'weapon' : it.category === 'Armor' ? 'armor' : 'magic',
    description: it.desc, rarity: it.rarity, effects: [], effectsText: '', source: it.source } };
  await saveHubDm(serverData);
  draw();
}

export async function bookUseHere(fileId) {
  const c = camp();
  if (!c) return;
  try { await attachBook(c, { fileId }); await saveHubDm(serverData); } catch (e) { if (!e?.shown) alert(`The book could not be added (${e?.message || e}).`); return; }
  sendBookMonsters(c.id);
  document.getElementById('book-panel')?.remove(); R = null;
  toggleBookPanel();
}
