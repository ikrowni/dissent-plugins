// book-images.js — the pictures in a book (maps, art): which to offer, and their pixels as RGBA. Pure.
// book-pdf.js finds them on each page; the review screen lets the DM keep them as maps or art.

/** Small pictures are decoration (borders, icons, ornaments): only these sizes and up are offered. */
export const MIN_SIDE = 300, MIN_AREA = 160_000;
export const isWorthOffering = (w, h) => Math.min(w, h) >= MIN_SIDE && w * h >= MIN_AREA;

/**
 * A first guess, the DM decides. A picture on a page that says "map" is a map (it finds 6 of the 8 maps in
 * Heliana's Guide, where size finds none); a whole page with no such word is art; otherwise big and roughly
 * landscape or square is a map, tall is art.
 */
export function guessKind(w, h, { mapWord = false, fullPage = false, clear = 0 } = {}) {
  if (clear > CUTOUT_CLEAR) return 'art'; // a see-through cut-out (a creature) is never a map, however big and wide
  if (mapWord) return 'map';
  if (fullPage) return 'art';
  return w >= 1000 && w / h >= 0.8 ? 'map' : 'art';
}

/** Share of the page a picture is drawn over at or above which it is a whole page (a background, or a scan). */
export const FULL_PAGE = 0.85;
export const SAMPLE = 64; // pictureStats looks at a SAMPLE×SAMPLE copy

/**
 * What a small copy of a picture looks like: `edge` (mean brightness change between neighbours, 0–255), `bw` (share
 * of pixels that are near-black or near-white and colourless), `spread` (standard deviation of brightness), `clear`
 * (share of see-through pixels).
 * `rgba`: Uint8ClampedArray of w×h×4.
 */
export function pictureStats(rgba, w, h) {
  const lum = new Float32Array(w * h);
  let bw = 0, sum = 0, clear = 0;
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (rgba[i * 4 + 3] < 200) clear++;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = y; sum += y;
    if ((y < 24 || y > 232) && Math.max(r, g, b) - Math.min(r, g, b) < 24) bw++;
  }
  const mean = sum / (w * h);
  let edge = 0, n = 0, varSum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    varSum += (lum[i] - mean) ** 2;
    if (x + 1 < w) { edge += Math.abs(lum[i] - lum[i + 1]); n++; }
    if (y + 1 < h) { edge += Math.abs(lum[i] - lum[i + w]); n++; }
  }
  return { edge: n ? edge / n : 0, bw: bw / (w * h), spread: Math.sqrt(varSum / (w * h)), clear: clear / (w * h) };
}

/**
 * Pictures that are not pictures, left out of the offer (null = a real picture):
 *  'mask'       — solid black and white: a stencil the PDF paints through (Heliana's stat-block frames, ~92% pure
 *                 black/white with soft edges). Cut-out art is as black but see-through, so it is not one.
 *  'blank'      — almost one flat colour (a paper texture), or almost all see-through.
 *  'background' — a whole page with little on it: the parchment behind the text (Heliana: one per page, 412 of them).
 */
export function notAPicture({ cover = 0, stats }) {
  if (!stats) return null;
  if ((stats.clear ?? 0) >= EMPTY_CLEAR) return 'blank'; // almost all see-through: a swoosh on an empty canvas
  if (stats.bw >= MASK_BW && (stats.clear ?? 0) < 0.2) return 'mask';
  if (stats.spread < BLANK_SPREAD && stats.edge < BLANK_EDGE) return 'blank';
  if (cover >= FULL_PAGE && stats.edge < BACKGROUND_EDGE) return 'background';
  return null;
}
// Measured on Heliana's Guide (2026-10-06): see book-images.test.js.
export const MASK_BW = 0.9, BLANK_SPREAD = 8, BLANK_EDGE = 2, BACKGROUND_EDGE = 7, CUTOUT_CLEAR = 0.2, EMPTY_CLEAR = 0.9;

/** The grid's thumbnails are this wide at most: hundreds of full pictures decoding at once stalled the review (Heliana). */
export const THUMB = 360;

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
