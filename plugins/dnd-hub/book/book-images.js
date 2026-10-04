// book-images.js — the pictures in a book (maps, art): which to offer, and their pixels as RGBA. Pure.
// book-pdf.js finds them on each page; the review screen lets the DM keep them as maps or art.

/** Small pictures are decoration (borders, icons, ornaments): only these sizes and up are offered. */
export const MIN_SIDE = 300, MIN_AREA = 160_000;
export const isWorthOffering = (w, h) => Math.min(w, h) >= MIN_SIDE && w * h >= MIN_AREA;

/** A first guess, the DM decides: big and roughly landscape or square is a map; tall is art. */
export const guessKind = (w, h) => (w >= 1000 && w / h >= 0.8 ? 'map' : 'art');

/** Fit w×h within `max` on its longer side, keeping the shape. */
export function fitWithin(w, h, max = 4096) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * RGBA pixels from a pdf.js image object ({ width, height, kind, data }): kind 1 = 1 bit grey (packed), 2 = RGB,
 * 3 = RGBA. Null for a shape it cannot read.
 */
export function rgbaFrom(img) {
  const { width: w, height: h, kind, data } = img || {};
  if (!w || !h || !data) return null;
  const out = new Uint8ClampedArray(w * h * 4);
  if (kind === 3 && data.length >= w * h * 4) { out.set(data.subarray ? data.subarray(0, w * h * 4) : data.slice(0, w * h * 4)); return out; }
  if (kind === 2 && data.length >= w * h * 3) {
    for (let i = 0, j = 0; i < w * h; i++, j += 3) { out[i * 4] = data[j]; out[i * 4 + 1] = data[j + 1]; out[i * 4 + 2] = data[j + 2]; out[i * 4 + 3] = 255; }
    return out;
  }
  if (kind === 1) {
    const row = Math.ceil(w / 8);
    if (data.length < row * h) return null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const on = (data[y * row + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = on ? 255 : 0, i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
    }
    return out;
  }
  return null;
}

/**
 * A cheap fingerprint, so a picture printed on several pages is offered once. Needs the pixels (`data`): book-pdf.js
 * passes a small copy for a picture the browser decoded, since size alone does not tell two maps apart.
 */
export function fingerprint(img) {
  const d = img?.data;
  if (!d) return `${img?.width}x${img?.height}`;
  let h = 2166136261;
  const step = Math.max(1, Math.floor(d.length / 4096));
  for (let i = 0; i < d.length; i += step) { h ^= d[i]; h = Math.imul(h, 16777619); }
  return `${img.width}x${img.height}:${(h >>> 0).toString(36)}`;
}
