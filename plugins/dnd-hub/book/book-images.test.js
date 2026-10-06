// plugins/dnd-hub/book/book-images.test.js
import { describe, it, expect } from 'vitest';
import { isWorthOffering, guessKind, fitWithin, rgbaFrom, fingerprint, pictureStats, notAPicture } from './book-images.js';

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
