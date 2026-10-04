// book-library.js — the DM's imported books: one PRIVATE file per book, in the DM's personal space (follows them to
// every server) or on this server (only they can read it). The library is the list of those files; their names
// carry the title and id (lk-book.js bookFileName), so there is no index to fall out of step.
// A campaign using a book gets a copy of the player part (spells, items) as an ordinary campaign file; the library
// file's id is DM-only (campaign.bookFiles, secret in lk-secrets.js).
import { request, requestWithTransfer } from '../../plugin-sdk.js';
import { guarded } from '../lk-upload.js';
import { bookFileName, bookTitleFromFile, playerPart } from '../lk-book.js';

const _cache = new Map(); // fileId → book

/**
 * A library entry from one row of files:list, or null for a file that is not a book. 🔴 The node names the field
 * `filename` (and `size_bytes`); reading `name` listed no book at all (found by dnd-book-test.mjs, 2026-10-04).
 */
export function entryFromFile(f, place) {
  const t = bookTitleFromFile(f?.filename ?? f?.name);
  return t && { fileId: f.id, id: t.id, title: t.title, size: f.size_bytes ?? f.size ?? 0,
    createdAt: f.created_at || f.createdAt || null, place };
}

const listOf = async place => {
  const files = await request('files:list', place === 'personal' ? { place } : {});
  return (Array.isArray(files) ? files : files?.files || []).map(f => entryFromFile(f, place)).filter(Boolean);
};

/** { books: [...], personalError } — personal and this server's books. Personal space may be switched off. */
export async function listBooks() {
  const [personal, server] = await Promise.allSettled([listOf('personal'), listOf('server')]);
  return {
    books: [...(personal.value || []), ...(server.value || [])].sort((a, b) => a.title.localeCompare(b.title)),
    personalError: personal.status === 'rejected' ? String(personal.reason?.message || personal.reason) : null,
  };
}

const json = obj => new TextEncoder().encode(JSON.stringify(obj)).buffer;

/** Save a book privately. `place`: 'personal' | 'server'. Returns the file id. Shows the storage advice on failure. */
export async function saveBook(book, place) {
  const data = json(book);
  const res = await guarded(requestWithTransfer)('files:upload', {
    data, name: bookFileName(book), mime: 'application/json', attachContext: `library:${book.id}`,
    ...(place === 'personal' ? { place: 'personal' } : { private: true }),
  }, [data], 180000);
  _cache.set(res.id, book);
  return res.id;
}

/** A book from its file (cached for the session). */
export async function loadBook(fileId) {
  if (_cache.has(fileId)) return _cache.get(fileId);
  const r = await request('files:loadArrayBuffer', { fileId }, 120000);
  const book = JSON.parse(new TextDecoder().decode(r.buffer));
  _cache.set(fileId, book);
  return book;
}

/** Delete a book and its pictures. A picture that will not delete is left for the storage screen. */
export async function deleteBook(fileId) {
  const book = await loadBook(fileId).catch(() => null);
  await request('files:delete', { fileId });
  for (const img of book?.images || []) await request('files:delete', { fileId: img.fileId }).catch(() => {});
  _cache.delete(fileId);
}

/** Save one picture of a book (book-pdf.js; a WebP blob) privately, beside the book. Returns the file id. */
export async function saveBookImage(book, img, place) {
  const data = await img.blob.arrayBuffer();
  const res = await guarded(requestWithTransfer)('files:upload', {
    data, name: `LanternKeep book picture - ${bookFileName(book).replace(/^LanternKeep book - /, '').replace(/\.json$/, '')} ${img.id}.webp`,
    mime: 'image/webp', attachContext: `library:${book.id}`, ...(place === 'personal' ? { place: 'personal' } : { private: true }),
  }, [data], 180000);
  return res.id;
}

/** A book picture's bytes (private: only the DM can read it). */
export async function loadBookImage(fileId) {
  const r = await request('files:loadArrayBuffer', { fileId }, 120000);
  return r.buffer;
}

/** Campaigns (of `campaigns`) that use the book `bookId`. */
export const campaignsUsing = (campaigns, bookId) =>
  Object.values(campaigns || {}).filter(c => (c.books || []).some(b => b.id === bookId));

/** Attach a library book to a campaign record (the caller saves it): copies the player part as a campaign file. */
export async function attachBook(camp, { fileId }) {
  const book = await loadBook(fileId);
  if ((camp.books || []).some(b => b.id === book.id)) return camp;
  const data = json(playerPart(book));
  const res = await guarded(requestWithTransfer)('files:upload', {
    data, name: `${bookFileName(book).replace('.json', '')} - players.json`, mime: 'application/json',
    attachContext: `campaign:${camp.id}`,
  }, [data], 120000);
  camp.books = [...(camp.books || []), { id: book.id, title: book.title, playerFileId: res.id,
    counts: { spells: book.spells.length, items: book.items.length } }];
  camp.bookFiles = { ...(camp.bookFiles || {}), [book.id]: fileId };
  return camp;
}

/** Detach a book from a campaign record (the caller saves it): removes the players' copy. */
export async function detachBook(camp, bookId) {
  const b = (camp.books || []).find(x => x.id === bookId);
  if (b?.playerFileId) await request('files:delete', { fileId: b.playerFileId }).catch(() => {});
  camp.books = (camp.books || []).filter(x => x.id !== bookId);
  if (camp.bookFiles) { const { [bookId]: _, ...rest } = camp.bookFiles; camp.bookFiles = rest; }
  return camp;
}

/** The DM's full books for a campaign (from the library). A book whose file is gone is left out. */
export async function campaignBooks(camp) {
  const out = [];
  for (const [, fileId] of Object.entries(camp?.bookFiles || {})) {
    try { out.push(await loadBook(fileId)); } catch { /* deleted from the library */ }
  }
  return out;
}
