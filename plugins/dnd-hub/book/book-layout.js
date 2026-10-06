// book-layout.js — one PDF page's text (pdf.js getTextContent items) as lines in reading order.
// Pure: no pdf.js here; book-pdf.js feeds it. Two-column pages read the left column, then the right; a line that
// crosses the middle (a chapter heading, a full-width table) is read where it stands and splits the columns above
// and below it. Running headers, footers and bare page numbers are dropped.
// Each line: { text, size, runs: [{ text, font }], page, x, w (width), y (baseline, from the page's bottom) }.

const BAND = 0.055;     // top and bottom share of the page that holds running headers and footers
const Y_TOL = 2.2;      // items within this many points vertically are one line

const widthOf = it => it.width || (it.str.length * (it.height || 10) * 0.5);

/** Lines of one page, in reading order. `p`: { items, width, height }. */
export function pageLines(p, pageNo = 1) {
  const items = (p.items || [])
    .filter(it => it && typeof it.str === 'string' && it.str.trim() !== '')
    .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], h: it.height || Math.abs(it.transform[3]) || 0,
      w: widthOf(it), font: it.fontName || '' }))
    .filter(it => it.y < p.height * (1 - BAND) && it.y > p.height * BAND)
    .filter(drawnOnce());
  const mid = columnSplit(items, p.width);

  // Group into rows by y, then split each row at the middle unless one item crosses it.
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const row = rows.find(r => Math.abs(r.y - it.y) <= Y_TOL);
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  const lines = [];
  for (const r of rows) {
    const crosses = r.items.some(it => it.x < mid - 4 && it.x + it.w > mid + 20);
    const groups = crosses ? { full: r.items }
      : { left: r.items.filter(it => it.x < mid), right: r.items.filter(it => it.x >= mid) };
    for (const [col, its] of Object.entries(groups)) if (its.length) lines.push(makeLine(its, col, r.y, pageNo));
  }

  // Reading order: full-width lines split the page into bands; within a band, left column then right.
  lines.sort((a, b) => b.y - a.y);
  const out = [];
  let band = [];
  const flush = () => {
    out.push(...band.filter(l => l.col === 'left'), ...band.filter(l => l.col === 'right'));
    band = [];
  };
  for (const l of lines) {
    if (l.col === 'full') { flush(); out.push(l); } else band.push(l);
  }
  flush();
  // A line set in from its column's left edge starts a paragraph.
  const left = {};
  for (const l of out) left[l.col] = Math.min(left[l.col] ?? Infinity, l.x);
  return out.filter(l => !/^\d{1,4}$/.test(l.text)).map(({ col, ...l }) => ({ ...l, indent: l.x > left[col] + 4 }));
}

/**
 * Where the right column starts. The middle of the page, unless the right column starts just LEFT of it: Heliana's wide
 * stat blocks start their right column at x 295 on a 595-point page (middle 297.5), and splitting at the middle glued
 * its words onto left-column lines ("Tar-rasque Actions"). A column edge is where several items start at one x, with
 * a gutter left of it that little crosses; a table inside the left column lines up too, but text runs through its gaps.
 */
export function columnSplit(items, width) {
  // Only just left of the middle: a table inside the left column lines up too (the SRD 5.2.1's ability scores at
  // x 256 and 274 on a 594-point page), but a column edge sits by the middle (Heliana's: 5 points off).
  const mid = width / 2, lo = mid - width * 0.03;
  const n = {};
  for (const it of items) if (it.x > lo && it.x < mid) { const k = Math.round(it.x); n[k] = (n[k] || 0) + 1; }
  let best = null, bestN = 0;
  for (const k of Object.keys(n).map(Number)) {
    const c = (n[k] || 0) + (n[k - 1] || 0) + (n[k + 1] || 0);
    if (c > bestN) { best = k; bestN = c; }
  }
  if (bestN < 3) return mid;
  if (items.filter(it => it.x < best - 6 && it.x + it.w > best - 2).length * 2 >= bestN) return mid;
  // Split just left of the column's leftmost start: Heliana sets its headings ("Actions") 3 points left of the body.
  const first = Math.min(...items.filter(it => it.x >= best - 6 && it.x <= best + 1).map(it => it.x));
  return first - 1.5;
}

// Some books draw a run twice in one spot (an outlined heading: stroke, then fill). Read it once, or every heading
// comes out doubled ("CreditsCredits", Heliana's Guide to Monster Hunting).
const SAME_SPOT = 1;
function drawnOnce() {
  const seen = [];
  return it => {
    if (seen.some(s => s.str === it.str && Math.abs(s.x - it.x) < SAME_SPOT && Math.abs(s.y - it.y) < SAME_SPOT)) return false;
    seen.push(it);
    return true;
  };
}

function makeLine(its, col, y, page) {
  its.sort((a, b) => a.x - b.x);
  const runs = [];
  let text = '', prevEnd = null;
  for (const it of its) {
    const gap = prevEnd == null ? 0 : it.x - prevEnd;
    const glue = prevEnd != null && gap > it.h * 0.12 && !text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '';
    text += glue + it.str;
    const last = runs[runs.length - 1];
    if (last && last.font === it.font) last.text += glue + it.str; else runs.push({ text: it.str.trim(), font: it.font });
    prevEnd = it.x + it.w;
  }
  for (const r of runs) r.text = clean(r.text);
  const last = its[its.length - 1];
  return { text: clean(text), size: Math.max(...its.map(i => i.h)), runs, page, x: its[0].x,
    w: +(last.x + last.w - its[0].x).toFixed(1), y, col };
}

// Soft hyphens and the typographic hyphens some books use ("non-\u00ad\u2010lawful") become one plain hyphen.
function clean(t) {
  return t.replace(/\u00ad/g, '').replace(/[\u2010\u2011]/g, '-').replace(/-{2,}/g, '-').replace(/\s+/g, ' ').trim();
}
