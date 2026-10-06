// lk-book.js — LanternKeep books: what a DM keeps from an imported book, the part players may see, and merging book
// entries into the rules lists. ⚠️ SOURCE; vendored by scripts/vendor-shared.mjs. Pure.
// Plan: dissent/docs/superpowers/plans/2026-10-04-lanternkeep-book-import.md (stage B).
//
// A book file holds everything (monsters, spells, items, story) and is PRIVATE to the DM (personal or this server).
// A campaign using it gets a copy of the PLAYER part only (spells, items): monsters and story stay with the DM
// until revealed (a revealed section becomes a shared journal page).

export const BOOK_FORMAT = 1;
const KINDS = ['monsters', 'spells', 'items', 'story'];
const WORKING = ['confidence', 'problems', 'lines', 'src'];

/** The book the DM saves. `keep`: kind → ids kept (a kind not named keeps everything). */
export function makeBook({ title, parsed, keep = {}, id, now = new Date().toISOString() }) {
  const book = { formatVersion: BOOK_FORMAT, id, title: String(title || 'Untitled book').trim(), createdAt: now };
  for (const k of KINDS) {
    const want = keep[k] ? new Set(keep[k]) : null;
    book[k] = (parsed?.[k] || []).filter(e => e && (!want || want.has(e.id))).map(e => {
      const out = { ...e };
      for (const w of WORKING) delete out[w];
      if (k !== 'story') out.source = { book: id, title: book.title };
      return out;
    });
  }
  return book;
}

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
    .filter(i => i && typeof i.id === 'string' && typeof i.data === 'string' && i.data.length)
    .map(i => ({ id: i.id, page: +i.page || 0, width: +i.width || 0, height: +i.height || 0,
      kind: i.kind === 'map' ? 'map' : 'art', name: String(i.title || `Page ${i.page} picture`), dataB64: i.data,
      ...(typeof i.group === 'string' && i.group ? { group: i.group.slice(0, 80) } : {}) }));
  return { title: String(j.book.title || 'Imported book').slice(0, 80),
    parsed: { monsters: list('monsters'), spells: list('spells'), items: list('items'), story: list('story'), images } };
}

/** A file name for a book's .lkpack. */
export const packFileName = book => `${String(book.title || 'Book').replace(/[^\p{L}\p{N} '’-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Book'}.lkpack`;
