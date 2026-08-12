import { describe, it, expect } from 'vitest';
import {
  coverScale, offsetLimit, clampOffset, cropRect, previewBox,
  outputSize, parseRatio, isAnimatedWebp, isAnimatedImage,
} from './image-crop.js';
import { IMAGE_SPEC } from './team-images.js';

describe('coverScale', () => {
  // ⚠️ COVER, NOT FIT. Fit is `Math.min` and leaves the window partly empty for
  // any image whose shape differs from it — which, for a 6:1 banner, is nearly
  // every image anyone owns. The gap ends up in the output as transparency.
  it('is the LARGER ratio, so nothing is left uncovered', () => {
    // A 1000x500 image into a 300x300 window: height is the tight axis.
    expect(coverScale(1000, 500, 300, 300)).toBe(300 / 500);
    // The fit answer would have been 0.3 and would leave the sides bare.
    expect(coverScale(1000, 500, 300, 300)).toBeGreaterThan(Math.min(300 / 1000, 300 / 500));
  });

  it('covers a 6:1 banner window from a portrait photo', () => {
    const s = coverScale(1200, 1600, 420, 70);
    expect(1200 * s).toBeGreaterThanOrEqual(420 - 1e-9);
    expect(1600 * s).toBeGreaterThanOrEqual(70 - 1e-9);
  });

  it.each([
    [0, 100, 300, 300], [100, 0, 300, 300], [100, 100, 0, 300], [100, 100, 300, 0],
  ])('returns a usable scale for a degenerate input (%i,%i,%i,%i)', (a, b, c, d) => {
    expect(coverScale(a, b, c, d)).toBe(1);
  });
});

describe('clampOffset', () => {
  // At cover scale the tight axis is pinned — this is what stops a banner being
  // dragged off its own window.
  it('pins the axis that exactly fits', () => {
    const s = coverScale(1000, 500, 300, 300); // height tight
    expect(offsetLimit(1000, 500, s, 300, 300).y).toBeCloseTo(0, 9);
    expect(clampOffset({ x: 0, y: 999 }, 1000, 500, s, 300, 300).y).toBeCloseTo(0, 9);
  });

  it('allows travel on the loose axis, up to the edge', () => {
    const s = coverScale(1000, 500, 300, 300);
    const lim = offsetLimit(1000, 500, s, 300, 300);
    expect(lim.x).toBeGreaterThan(0);
    expect(clampOffset({ x: 1e6, y: 0 }, 1000, 500, s, 300, 300).x).toBeCloseTo(lim.x, 9);
    expect(clampOffset({ x: -1e6, y: 0 }, 1000, 500, s, 300, 300).x).toBeCloseTo(-lim.x, 9);
  });

  // ⚠️ THE DEFECT IN THE CLIENT'S OWN EDITOR. It does not clamp, so an image can
  // be dragged fully out of the crop window and Accept writes a blank avatar.
  it('never lets the image leave the window, however hard it is dragged', () => {
    const s = coverScale(800, 600, 300, 300) * 1.5;
    const off = clampOffset({ x: 99999, y: -99999 }, 800, 600, s, 300, 300);
    const w = 800 * s;
    const h = 600 * s;
    const dx = 300 / 2 + off.x - w / 2;
    const dy = 300 / 2 + off.y - h / 2;
    expect(dx).toBeLessThanOrEqual(1e-9);          // no gap on the left
    expect(dy).toBeLessThanOrEqual(1e-9);          // no gap on the top
    expect(dx + w).toBeGreaterThanOrEqual(300 - 1e-9); // none on the right
    expect(dy + h).toBeGreaterThanOrEqual(300 - 1e-9); // none at the bottom
  });

  it('survives a missing offset', () => {
    expect(clampOffset(undefined, 800, 600, 1, 300, 300)).toEqual({ x: 0, y: 0 });
  });
});

describe('cropRect', () => {
  const base = { imgW: 1000, imgH: 1000, boxW: 300, boxH: 300 };

  it('at cover scale with no offset, takes the whole image', () => {
    const s = coverScale(1000, 1000, 300, 300);
    const r = cropRect({ ...base, scale: s, offset: { x: 0, y: 0 } });
    expect(r.sx).toBeCloseTo(0, 6);
    expect(r.sy).toBeCloseTo(0, 6);
    expect(r.sw).toBeCloseTo(1000, 6);
    expect(r.sh).toBeCloseTo(1000, 6);
  });

  it('zoomed 2x, takes the middle quarter', () => {
    const s = coverScale(1000, 1000, 300, 300) * 2;
    const r = cropRect({ ...base, scale: s, offset: { x: 0, y: 0 } });
    expect(r.sw).toBeCloseTo(500, 6);
    expect(r.sh).toBeCloseTo(500, 6);
    expect(r.sx).toBeCloseTo(250, 6);
    expect(r.sy).toBeCloseTo(250, 6);
  });

  // ⚠️ A NEGATIVE OR OVER-LONG SOURCE RECT IS WHAT drawImage SILENTLY MISRENDERS.
  // The clamping is not decoration; it is what keeps the output correct at the
  // limits of the drag.
  it('never leaves the bounds of the source image, at any zoom or offset', () => {
    for (const scaleMul of [1, 1.3, 3, 8]) {
      for (const off of [{ x: 0, y: 0 }, { x: 1e6, y: 1e6 }, { x: -1e6, y: -1e6 }]) {
        const s = coverScale(1234, 567, 420, 70) * scaleMul;
        const r = cropRect({ imgW: 1234, imgH: 567, boxW: 420, boxH: 70, scale: s, offset: off });
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sw).toBeGreaterThan(0);
        expect(r.sh).toBeGreaterThan(0);
        expect(r.sx + r.sw).toBeLessThanOrEqual(1234 + 1e-6);
        expect(r.sy + r.sh).toBeLessThanOrEqual(567 + 1e-6);
      }
    }
  });

  // The rectangle handed to drawImage must have the OUTPUT's aspect ratio, or the
  // saved image is stretched — the failure a user reads as "it squashed my photo".
  it.each(Object.values(IMAGE_SPEC))('matches the target aspect ratio for %o', (spec) => {
    const { w: rw, h: rh } = parseRatio(spec.ratio);
    const box = previewBox(rw, rh);
    const s = coverScale(1600, 1200, box.w, box.h) * 1.7;
    const r = cropRect({ imgW: 1600, imgH: 1200, boxW: box.w, boxH: box.h, scale: s, offset: { x: 40, y: -20 } });
    expect(r.sw / r.sh).toBeCloseTo(box.w / box.h, 1);
  });
});

describe('previewBox', () => {
  it('keeps a square inside the height bound', () => {
    expect(previewBox(1, 1)).toEqual({ w: 300, h: 300 });
  });

  it('lays a 6:1 banner out as a wide strip', () => {
    const b = previewBox(6, 1);
    expect(b.w).toBe(420);
    expect(b.h).toBe(70);
  });

  it.each([[1, 1], [5, 1], [6, 1], [16, 9], [3, 4]])('never exceeds its bounds (%i:%i)', (w, h) => {
    const b = previewBox(w, h);
    expect(b.w).toBeLessThanOrEqual(420);
    expect(b.h).toBeLessThanOrEqual(300);
    expect(b.w / b.h).toBeCloseTo(w / h, 1);
  });
});

describe('parsing the spec', () => {
  // ⚠️ These parse the SAME strings the guidance renders, so a spec written in a
  // shape the cropper cannot read would advertise a size it then fails to produce.
  it.each(Object.entries(IMAGE_SPEC))('%s parses to a usable size and ratio', (_k, spec) => {
    const o = outputSize(spec.best);
    expect(Number.isFinite(o.w) && o.w > 0).toBe(true);
    expect(Number.isFinite(o.h) && o.h > 0).toBe(true);
    const r = parseRatio(spec.ratio);
    expect(o.w / o.h).toBeCloseTo(r.w / r.h, 2);
  });
});

describe('animated detection', () => {
  const webp = (bytes = []) => {
    const b = new Uint8Array(32);
    b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    for (const [i, v] of bytes) b[i] = v;
    return b;
  };
  const setFourcc = (b, o, s) => { b.set([...s].map((c) => c.charCodeAt(0)), o); return b; };

  it('spots the VP8X ANIM flag', () => {
    const b = setFourcc(webp(), 12, 'VP8X');
    b[20] = 0x02;
    expect(isAnimatedWebp(b)).toBe(true);
  });

  it('treats a still VP8X as still', () => {
    const b = setFourcc(webp(), 12, 'VP8X');
    b[20] = 0x00;
    expect(isAnimatedWebp(b)).toBe(false);
  });

  it('falls back to an explicit ANIM chunk', () => {
    expect(isAnimatedWebp(setFourcc(webp(), 16, 'ANIM'))).toBe(true);
  });

  it('rejects anything that is not a WebP container', () => {
    expect(isAnimatedWebp(new Uint8Array(32))).toBe(false);
    expect(isAnimatedWebp(new Uint8Array(2))).toBe(false);
  });

  // ⚠️ A CANVAS CAPTURES ONE FRAME, so this is what decides whether the dialog
  // warns before destroying an animation.
  it('calls a GIF animated from its type alone', async () => {
    expect(await isAnimatedImage({ type: 'image/gif' })).toBe(true);
  });

  it('calls a PNG still without reading it', async () => {
    expect(await isAnimatedImage({ type: 'image/png' })).toBe(false);
  });

  it('reads only the header of a WebP', async () => {
    let requested = null;
    const file = {
      type: 'image/webp',
      slice: (a, b) => { requested = [a, b]; return { arrayBuffer: async () => setFourcc(webp(), 16, 'ANIM').buffer }; },
    };
    expect(await isAnimatedImage(file)).toBe(true);
    expect(requested).toEqual([0, 4096]);
  });

  it('treats an unreadable file as still rather than throwing', async () => {
    const file = { type: 'image/webp', slice: () => ({ arrayBuffer: async () => { throw new Error('nope'); } }) };
    expect(await isAnimatedImage(file)).toBe(false);
  });
});
