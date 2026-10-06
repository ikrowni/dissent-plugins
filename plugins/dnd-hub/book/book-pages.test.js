// plugins/dnd-hub/book/book-pages.test.js — which pages show beside a section, and where a page's picture is.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./book-pdf.js', () => ({ pdfjs: vi.fn(), openPdf: vi.fn() }));
vi.mock('./book-library.js', () => ({ saveBookPack: vi.fn(), loadBookPicture: vi.fn() }));
const { sectionPages, pagePicture, pageId, packName } = await import('./book-pages.js');

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
  const packs = [{ fileId: 'a', from: 1, to: 70 }, { fileId: 'b', from: 71, to: 120 }];
  const book = { docs: [{ name: 'Book', count: 120, packs }, { name: 'Maps', count: 5, packs: [{ fileId: 'm', from: 1, to: 5 }] }] };
  it('finds the pack that holds a page of a PDF', () => {
    expect(pagePicture(book, 0, 70)).toEqual({ fileId: 'a', packed: true, id: pageId(70) });
    expect(pagePicture(book, 0, 71)).toEqual({ fileId: 'b', packed: true, id: 'page-71' });
    expect(pagePicture(book, 1, 3)).toEqual({ fileId: 'm', packed: true, id: 'page-3' });
  });
  it('an old book\'s pages are its only PDF\'s', () => {
    expect(pagePicture({ pages: { count: 120, packs } }, 0, 70)).toEqual({ fileId: 'a', packed: true, id: 'page-70' });
  });
  it('no picture: none saved, past the end, or a PDF the book does not have', () => {
    expect(pagePicture({}, 0, 3)).toBe(null);
    expect(pagePicture(book, 0, 121)).toBe(null);
    expect(pagePicture(book, 2, 1)).toBe(null);
  });
});

describe('packName', () => {
  it('the first PDF\'s packs keep their old names; later PDFs say which they are', () => {
    expect(packName(0, 1)).toBe('pages-1');
    expect(packName(1, 2)).toBe('d2-pages-2');
  });
});
