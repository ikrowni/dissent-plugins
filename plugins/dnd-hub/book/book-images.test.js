// plugins/dnd-hub/book/book-images.test.js
import { describe, it, expect } from 'vitest';
import { isWorthOffering, guessKind, fitWithin, rgbaFrom, fingerprint } from './book-images.js';

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
