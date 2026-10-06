// plugins/dnd-hub/book/book-view-nav.test.js — moving through a book's real pages (plan 2026-10-06 page reader).
import { describe, it, expect } from 'vitest';
import { step, typedPage, entryAt, startOf, nextZoom, ZOOMS } from './book-view-nav.js';

const docs = [{ count: 40, packs: [] }, { count: 5, packs: [] }];
const story = [
  { id: 'intro', title: 'Introduction', doc: 0, page: 2 },
  { id: 'ch1', title: 'Chapter 1', doc: 0, page: 5 },
  { id: 'docks', title: 'The Docks', doc: 0, page: 9 },
  { id: 'nopage', title: 'Lost', doc: 0 },
  { id: 'maps', title: 'Maps', doc: 1, page: 1 },
];

describe('step', () => {
  it('moves a page within its PDF and stops at either end', () => {
    expect(step({ doc: 0, page: 5 }, 1, docs)).toEqual({ doc: 0, page: 6 });
    expect(step({ doc: 0, page: 1 }, -1, docs)).toEqual({ doc: 0, page: 1 });
    expect(step({ doc: 0, page: 40 }, 1, docs)).toEqual({ doc: 0, page: 40 });
    expect(step({ doc: 1, page: 5 }, 1, docs)).toEqual({ doc: 1, page: 5 });
  });
  it('a place outside the book comes back inside it', () => {
    expect(step({ doc: 7, page: 3 }, 0, docs)).toEqual({ doc: 0, page: 3 });
    expect(step({ doc: 0, page: 99 }, 0, docs)).toEqual({ doc: 0, page: 40 });
  });
});

describe('typedPage', () => {
  it('a typed page number within the PDF', () => {
    expect(typedPage('12', 40)).toBe(12);
    expect(typedPage(' 3 ', 40)).toBe(3);
  });
  it('outside it, or not a number: nothing', () => {
    for (const v of ['0', '41', 'x', '', '2.5', '-1']) expect(typedPage(v, 40), v).toBe(null);
  });
});

describe('entryAt: the index line a page belongs to', () => {
  it('the last line starting on or before the page, in that PDF', () => {
    expect(entryAt(story, { doc: 0, page: 7 }).id).toBe('ch1');
    expect(entryAt(story, { doc: 0, page: 9 }).id).toBe('docks');
    expect(entryAt(story, { doc: 0, page: 40 }).id).toBe('docks');
    expect(entryAt(story, { doc: 1, page: 3 }).id).toBe('maps');
  });
  it('before the first line, or in a PDF with no lines: none', () => {
    expect(entryAt(story, { doc: 0, page: 1 })).toBe(null);
    expect(entryAt([{ id: 'a', doc: 0, page: 3 }], { doc: 1, page: 3 })).toBe(null);
  });
});

describe('startOf', () => {
  it('where an index line starts; one without a page starts at its PDF\'s first page', () => {
    expect(startOf(story[2])).toEqual({ doc: 0, page: 9 });
    expect(startOf(story[3])).toEqual({ doc: 0, page: 1 });
    expect(startOf({ page: 4 })).toEqual({ doc: 0, page: 4 });
  });
});

describe('zoom', () => {
  it('goes fit → 150 % → 200 % → fit', () => {
    expect(ZOOMS).toEqual([1, 1.5, 2]);
    expect(nextZoom(1)).toBe(1.5);
    expect(nextZoom(1.5)).toBe(2);
    expect(nextZoom(2)).toBe(1);
    expect(nextZoom(7)).toBe(1);
  });
});
