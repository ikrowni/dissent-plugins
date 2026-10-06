// plugins/dnd-hub/book/book-pages.test.js — where a page's picture is, and what saving them costs.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./book-pdf.js', () => ({ pdfjs: vi.fn(), openPdf: vi.fn() }));
vi.mock('./book-library.js', () => ({ saveBookPack: vi.fn(), loadBookPicture: vi.fn() }));
const { pagePicture, pageId, packName, pagesLine } = await import('./book-pages.js');

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

describe('pagesLine: what saving the page pictures costs, said before saving', () => {
  it('one PDF', () => expect(pagesLine([{ pages: 400 }])).toBe('Page pictures: 400 pages, about 36 MB'));
  it('several PDFs add up', () => expect(pagesLine([{ pages: 100 }, { pages: 12 }])).toBe('Page pictures: 112 pages in 2 PDFs, about 10 MB'));
  it('a small book is at least 1 MB', () => expect(pagesLine([{ pages: 1 }])).toBe('Page pictures: 1 page, about 1 MB'));
});
