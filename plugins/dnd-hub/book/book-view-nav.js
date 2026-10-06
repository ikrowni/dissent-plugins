// book-view-nav.js — moving through a book's real pages in the reader (plan 2026-10-06 page reader). Pure.
// A place is { doc, page }: page `page` (from 1) of PDF `doc` (book.docs, lk-book.js bookDocs). Paging stays inside
// its PDF: the PDF switcher moves between them.

/** The zoom steps: the page fits the width, then 150 % and 200 % (scrolling). */
export const ZOOMS = [1, 1.5, 2];
export const nextZoom = z => ZOOMS[(ZOOMS.indexOf(z) + 1) % ZOOMS.length] ?? 1;

/** `place` moved `delta` pages, kept inside the book: a missing PDF is the first, a page past the end the last. */
export function step(place, delta, docs) {
  const doc = docs[place?.doc] ? place.doc : 0;
  const count = docs[doc]?.count || 1;
  return { doc, page: Math.min(count, Math.max(1, (place?.page || 1) + delta)) };
}

/** A page number the DM typed, if it is a page of a `count`-page PDF; else null. */
export function typedPage(text, count) {
  const t = String(text).trim();
  if (!/^\d+$/.test(t)) return null;
  const n = +t;
  return n >= 1 && n <= count ? n : null;
}

/** The index line `place` belongs to: the last one in its PDF starting on or before its page; null before the first. */
export function entryAt(story, place) {
  let best = null;
  for (const e of story || []) {
    if ((e.doc || 0) !== place.doc || !e.page || e.page > place.page) continue;
    if (!best || e.page >= best.page) best = e;
  }
  return best;
}

/** Where an index line (or a monster, item…) starts: its page, or its PDF's first page when it has none. */
export const startOf = e => ({ doc: e?.doc || 0, page: e?.page || 1 });
