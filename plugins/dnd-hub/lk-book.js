// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-book.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-book.js' directly would make the plugin unmirrorable.

// lk-book.js — LanternKeep books: what a DM keeps from an imported book, the part players may see, and merging book
// entries into the rules lists. ⚠️ SOURCE; vendored by scripts/vendor-shared.mjs. Pure.
// Plan: dissent/docs/superpowers/plans/2026-10-04-lanternkeep-book-import.md (stage B).
//
// A book file holds everything (monsters, spells, items, story) and is PRIVATE to the DM (personal or this server).
// A campaign using it gets a copy of the PLAYER part only (spells, items): monsters and story stay with the DM
// until revealed (a revealed section becomes a shared journal page).

export const BOOK_FORMAT = 1;
const KINDS = ['monsters', 'spells', 'items', 'story'];
const WORKING = ['confidence', 'problems', 'lines'];

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
