// book-library.js — the DM's imported books: one PRIVATE file per book, in the DM's personal space (follows them to
// every server) or on this server (only they can read it). The library is the list of those files; their names
// carry the title and id (lk-book.js bookFileName), so there is no index to fall out of step.
// A campaign using a book gets a copy of the player part (spells, items) as an ordinary campaign file; the library
// file's id is DM-only (campaign.bookFiles, secret in lk-secrets.js).
import { request, requestWithTransfer } from '../../plugin-sdk.js';
import { guarded, uploadFile } from '../lk-upload.js';
import { packText, unpack, isRateLimited } from './book-picture-pack.js';
import { bookFileName, bookTitleFromFile, playerPart, bookFileIds } from '../lk-book.js';

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

/**
 * One entry per book: the newest file. A book saved again (a box kept in it, book-cut-actions.js) is a new file, since
 * the node cannot overwrite one; if the old one would not delete, the library still lists the book once.
 */
export function newestPerBook(entries) {
  const by = new Map();
  for (const e of entries) { const o = by.get(e.id); if (!o || String(e.createdAt || '') > String(o.createdAt || '')) by.set(e.id, e); }
  return [...by.values()];
}

/** { books: [...], personalError } — personal and this server's books. Personal space may be switched off. */
export async function listBooks() {
  const [personal, server] = await Promise.allSettled([listOf('personal'), listOf('server')]);
  return {
    books: newestPerBook([...(personal.value || []), ...(server.value || [])]).sort((a, b) => a.title.localeCompare(b.title)),
    personalError: personal.status === 'rejected' ? String(personal.reason?.message || personal.reason) : null,
  };
}

const json = obj => new TextEncoder().encode(JSON.stringify(obj)).buffer;

/** Save a book privately. `place`: 'personal' | 'server'. Returns the file id. Shows the storage advice on failure. */
export async function saveBook(book, place) {
  const data = json(book);
  const res = await upload({ name: bookFileName(book), mime: 'application/json', attachContext: `library:${book.id}`, ...where(place) }, data);
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

// 🔴 The node takes 20 plugin-file uploads (and deletes: the same limit) a minute per person. Every upload and
// delete of a book's files goes through `paced`: at most PER_MINUTE in any minute, and when the node refuses anyway
// (another screen used some), wait and try again rather than fail the whole save (book-picture-pack.js).
const PER_MINUTE = 16;
const _recent = [];
async function paced(op, onWait = () => {}) {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    while (_recent.length && now - _recent[0] > 60_000) _recent.shift();
    if (_recent.length >= PER_MINUTE) {
      const wait = 60_000 - (now - _recent[0]) + 250;
      onWait(Math.ceil(wait / 1000));
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    _recent.push(Date.now());
    try { return await op(); } catch (e) {
      if (!isRateLimited(e) || attempt >= 5) throw e;
      onWait(30);
      await new Promise(r => setTimeout(r, 30_000));
    }
  }
}

/** Delete a book, its pictures and its page pictures (each file once: a pack holds many). One that will not delete is left. */
export async function deleteBook(fileId) {
  const book = await loadBook(fileId).catch(() => null);
  await paced(() => request('files:delete', { fileId }));
  for (const id of bookFileIds(book)) await paced(() => request('files:delete', { fileId: id })).catch(() => {});
  _cache.delete(fileId);
}

/** Delete files a failed save had already uploaded, paced (it runs on; nothing waits for it). */
export function deleteFiles(ids) {
  (async () => { for (const id of new Set(ids)) await paced(() => request('files:delete', { fileId: id })).catch(() => {}); })();
}

const picName = (book, tail) => `LanternKeep book picture - ${bookFileName(book).replace(/^LanternKeep book - /, '').replace(/\.json$/, '')} ${tail}`;
const where = place => (place === 'personal' ? { place: 'personal' } : { private: true });
// An upload, paced, with the node's storage message shown when it is not a rate limit (lk-upload.js).
const upload = (params, data, onWait) => uploadFile(() => paced(() => requestWithTransfer('files:upload', { ...params, data }, [data], 180000), onWait));

/** Save one picture of a book (a WebP blob) privately, beside the book. Returns the file id. */
export async function saveBookImage(book, img, place, onWait) {
  const data = await img.blob.arrayBuffer();
  const res = await upload({ name: picName(book, `${img.id}.webp`), mime: 'image/webp', attachContext: `library:${book.id}`, ...where(place) }, data, onWait);
  return res.id;
}

/** Save several small pictures as ONE pack file (book-picture-pack.js). Returns the file id. */
export async function saveBookPack(book, imgs, place, n, onWait) {
  const items = [];
  for (const img of imgs) items.push({ id: img.id, bytes: new Uint8Array(await img.blob.arrayBuffer()) });
  const data = new TextEncoder().encode(packText(items)).buffer;
  const res = await upload({ name: picName(book, `pack-${n}.json`), mime: 'application/json', attachContext: `library:${book.id}`, ...where(place) }, data, onWait);
  return res.id;
}

/** A book picture's file bytes (private: only the DM can read it). */
export async function loadBookImage(fileId) {
  const r = await request('files:loadArrayBuffer', { fileId }, 120000);
  return r.buffer;
}

const _packs = new Map(); // pack file id → Promise<{ picture id → bytes }>
/** One picture's bytes, whether it is a file of its own or one of a pack (`pic.packed`). */
export async function loadBookPicture(pic) {
  if (!pic.packed) return loadBookImage(pic.fileId);
  if (!_packs.has(pic.fileId)) {
    _packs.set(pic.fileId, loadBookImage(pic.fileId).then(b => unpack(new TextDecoder().decode(b))));
    _packs.get(pic.fileId).catch(() => _packs.delete(pic.fileId));
  }
  const bytes = (await _packs.get(pic.fileId))[pic.id];
  if (!bytes) throw new Error('that picture is missing from its pack');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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

/**
 * The DM's full books for a campaign (from the library). A file that is gone may have been saved again (resaveBook):
 * the book is then found by its own id and `camp.bookFiles` holds the new file (the caller may save the campaign).
 * A book deleted from the library is left out.
 */
export async function campaignBooks(camp) {
  const out = [];
  let library = null;
  for (const [bookId, fileId] of Object.entries(camp?.bookFiles || {})) {
    try { out.push(await loadBook(fileId)); continue; } catch { /* gone: saved again, or deleted */ }
    try {
      library ||= (await listBooks()).books;
      const now = library.find(b => b.id === bookId);
      if (!now) continue;
      out.push(await loadBook(now.fileId));
      camp.bookFiles = { ...camp.bookFiles, [bookId]: now.fileId };
    } catch { /* unreadable: the campaign plays on without it */ }
  }
  return out;
}

/**
 * Save `book` again (the file `oldFileId` held it): a new file where the old one was, then the old one deleted — the
 * book file only, never its pictures. Returns the new file id. Campaigns still holding the old id find the book by its
 * id (campaignBooks).
 */
export async function resaveBook(oldFileId, book) {
  const entry = [...await listOf('personal').catch(() => []), ...await listOf('server').catch(() => [])].find(b => b.fileId === oldFileId);
  const fileId = await saveBook(book, entry?.place || 'server');
  _cache.delete(oldFileId);
  await paced(() => request('files:delete', { fileId: oldFileId })).catch(() => { /* listBooks shows the newest */ });
  return fileId;
}
