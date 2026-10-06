// book-snippets.js — "what the book says": the part of the real page a find was read from, as pictures, for the
// review's Look (spec 2026-10-06 on-device AI, step 1). Made only when the DM opens a find, from the PDF the review
// still holds (S.pdf); never saved. One PDF open at a time; closeSnippets() when the review ends.
import { pdfjs, openPdf } from './book-pdf.js';
import { toPageRect } from './book-snippet-geom.js';

const SCALE = 2; // render at 2× so small stat-block type stays readable
let _blob = null, _doc = null;
const _urls = new Map(); // find key → [object URL]

async function docFor(blob) {
  if (_blob !== blob) { closeSnippets(); _blob = blob; _doc = openPdf(await pdfjs(), blob); }
  return _doc;
}

/** Object URLs of the pictures of `src` (entryRegions), one per region; cached under `key` for this PDF. */
export async function snippetUrls(blob, key, src) {
  if (_blob === blob && _urls.has(key)) return _urls.get(key);
  const doc = await docFor(blob);
  const urls = [];
  for (const r of src || []) {
    const page = await doc.getPage(r.page);
    try {
      const one = page.getViewport({ scale: 1 });
      const rect = toPageRect(r, one.width, one.height);
      if (!rect) continue;
      const vp = page.getViewport({ scale: SCALE });
      const full = document.createElement('canvas');
      full.width = Math.round(vp.width); full.height = Math.round(vp.height);
      const ctx = full.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, full.width, full.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas: full }).promise;
      const out = document.createElement('canvas');
      out.width = Math.round(rect.w * SCALE); out.height = Math.round(rect.h * SCALE);
      out.getContext('2d').drawImage(full, rect.x * SCALE, rect.y * SCALE, out.width, out.height, 0, 0, out.width, out.height);
      full.width = full.height = 0;
      const pic = await new Promise(res => out.toBlob(res, 'image/webp', 0.85));
      if (pic) urls.push(URL.createObjectURL(pic));
    } finally { page.cleanup(); }
  }
  if (_blob === blob) _urls.set(key, urls);
  return urls;
}

/** Forget the open PDF and its pictures (leaving the review). */
export function closeSnippets() {
  for (const list of _urls.values()) for (const u of list) URL.revokeObjectURL(u);
  _urls.clear();
  const d = _doc; _doc = null; _blob = null;
  d?.then(doc => doc.destroy()).catch(() => {});
}
