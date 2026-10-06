// plugins/dnd-hub/book/book-cut-geom.test.js — the box the DM draws on a page (plan 2026-10-06 page reader).
import { describe, it, expect } from 'vitest';
import { rectFromDrag, moveRect, resizeRect, tooSmall, toPixels, pdfScale, MIN, TARGET, MAX_SIDE } from './book-cut-geom.js';

const close = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('rectFromDrag', () => {
  it('a drag in any direction is the same box', () => {
    close(rectFromDrag({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 }), [0.2, 0.3, 0.4, 0.2]);
    close(rectFromDrag({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 }), [0.2, 0.3, 0.4, 0.2]);
  });
  it('stays on the page when the pointer leaves it', () => {
    close(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 1.4, y: -0.2 }), [0.5, 0, 0.5, 0.5]);
  });
});

describe('moveRect', () => {
  it('moves the box, never off the page', () => {
    close(moveRect([0.2, 0.2, 0.3, 0.3], 0.1, 0.05), [0.3, 0.25, 0.3, 0.3]);
    close(moveRect([0.2, 0.2, 0.3, 0.3], 0.9, -0.9), [0.7, 0, 0.3, 0.3]);
  });
});

describe('resizeRect', () => {
  const r = [0.2, 0.2, 0.4, 0.4];
  it('a corner handle moves two edges, a side handle one', () => {
    close(resizeRect(r, 'se', 0.1, 0.1), [0.2, 0.2, 0.5, 0.5]);
    close(resizeRect(r, 'nw', 0.1, 0.1), [0.3, 0.3, 0.3, 0.3]);
    close(resizeRect(r, 'e', 0.1, 0.3), [0.2, 0.2, 0.5, 0.4]);
    close(resizeRect(r, 'n', 0.3, -0.1), [0.2, 0.1, 0.4, 0.5]);
  });
  it('never smaller than MIN, never off the page', () => {
    close(resizeRect(r, 'e', -0.9, 0), [0.2, 0.2, MIN, 0.4]);
    close(resizeRect(r, 'w', 0.9, 0), [0.6 - MIN, 0.2, MIN, 0.4]);
    close(resizeRect(r, 'se', 0.9, 0.9), [0.2, 0.2, 0.8, 0.8]);
  });
});

describe('tooSmall', () => {
  it('a click without a drag is not a box', () => {
    expect(tooSmall([0.5, 0.5, 0.001, 0.3])).toBe(true);
    expect(tooSmall([0.5, 0.5, MIN, MIN])).toBe(false);
    expect(tooSmall(null)).toBe(true);
  });
});

describe('toPixels', () => {
  it('a box as whole pixels of a picture, inside it', () => {
    expect(toPixels([0.1, 0.2, 0.5, 0.25], 900, 1200)).toEqual({ x: 90, y: 240, w: 450, h: 300 });
    expect(toPixels([0, 0, 1, 1], 900, 1165)).toEqual({ x: 0, y: 0, w: 900, h: 1165 });
    expect(toPixels([0.999, 0.999, 0.001, 0.001], 900, 1200)).toEqual({ x: 899, y: 1199, w: 1, h: 1 });
  });
});

describe('pdfScale: drawing a box from the PDF itself', () => {
  it('a whole page comes out about TARGET pixels on its long side', () => {
    const s = pdfScale([0, 0, 1, 1], 612, 792);
    expect(Math.round(792 * s)).toBe(TARGET);
  });
  it('a small box is drawn bigger, but never past MAX_SIDE', () => {
    const s = pdfScale([0.1, 0.1, 0.2, 0.1], 612, 792);
    expect(612 * 0.2 * s).toBeGreaterThan(1000);
    expect(Math.max(612 * 0.2, 792 * 0.1) * s).toBeLessThanOrEqual(MAX_SIDE);
    const tiny = pdfScale([0.5, 0.5, 0.02, 0.02], 612, 792);
    expect(612 * 0.02 * tiny).toBeLessThanOrEqual(MAX_SIDE);
  });
});
