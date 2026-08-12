// core/image-crop.js — choosing which part of an image is used.
//
// The maths behind the crop dialog, kept apart from the DOM so every decision it
// makes is testable. `views/crop-dialog.js` owns the pixels and the pointer
// events; this file owns what a zoom level means and where the image is allowed
// to sit.
//
// ⚠️ THE MODEL, stated once, because everything here depends on it: the image is
// drawn CENTRED in the crop window, scaled by `scale`, then displaced by
// `offset`. So its top-left corner in window coordinates is
//
//     dx = boxW / 2 + offset.x - (imgW * scale) / 2
//
// and the window itself is always the rectangle (0, 0, boxW, boxH). Every
// function below is a consequence of those two lines.
//
// ⚠️ THIS MATCHES THE CLIENT'S OWN `ImageCropEditor` DELIBERATELY — scroll to
// zoom, drag to reposition, a zoom slider, Cancel/Accept — because a second
// interaction for the same job is the thing users actually notice. It differs in
// exactly two ways, both of them fixes, and both are commented where they occur:
// the minimum zoom is COVER rather than fit, and the offset is CLAMPED.

/**
 * The smallest scale at which the image still covers the whole window.
 *
 * ⚠️ COVER, NOT FIT. The client's editor starts at `Math.min(...)` — fit — which
 * for any image whose shape differs from the window leaves the window partly
 * EMPTY, and that empty region is encoded into the output as transparent (or
 * black, once flattened to JPEG). For a 6:1 banner, which almost nothing is
 * natively shaped like, fit would be the normal case rather than the edge one.
 * A crop tool's floor has to be the point where there is nothing missing.
 */
export function coverScale(imgW, imgH, boxW, boxH) {
  if (!imgW || !imgH || !boxW || !boxH) return 1;
  return Math.max(boxW / imgW, boxH / imgH);
}

/**
 * How far the image may be dragged before a gap would open.
 *
 * At cover scale this is exactly 0 on the tight axis — the image is pinned —
 * which is correct and is what stops a 6:1 banner being dragged off its own
 * window.
 */
export function offsetLimit(imgW, imgH, scale, boxW, boxH) {
  return {
    x: Math.max(0, (imgW * scale - boxW) / 2),
    y: Math.max(0, (imgH * scale - boxH) / 2),
  };
}

/**
 * Pull an offset back inside the legal range.
 *
 * ⚠️ THE CLIENT'S EDITOR DOES NOT DO THIS, and that is a real defect there: an
 * image can be dragged fully out of the crop window, and Accept then writes an
 * entirely blank avatar with no warning. Clamping makes the drag feel like the
 * image is being moved *behind* a window, which is what people expect.
 */
export function clampOffset(offset, imgW, imgH, scale, boxW, boxH) {
  const lim = offsetLimit(imgW, imgH, scale, boxW, boxH);
  return {
    x: Math.min(lim.x, Math.max(-lim.x, offset?.x ?? 0)),
    y: Math.min(lim.y, Math.max(-lim.y, offset?.y ?? 0)),
  };
}

/**
 * The region of the ORIGINAL image the window is currently showing, in source
 * pixels — which is exactly `drawImage`'s source rectangle.
 *
 * ⚠️ Derived from the draw model rather than tracked alongside it. Keeping a
 * second copy of "where are we" in sync with the first is how a crop preview
 * comes to disagree with the file it produces.
 */
export function cropRect({ imgW, imgH, scale, offset, boxW, boxH }) {
  const off = clampOffset(offset, imgW, imgH, scale, boxW, boxH);
  const dx = boxW / 2 + off.x - (imgW * scale) / 2;
  const dy = boxH / 2 + off.y - (imgH * scale) / 2;
  const sx = -dx / scale;
  const sy = -dy / scale;
  const sw = boxW / scale;
  const sh = boxH / scale;
  // Rounding is deliberately last: rounding the inputs compounds through the
  // division and can walk the rectangle off the edge of the source image.
  return {
    sx: Math.max(0, Math.min(imgW, sx)),
    sy: Math.max(0, Math.min(imgH, sy)),
    sw: Math.max(1, Math.min(imgW - Math.max(0, sx), sw)),
    sh: Math.max(1, Math.min(imgH - Math.max(0, sy), sh)),
  };
}

/**
 * The preview window's size on screen for a given output shape.
 *
 * ⚠️ A 6:1 BANNER IS THE CASE THAT BREAKS A FIXED SQUARE PREVIEW. The client's
 * editor is square-only (`outputSize` is one number); ours has to show a strip
 * 420px wide and 70px tall as readily as a 300px square, so the window is fitted
 * inside a bounding box instead of assumed.
 */
export function previewBox(ratioW, ratioH, { maxW = 420, maxH = 300 } = {}) {
  const r = ratioW / ratioH;
  const w = Math.min(maxW, maxH * r);
  return { w: Math.round(w), h: Math.round(w / r) };
}

/** `"1800 × 300"` → `{ w: 1800, h: 300 }`. The one place that shape is parsed. */
export function outputSize(best) {
  const [w, h] = String(best).split('×').map((n) => Number(n.trim()));
  return { w, h };
}

/** `"6 / 1"` → `{ w: 6, h: 1 }`. */
export function parseRatio(ratio) {
  const [w, h] = String(ratio).split('/').map((n) => Number(n.trim()));
  return { w, h };
}

const fourcc = (b, o) => (b.length >= o + 4
  ? String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) : '');

/**
 * Is this an animated WebP?
 *
 * ⚠️ A PORT OF THE CLIENT'S `isAnimatedWebp`, kept behaviourally identical on
 * purpose — the same file must be judged the same way by both halves of the
 * product, or an image that keeps its animation in a Dissent profile loses it
 * here for no reason the user can see.
 */
export function isAnimatedWebp(bytes) {
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') return false;
  if (fourcc(bytes, 12) === 'VP8X' && bytes.length >= 21 && (bytes[20] & 0x02) !== 0) return true;
  const limit = Math.min(bytes.length - 4, 4096);
  for (let i = 12; i <= limit; i += 1) if (fourcc(bytes, i) === 'ANIM') return true;
  return false;
}

/**
 * Would cropping this file destroy something?
 *
 * ⚠️ A CANVAS CAPTURES ONE FRAME. Re-encoding a GIF through the crop flattens it
 * to a still, silently — the user picked a moving image and gets a motionless
 * one. The dialog asks rather than deciding, which is why this returns a fact
 * rather than performing an action.
 */
export async function isAnimatedImage(file) {
  if (file?.type === 'image/gif') return true;
  if (file?.type === 'image/webp') {
    try {
      return isAnimatedWebp(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
    } catch {
      return false;
    }
  }
  return false;
}
