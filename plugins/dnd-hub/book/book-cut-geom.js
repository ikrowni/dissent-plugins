// book-cut-geom.js — the box the DM draws on a page to cut out a map, art or a handout (plan 2026-10-06 page
// reader). Pure. A box is [x, y, w, h] in fractions of the page (0–1), so it means the same on the 900 px page
// picture, on screen at any zoom, and on the PDF page itself.

/** A box under this share of the page on either side is a click, not a box. */
export const MIN = 0.02;
/** Drawn from the PDF, a box's long side comes out about TARGET pixels, never more than MAX_SIDE. */
export const TARGET = 2560, MAX_SIDE = 4096, MAX_SCALE = 10;

const clamp01 = v => Math.min(1, Math.max(0, v));

/** The box between where a drag started and where the pointer is now, kept on the page. */
export function rectFromDrag(a, b) {
  const x0 = clamp01(Math.min(a.x, b.x)), y0 = clamp01(Math.min(a.y, b.y));
  const x1 = clamp01(Math.max(a.x, b.x)), y1 = clamp01(Math.max(a.y, b.y));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** The box moved by (dx, dy), stopped at the page's edges. */
export function moveRect([x, y, w, h], dx, dy) {
  return [Math.min(1 - w, Math.max(0, x + dx)), Math.min(1 - h, Math.max(0, y + dy)), w, h];
}

/**
 * The box with one handle dragged by (dx, dy): 'n' 's' 'e' 'w' move one edge, 'ne' 'nw' 'se' 'sw' two. An edge stops
 * at the page's edge and MIN short of the opposite one.
 */
export function resizeRect([x, y, w, h], handle, dx, dy) {
  let l = x, t = y, r = x + w, b = y + h;
  if (handle.includes('w')) l = Math.min(r - MIN, Math.max(0, l + dx));
  if (handle.includes('e')) r = Math.max(l + MIN, Math.min(1, r + dx));
  if (handle.includes('n')) t = Math.min(b - MIN, Math.max(0, t + dy));
  if (handle.includes('s')) b = Math.max(t + MIN, Math.min(1, b + dy));
  return [l, t, r - l, b - t];
}

export const tooSmall = r => !r || r[2] < MIN - 1e-9 || r[3] < MIN - 1e-9;

/** The box as whole pixels of a W×H picture, at least one pixel, inside the picture. */
export function toPixels([x, y, w, h], W, H) {
  const px = Math.min(W - 1, Math.max(0, Math.round(x * W))), py = Math.min(H - 1, Math.max(0, Math.round(y * H)));
  return { x: px, y: py, w: Math.max(1, Math.min(W - px, Math.round(w * W))), h: Math.max(1, Math.min(H - py, Math.round(h * H))) };
}

/** The scale to draw a PDF page at (`pw`×`ph` points) so the box comes out about TARGET pixels on its long side. */
export function pdfScale([, , w, h], pw, ph) {
  const long = Math.max(w * pw, h * ph) || 1;
  return Math.min(MAX_SCALE, TARGET / long, MAX_SIDE / long);
}
