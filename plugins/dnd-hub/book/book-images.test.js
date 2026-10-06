// plugins/dnd-hub/book/book-images.test.js
import { describe, it, expect } from 'vitest';
import { isWorthOffering, guessKind, fitWithin, rgbaFrom, fingerprint, pictureStats, notAPicture } from './book-images.js';
import { paintedPage, TEXT_PAGE } from './book-images.js';

describe('book images', () => {
  it('decorations are not offered; real pictures are', () => {
    expect(isWorthOffering(64, 64)).toBe(false);
    expect(isWorthOffering(1600, 120)).toBe(false); // a border strip
    expect(isWorthOffering(900, 1200)).toBe(true);
  });
  it('guesses map for a big wide picture, art for a tall one', () => {
    expect(guessKind(1600, 1200)).toBe('map');
    expect(guessKind(900, 1200)).toBe('art');
  });
  it('fits within the limit, keeping the shape; small ones stay as they are', () => {
    expect(fitWithin(8000, 4000)).toEqual({ w: 4096, h: 2048 });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });
  it('turns RGB, RGBA and 1-bit pixels into RGBA', () => {
    expect([...rgbaFrom({ width: 1, height: 1, kind: 2, data: new Uint8ClampedArray([10, 20, 30]) })]).toEqual([10, 20, 30, 255]);
    expect([...rgbaFrom({ width: 1, height: 1, kind: 3, data: new Uint8ClampedArray([1, 2, 3, 4]) })]).toEqual([1, 2, 3, 4]);
    expect([...rgbaFrom({ width: 2, height: 1, kind: 1, data: new Uint8ClampedArray([0b10000000]) })]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(rgbaFrom({ width: 2, height: 2, kind: 2, data: new Uint8ClampedArray(3) })).toBeNull();
  });
  it('the same picture twice has one fingerprint; a different one does not', () => {
    const a = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6]) };
    expect(fingerprint(a)).toBe(fingerprint({ ...a, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6]) }));
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, data: new Uint8ClampedArray([9, 2, 3, 4, 5, 6]) }));
  });
});

describe('fingerprints tell same-size pictures apart by their pixels', () => {
  it('two maps of one size, different pixels → different prints; the same picture twice → the same', async () => {
    const { fingerprint } = await import('./book-images.js');
    const a = { width: 6000, height: 4500, data: new Uint8ClampedArray(4096).map((_, i) => i % 251) };
    const b = { width: 6000, height: 4500, data: new Uint8ClampedArray(4096).map((_, i) => (i * 7) % 253) };
    expect(fingerprint(a)).not.toBe(fingerprint(b));
    expect(fingerprint(a)).toBe(fingerprint({ ...a, data: a.data.slice() }));
  });
});

describe('pictures that are not pictures (measured on Heliana\'s Guide, 2026-10-06)', () => {
  // Small hand-made copies with the same make-up as the real ones.
  const make = (fn, w = 64, h = 64) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a = 255] = fn(x, y); px.set([r, g, b, a], (y * w + x) * 4); }
    return pictureStats(px, w, h);
  };
  const frame = make((x, y) => (x < 6 || y < 6 || x > 57 || y > 57 ? [0, 0, 0] : [255, 255, 255])); // a stat-block frame
  const parchment = make((x, y) => [214 + ((x * 7 + y * 3) % 5), 205, 205]);                       // paper texture
  const cutout = make((x, y) => ((x - 32) ** 2 + (y - 32) ** 2 < 300 ? [60 + x * 2, 120, 40 + y] : [0, 0, 0, 0])); // art, see-through round it
  const busy = make((x, y) => [(x * 37) % 255, (y * 53) % 255, ((x + y) * 29) % 255]);              // a detailed page

  it('a solid black-and-white frame is a mask; see-through art as black is not', () => {
    expect(notAPicture({ cover: 0.2, stats: frame })).toBe('mask');
    expect(notAPicture({ cover: 0.5, stats: cutout })).toBe(null);
  });
  it('a flat paper texture is blank', () => expect(notAPicture({ cover: 0.12, stats: parchment })).toBe('blank'));
  it('a whole page with little on it is a background; a whole page of picture is kept', () => {
    expect(notAPicture({ cover: 1, stats: { ...parchment, spread: 30 } })).toBe('background');
    expect(notAPicture({ cover: 1, stats: busy })).toBe(null);
  });
  it('a page that says "map" makes its picture a map; a whole page without is art', () => {
    expect(guessKind(1245, 1635, { mapWord: true, fullPage: true })).toBe('map');
    expect(guessKind(2000, 1500, { fullPage: true })).toBe('art');
    expect(guessKind(2000, 1500)).toBe('map');
  });
});

describe('cut-out art and near-empty pictures (Heliana, owner report 2026-10-06)', () => {
  it('a see-through cut-out is art, however big and wide (creatures were labelled maps)', () => {
    expect(guessKind(1184, 840, { clear: 0.64 })).toBe('art');
    expect(guessKind(1184, 840, { clear: 0.64, mapWord: true })).toBe('art');
  });
  it('a picture that is almost all see-through is left out (a tiny swoosh on an empty canvas)', () => {
    expect(notAPicture({ cover: 0.2, stats: { bw: 0.99, edge: 1, spread: 10, clear: 0.97 } })).toBe('blank');
  });
});

// Plan 2026-10-06 page reader, measured that day over the 10 corpus PDFs + Heliana: a page under a whole-page picture
// holds either almost no text (a map, an art plate, a cover: < 600 characters) or a page of it (art painted behind
// the text: Heliana's pages, a scan's pages). The second is the page itself: the DM boxes the art in the reader.
describe('a whole-page picture under a page of text is the page, not a picture', () => {
  it('a map page (a few labels) is still offered', () => {
    expect(paintedPage({ fullPage: true, pageChars: 167 })).toBe(false); // Heliana p355, a map
    expect(paintedPage({ fullPage: true, pageChars: TEXT_PAGE - 1 })).toBe(false);
  });
  it('a page of text with art painted behind it is not', () => {
    expect(paintedPage({ fullPage: true, pageChars: TEXT_PAGE })).toBe(true);
    expect(paintedPage({ fullPage: true, pageChars: 2400 })).toBe(true);
  });
  it('a picture that is not the whole page is never this', () => {
    expect(paintedPage({ fullPage: false, pageChars: 5000 })).toBe(false);
  });
});

import { boxOnPage, SORT_OPTIONS, kindFromChoice } from './book-images.js';
// Where a picture sits on its page: pdf.js draws an image into the unit square under the current transform; the page's
// own viewport turns PDF points into top-down page pixels (it knows the page's offset and rotation).
describe('boxOnPage', () => {
  const W = 600, H = 800;
  const flip = (x, y) => [x, H - y]; // a plain page: PDF y runs up, the page's runs down
  it('a picture drawn 300×200 at (100, 400) in PDF points', () => {
    const r = boxOnPage([300, 0, 0, 200, 100, 400], flip, W, H);
    [100 / W, 200 / H, 300 / W, 200 / H].forEach((v, i) => expect(r[i]).toBeCloseTo(v, 6));
  });
  it('a flipped or rotated transform gives the same box (the four corners decide)', () => {
    const r = boxOnPage([300, 0, 0, -200, 100, 600], flip, W, H);
    [100 / W, 200 / H, 300 / W, 200 / H].forEach((v, i) => expect(r[i]).toBeCloseTo(v, 6));
  });
  it('a picture running off the page is cut at its edge; one wholly off it is none', () => {
    const r = boxOnPage([300, 0, 0, 200, 450, 700], flip, W, H);
    expect(r[0] + r[2]).toBeCloseTo(1, 6);
    expect(r[1]).toBe(0);
    expect(boxOnPage([100, 0, 0, 100, 900, 100], flip, W, H)).toBe(null);
  });
});

// Measured 2026-10-06 on the owner's Heliana (43 whole-page pictures labelled by eye, SigLIP 8-bit, CPU): these
// wordings get map-vs-not right 42/43 (the miss: an advert made of map pictures); single vague words got 31/43.
describe('the AI sort', () => {
  it('three options of several wordings each, inside the engine\'s limits', () => {
    expect(SORT_OPTIONS.length).toBe(3);
    for (const o of SORT_OPTIONS) {
      expect(o.length).toBeGreaterThan(1);
      expect(o.length).toBeLessThanOrEqual(8);
      for (const w of o) expect(w.length).toBeLessThanOrEqual(60);
    }
  });
  it('a map is a map; art is art; an advert or a text page is art, left out', () => {
    expect(kindFromChoice(0)).toEqual({ kind: 'map', keep: true });
    expect(kindFromChoice(1)).toEqual({ kind: 'art', keep: true });
    expect(kindFromChoice(2)).toEqual({ kind: 'art', keep: false });
  });
});
