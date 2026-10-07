// book-snippet-geom.js — where a parsed entry (monster, spell, item) sits on its page(s), from its lines. Pure.
// The review's Look shows that part of the real page beside what was read ("what the book says"), so the DM can
// compare and correct (spec 2026-10-06 on-device AI, step 1). pdf.js lines measure y from the BOTTOM of the page
// (their baseline); our OCR's lines say `fromTop` and measure their top from the top.
// Region: { page, x0, x1, top, bottom, fromTop } in PDF points, in the lines' own direction.

export const MARGIN = 6;     // points round the box
const SAME_COLUMN = 120;     // lines whose left edges are this close share a column (indents included)
const DESCENT = 0.3;         // how far a baseline line reaches below its baseline, as a share of its size
const OCR_LINE = 1.2;        // how far an OCR line reaches below its top, as a share of its size

/** The regions of `lines[a..b]`: one per page and column, in reading order. */
export function entryRegions(lines, range) {
  if (!Array.isArray(range)) return [];
  const [a, b] = range;
  const out = [];
  for (let i = a; i <= b && i < lines.length; i++) {
    const l = lines[i];
    if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) continue;
    const fromTop = !!l.fromTop;
    const top = fromTop ? l.y : l.y + l.size;
    const bottom = fromTop ? l.y + l.size * OCR_LINE : l.y - l.size * DESCENT;
    const right = l.x + (l.w || 0);
    let r = out.find(o => o.page === l.page && Math.abs(o.x0 - l.x) < SAME_COLUMN);
    if (!r) { r = { page: l.page, x0: l.x, x1: right, top, bottom, fromTop }; out.push(r); continue; }
    r.x0 = Math.min(r.x0, l.x); r.x1 = Math.max(r.x1, right);
    r.top = fromTop ? Math.min(r.top, top) : Math.max(r.top, top);
    r.bottom = fromTop ? Math.max(r.bottom, bottom) : Math.min(r.bottom, bottom);
  }
  return out.map(r => ({ ...r, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) }));
}

/** A region as a top-down rectangle { x, y, w, h } in points on a `width`×`height` page, with MARGIN; null if empty. */
export function toPageRect(r, width, height) {
  const top = r.fromTop ? r.top : height - r.top;
  const bottom = r.fromTop ? r.bottom : height - r.bottom;
  const x = Math.max(0, r.x0 - MARGIN), y = Math.max(0, top - MARGIN);
  const x2 = Math.min(width, r.x1 + MARGIN), y2 = Math.min(height, bottom + MARGIN);
  return x2 - x > 1 && y2 - y > 1 ? { x, y, w: x2 - x, h: y2 - y } : null;
}

// A score strip (book-ai-scores.js): the "STR DEX CON INT WIS CHA" line and the row of numbers under it. The spike
// cut from just above the header to 22 points below its bottom (header ≈ 12 points): about 1.9 header heights.
const SCORE_ROW_BELOW = 1.9;

// The numbers are wider than the words over them ("14 (+2)" under "CHA"): without this the last modifier was cut off
// on Ravenloft's strips. The spike's crops had about this much either side.
const SCORE_ROW_SIDE = 1.2;
const SCORE_WORD = /\b(STR|DEX|CON|INT|WIS|CHA)\b/i;

/** The region of a score header line and the number row under it, in the line's own direction; null if unplaced. A
 *  header the text layer split into pieces on one baseline ("STR" apart from "DEX … CHA") is taken whole. */
export function scoreRegion(lines, i) {
  const l = lines?.[i];
  if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y) || !(l.size > 0)) return null;
  let x0 = l.x, x1 = l.x + (l.w || 0);
  for (let j = Math.max(0, i - 3); j <= i + 3 && j < lines.length; j++) {
    const o = lines[j];
    if (j === i || !o || o.page !== l.page || !!o.fromTop !== !!l.fromTop || !Number.isFinite(o.x)) continue;
    if (Math.abs(o.y - l.y) < l.size * 0.6 && SCORE_WORD.test(o.text || '')) { x0 = Math.min(x0, o.x); x1 = Math.max(x1, o.x + (o.w || 0)); }
  }
  const side = l.size * SCORE_ROW_SIDE;
  const fromTop = !!l.fromTop;
  const top = fromTop ? l.y : l.y + l.size;
  const headerBottom = fromTop ? l.y + l.size * OCR_LINE : l.y - l.size * DESCENT;
  const bottom = fromTop ? headerBottom + l.size * SCORE_ROW_BELOW : headerBottom - l.size * SCORE_ROW_BELOW;
  return { page: l.page, x0: +(x0 - side).toFixed(1), x1: +(x1 + side).toFixed(1), top: +top.toFixed(1), bottom: +bottom.toFixed(1), fromTop };
}
