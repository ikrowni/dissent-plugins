// plugins/dnd-hub/book/book-pages.test.js — which pages show beside a section, and where a page's picture is.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./book-pdf.js', () => ({ pdfjs: vi.fn(), openPdf: vi.fn() }));
vi.mock('./book-library.js', () => ({ saveBookPack: vi.fn(), loadBookPicture: vi.fn() }));
const { sectionPages, pagePicture, pageId } = await import('./book-pages.js');

const story = [{ page: 5 }, { page: 5 }, { page: 7 }, { page: 30 }, { page: 31 }];

describe('sectionPages', () => {
  it('a section shows its page through the page the next one starts on', () => {
    expect(sectionPages(story, 1)).toEqual([5, 6, 7]);
  });
  it('two sections on one page show just that page', () => expect(sectionPages(story, 0)).toEqual([5]));
  it('a long section shows at most four pages', () => expect(sectionPages(story, 2)).toEqual([7, 8, 9, 10]));
  it('the last section shows its page and the next, never past the end of the book', () => {
    expect(sectionPages(story, 4)).toEqual([31, 32]);
    expect(sectionPages(story, 4, 31)).toEqual([31]);
  });
  it('a section without a page shows none', () => expect(sectionPages([{ title: 'x' }], 0)).toEqual([]));
});

describe('pagePicture', () => {
  const book = { pages: { count: 120, packs: [{ fileId: 'a', from: 1, to: 70 }, { fileId: 'b', from: 71, to: 120 }] } };
  it('finds the pack that holds a page', () => {
    expect(pagePicture(book, 70)).toEqual({ fileId: 'a', packed: true, id: pageId(70) });
    expect(pagePicture(book, 71)).toEqual({ fileId: 'b', packed: true, id: 'page-71' });
  });
  it('a book saved without page pictures has none', () => {
    expect(pagePicture({}, 3)).toBe(null);
    expect(pagePicture(book, 121)).toBe(null);
  });
});
