// lk-book.js — LanternKeep books: what a DM keeps from an imported book, the part players may see, and merging book
// entries into the rules lists. ⚠️ SOURCE; vendored by scripts/vendor-shared.mjs. Pure.
// Plan: dissent/docs/superpowers/plans/2026-10-04-lanternkeep-book-import.md (stage B).
//
// A book file holds everything (monsters, spells, items, the index, pictures) and is PRIVATE to the DM (personal or
// this server).
// A campaign using it gets a copy of the PLAYER part only (spells, items): monsters and story stay with the DM
// until revealed (a revealed section becomes a shared journal page).

// Format 2 (plan dissent/docs/superpowers/plans/2026-10-06-lanternkeep-page-reader.md): the reader shows the REAL
// pages, so the story is only an index into them ({ id, title, chapter, doc, page }); page pictures live per PDF in
// `docs` (an old book's `pages` reads as doc 0, see bookDocs); a picture may be a box cut from a page (`rect`).
// Format-1 books and copies still open.
export const BOOK_FORMAT = 2;
const KINDS = ['monsters', 'spells', 'items', 'story'];
const WORKING = ['confidence', 'problems', 'lines', 'src'];

/** The book the DM saves. `keep`: kind → ids kept (a kind not named keeps everything). */
export function makeBook({ title, parsed, keep = {}, id, now = new Date().toISOString() }) {
  const book = { formatVersion: BOOK_FORMAT, id, title: String(title || 'Untitled book').trim(), createdAt: now };
  for (const k of KINDS) {
    const want = keep[k] ? new Set(keep[k]) : null;
    book[k] = (parsed?.[k] || []).filter(e => e && (!want || want.has(e.id))).map(e => {
      if (k === 'story') return indexEntry(e);
      const out = { ...e };
      for (const w of WORKING) delete out[w];
      if (k !== 'story') out.source = { book: id, title: book.title };
      return out;
    });
  }
  return book;
}

const whole = (n, min) => Number.isInteger(n) && n >= min;

/** A line of the book's index: where a chapter or section starts. Its text is the page itself. */
export function indexEntry(e) {
  const out = { id: String(e.id), title: String(e.title ?? ''), chapter: String(e.chapter ?? ''), doc: whole(e.doc, 0) ? e.doc : 0 };
  if (whole(e.page, 1)) out.page = e.page;
  return out;
}

/**
 * Where a book's page pictures are: [{ name, count, fingerprint, packs: [{ fileId, from, to }] }], one per PDF.
 * The one reader of page locations: an old book's `pages` is doc 0; a book without page pictures has none.
 */
export function bookDocs(book) {
  const ok = d => d && whole(d.count, 1) && Array.isArray(d.packs);
  if (Array.isArray(book?.docs)) return book.docs.filter(ok);
  const p = book?.pages;
  return ok(p) ? [{ name: '', count: p.count, fingerprint: null, packs: p.packs }] : [];
}

/** Every file a book owns besides its own: its pictures and every PDF's page packs, each once. */
export function bookFileIds(book) {
  const ids = [...(book?.images || []).map(i => i?.fileId), ...bookDocs(book).flatMap(d => d.packs.map(p => p?.fileId))];
  return [...new Set(ids.filter(id => typeof id === 'string' && id))];
}

/**
 * A book's magic item as one of the campaign's items (what the DM sidebar's Loot → Items lists and shops sell). The
 * Hub hands it to the sidebar, which adds it with its own save (book-reader.js bookAddItem → dnd-master-items.js).
 */
export function campaignItemFromBook(e) {
  if (!e || typeof e.id !== 'string' || !e.id || typeof e.name !== 'string' || !e.name) return null;
  const c = String(e.category || '').toLowerCase();
  const type = c === 'weapon' ? 'weapon' : /^armou?r$/.test(c) ? 'armor' : c === 'potion' ? 'consumable' : 'magic';
  return { id: e.id, name: e.name, type, description: String(e.desc || ''), rarity: e.rarity || '', effects: [], effectsText: '',
    ...(e.source ? { source: e.source } : {}) };
}

/** A box on a page, as fractions of the page: four numbers, inside it, not empty. */
const goodRect = r => Array.isArray(r) && r.length === 4 && r.every(v => typeof v === 'number' && Number.isFinite(v))
  && r[0] >= 0 && r[1] >= 0 && r[2] > 0 && r[3] > 0 && r[0] + r[2] <= 1 + 1e-9 && r[1] + r[3] <= 1 + 1e-9;

/** What every player of a campaign using the book may read at once. */
export function playerPart(book) {
  return { formatVersion: BOOK_FORMAT, id: book.id, title: book.title, spells: book.spells || [], items: book.items || [] };
}

/**
 * `list` (an SRD list) plus the `kind` entries of `books`. A book entry with the id of an SRD one replaces it.
 * Entries without an id and name are skipped; `out.skipped` counts them. No books: `list` itself.
 */
export function mergeContent(list, books, kind) {
  if (!books?.length) return list;
  const byId = new Map((list || []).map(e => [e.id, e]));
  let skipped = 0;
  for (const b of books) for (const e of b?.[kind] || []) {
    if (!e || !e.id || !e.name) { skipped++; continue; }
    byId.set(e.id, e);
  }
  const out = [...byId.values()];
  out.skipped = skipped;
  return out;
}

const PREFIX = 'LanternKeep book - ';
/** A book's file name: readable on the storage screen, and the library reads the title and id back from it. */
export function bookFileName(book) {
  const t = String(book.title || 'Untitled').replace(/[^\p{L}\p{N} '’-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${PREFIX}${t} (${book.id}).json`;
}
export function bookTitleFromFile(name) {
  const m = String(name || '').match(/^LanternKeep book - (.*) \(([^()]+)\)\.json$/);
  return m ? { id: m[2], title: m[1] } : null;
}

/**
 * The player parts of a campaign's books (spells, items), read from the campaign's copies. `request` is the SDK's.
 * A copy that cannot be read is skipped: the campaign plays on with the SRD alone.
 */
export async function loadPlayerParts(camp, request) {
  const out = [];
  for (const b of camp?.books || []) {
    if (!b?.playerFileId) continue;
    try {
      const r = await request('files:loadArrayBuffer', { fileId: b.playerFileId }, 60000);
      out.push(JSON.parse(new TextDecoder().decode(r.buffer)));
    } catch { /* gone or unreadable */ }
  }
  return out;
}

// ── .lkpack: a whole book in one file, for backups and for moving a book (owner, 2026-10-04) ───────────────────
export const PACK_KIND = 'lanternkeep-book';

/** The .lkpack text for a book. `pictures`: picture id → base64 bytes, inlined so the copy is whole. */
export function toPack(book, pictures = {}) {
  const images = (book.images || []).filter(i => pictures[i.id]).map(({ fileId, ...i }) => ({ ...i, data: pictures[i.id] }));
  return JSON.stringify({ kind: PACK_KIND, formatVersion: BOOK_FORMAT, exportedAt: new Date().toISOString(), book: { ...book, images } });
}

/**
 * A book from .lkpack text, as { parsed, title } for the review screen, or throws a sentence to show.
 * Entries without an id and a name are dropped; nothing in the file is trusted beyond the four lists.
 */
export function fromPack(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('That file is not a LanternKeep book (it could not be read).'); }
  if (j?.kind !== PACK_KIND || !j.book) throw new Error('That file is not a LanternKeep book.');
  if (j.formatVersion > BOOK_FORMAT) throw new Error('That book was saved by a newer LanternKeep. Update and try again.');
  const ok = e => e && typeof e === 'object' && typeof e.id === 'string' && typeof (e.name ?? e.title) === 'string';
  const list = k => (Array.isArray(j.book[k]) ? j.book[k] : []).filter(ok).map(e => ({ ...e }));
  const images = (Array.isArray(j.book.images) ? j.book.images : [])
    .filter(i => i && typeof i.id === 'string' && typeof i.data === 'string' && i.data.length && (i.rect == null || goodRect(i.rect)))
    .map(i => ({ id: i.id, page: +i.page || 0, width: +i.width || 0, height: +i.height || 0,
      kind: i.kind === 'map' ? 'map' : 'art', name: String(i.title || `Page ${i.page} picture`), dataB64: i.data,
      ...(typeof i.group === 'string' && i.group ? { group: i.group.slice(0, 80) } : {}),
      ...(whole(i.doc, 0) ? { doc: i.doc } : {}),
      ...(i.rect ? { rect: i.rect.slice() } : {}),
      ...(['cut', 'found', 'loose'].includes(i.source) ? { source: i.source } : {}) }));
  return { title: String(j.book.title || 'Imported book').slice(0, 80),
    parsed: { monsters: list('monsters'), spells: list('spells'), items: list('items'), story: list('story'), images } };
}

/** A file name for a book's .lkpack. */
export const packFileName = book => `${String(book.title || 'Book').replace(/[^\p{L}\p{N} '’-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Book'}.lkpack`;
