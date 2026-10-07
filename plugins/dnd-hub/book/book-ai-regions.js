// book-ai-regions.js — "Find pictures" in the box tool: the DM's own PC boxes the art painted into a page (plugin
// capability `ai.regions`, Windows desktop app; spec 2026-10-06 on-device AI §5.1c). Measured on Heliana's painted
// pages: 9 of 10 pieces of art boxed, never a text column; ~2 s a page. The boxes become the tool's dashed
// suggestions, one click takes one. Asked for one page at a time, when the DM clicks; remembered for the session only.
import { request } from '../../plugin-sdk.js';

const WHOLE_PAGE = 0.9;  // a box this much of the page means "the page is one picture" or "nothing found": no help
const TINY = 0.004;      // smaller than this share of the page is not worth offering
const INSIDE = 0.9;      // a box this much inside a bigger one is the same picture found twice

const area = r => r[2] * r[3];
function overlap(a, b) {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The answer's boxes as box-tool rects [x, y, w, h]: no whole page, no specks, no box inside a bigger one. */
export function boxesFromRegions(regions) {
  const rects = (Array.isArray(regions) ? regions : [])
    .map(b => [b?.x, b?.y, b?.w, b?.h].map(v => Math.min(1, Math.max(0, Number(v) || 0))))
    .map(([x, y, w, h]) => [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)])
    .filter(r => area(r) >= TINY && area(r) < WHOLE_PAGE)
    .sort((a, b) => area(b) - area(a));
  const kept = [];
  for (const r of rects) if (!kept.some(k => overlap(k, r) >= INSIDE * area(r))) kept.push(r);
  return kept.map(r => r.map(v => +v.toFixed(4)));
}

const _found = new Map(); // `${book}:${doc}:${page}` → rects, this session

/**
 * Boxes round the pictures on one page: { rects } or { why } when the AI could not answer. `pagePicture()` gives the
 * whole page as a Blob (the box tool's own cut of [0, 0, 1, 1]: sharp from the PDF when it is open).
 */
export async function findPictures(bookId, place, pagePicture) {
  const key = `${bookId}:${place.doc}:${place.page}`;
  if (_found.has(key)) return { rects: _found.get(key) };
  let r;
  try { r = await request('ai.regions', { image: await pagePicture() }, 15 * 60000); } catch (err) {
    const msg = String(err?.message || err);
    return { why: /not granted|no longer declared/.test(msg) ? 'LanternKeep has not been allowed to find pictures with on-device AI on this server yet.'
      : /unknown action/.test(msg) ? 'Update the Dissent app to use on-device AI.' : `On-device AI could not run (${msg}).` };
  }
  if (!r?.available) return { why: `On-device AI is not available: ${r?.why || 'no answer'}.` };
  const rects = boxesFromRegions(r.regions);
  _found.set(key, rects);
  return { rects };
}
/** Test seam. */
export function _forgetFound() { _found.clear(); }
