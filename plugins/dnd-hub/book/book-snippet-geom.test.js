// plugins/dnd-hub/book/book-snippet-geom.test.js — where an entry sits on its page(s). Hand-written lines only.
import { describe, it, expect } from 'vitest';
import { entryRegions, toPageRect, MARGIN } from './book-snippet-geom.js';

const ln = (page, x, y, w = 200, size = 10, extra = {}) => ({ text: 't', size, runs: [], page, x, y, w, ...extra });

describe('entryRegions', () => {
  it('one column on one page is one region round all its lines', () => {
    const lines = [ln(1, 57, 700), ln(1, 57, 688, 180), ln(1, 67, 676, 190)];
    expect(entryRegions(lines, [0, 2])).toEqual([{ page: 1, x0: 57, x1: 257, top: 710, bottom: 673, fromTop: false }]);
  });
  it('a block that runs into the next column, or onto the next page, is a region per piece', () => {
    const lines = [ln(1, 57, 120), ln(1, 57, 108), ln(1, 320, 700), ln(2, 57, 700)];
    expect(entryRegions(lines, [0, 3]).map(r => [r.page, r.x0])).toEqual([[1, 57], [1, 320], [2, 57]]);
  });
  it('only the entry\'s own lines count', () => {
    const lines = [ln(1, 57, 800), ln(1, 57, 700), ln(1, 57, 600)];
    expect(entryRegions(lines, [1, 1])).toEqual([{ page: 1, x0: 57, x1: 257, top: 710, bottom: 697, fromTop: false }]);
  });
  it('OCR lines (measured from the top) keep that', () => {
    const lines = [ln(4, 50, 100, 120, 10, { fromTop: true }), ln(4, 50, 114, 100, 10, { fromTop: true })];
    expect(entryRegions(lines, [0, 1])).toEqual([{ page: 4, x0: 50, x1: 170, top: 100, bottom: 126, fromTop: true }]);
  });
  it('no range, no regions', () => expect(entryRegions([ln(1, 57, 700)], null)).toEqual([]));
});

describe('toPageRect (top-down points, with a margin, inside the page)', () => {
  it('a pdf.js region is flipped from bottom-up', () => {
    const r = toPageRect({ page: 1, x0: 57, x1: 257, top: 710, bottom: 673, fromTop: false }, 612, 792);
    expect(r).toEqual({ x: 57 - MARGIN, y: 792 - 710 - MARGIN, w: 200 + 2 * MARGIN, h: 37 + 2 * MARGIN });
  });
  it('an OCR region is already top-down', () => {
    const r = toPageRect({ page: 4, x0: 50, x1: 170, top: 100, bottom: 126, fromTop: true }, 612, 792);
    expect(r).toEqual({ x: 50 - MARGIN, y: 100 - MARGIN, w: 120 + 2 * MARGIN, h: 26 + 2 * MARGIN });
  });
  it('never leaves the page', () => {
    const r = toPageRect({ page: 1, x0: 1, x1: 611, top: 791, bottom: 2, fromTop: false }, 612, 792);
    expect(r).toEqual({ x: 0, y: 0, w: 612, h: 792 });
  });
  it('a region with nothing in it is null', () => {
    expect(toPageRect({ page: 1, x0: 57, x1: 57, top: 700, bottom: 700, fromTop: false }, 0, 0)).toBe(null);
  });
});
