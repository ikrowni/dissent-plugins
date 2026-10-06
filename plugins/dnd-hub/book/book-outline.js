// book-outline.js — the PDF's own bookmarks (its outline) as the book's index. Pure.
//
// WHY: headings guessed from type sizes made a poor index — a big art caption or a scan's misread line became a
// section ("L FIGURE STANDS SILHOUETTED AGAINST THE", Curse of Strahd), and a book with many heading sizes came out
// flat or scattered. Most published PDFs carry an outline the publisher wrote (Heliana's Guide: 2,647 bookmarks), so
// when there is one, its entries open the chapters and sections, and other big text stays inside as a sub-heading.
// A bookmark whose heading is not in the story (a stat block or spell claimed those lines) opens nothing.
// Outline entry: { title, page, depth } (flatOutline). readOutline takes it from a pdf.js document (no DOM needed).

// "1 — Polyhedrooze", "Chapter 3: The Village" and "POLYHEDROOZE" all compare as their words.
const norm = t => String(t || '').toLowerCase()
  .replace(/^\s*(chapter|part|appendix)?\s*([0-9]+|[ivxlc]+|[a-z])\s*[—–\-:.)]\s+/i, '')
  .replace(/[^a-z0-9]+/g, '');

/**
 * A nested outline ({ title, page, items }) → [{ title, page, depth }], in page order (bookmarks need not be).
 * Real outlines are untidy, so: the same bookmark repeated on one page is kept once (Heliana's lists some 8 times),
 * and a run of RUN or more top-level bookmarks with nothing under them are sections rather than chapters (a book's
 * spells bookmarked flat, one "chapter" per spell); the chapter they belong to is then the page's own heading.
 */
const RUN = 3;
export function flatOutline(tree) {
  const out = [];
  const walk = (items, depth) => {
    for (const it of items || []) {
      const title = String(it.title || '').replace(/\s+/g, ' ').trim();
      const kids = (it.items || []).length;
      if (title && Number.isFinite(it.page)) out.push({ title, page: it.page, depth, kids, n: out.length });
      walk(it.items, depth + 1);
    }
  };
  walk(tree, 0);
  // Top-level entries can be in any order (Heliana lists its bestiary first); children always follow their parent.
  out.sort((a, b) => a.page - b.page || a.n - b.n);
  const seen = new Set();
  const once = out.filter(e => { const k = `${e.page}:${norm(e.title)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const tops = once.filter(e => e.depth === 0);
  for (let i = 0; i < tops.length;) {
    let j = i;
    while (j < tops.length && !tops[j].kids) j++;
    if (j - i >= RUN) for (let k = i; k < j; k++) tops[k].depth = 1;
    i = Math.max(j, i + 1);
  }
  const top = Math.min(...once.map(e => e.depth)); // an outline may start one level down (Black Flag)
  return once.map(({ n, kids, ...e }) => ({ ...e, depth: e.depth - top }));
}

// A top bookmark is a chapter, and so is one NAMED like a chapter wherever the publisher nested it (Heliana keeps its
// appendices one level down, under "Part Three", after the adventures).
const isChapter = e => e.depth === 0 || /^(chapter|part|appendix)\b/i.test(e.title);

const matches = (got, want) => got === want
  || (got.length >= 4 && want.length >= 4 && (got.includes(want) || want.includes(got))
    && Math.min(got.length, want.length) / Math.max(got.length, want.length) >= 0.6);

/**
 * Which story lines the bookmarks open: Map(line index → { title, level, span? }). `level`: 'chapter' (isChapter, or
 * nothing above it yet), 'section' (one level under its chapter, or beside it), 'sub' (deeper: a heading inside its
 * section — Free5e bookmarks every class feature, 670 entries). A heading set over two lines matches as one
 * (`span: 2`). Among lines on the bookmark's page that match, the biggest type wins (the heading, not a mention).
 */
export function outlineMarks(lines, outline) {
  const marks = new Map();
  let chapterDepth = null;
  for (const e of outline || []) {
    let level;
    if (isChapter(e) || chapterDepth === null) { level = 'chapter'; chapterDepth = e.depth; }
    else level = e.depth <= chapterDepth + 1 ? 'section' : 'sub';
    const want = norm(e.title);
    if (want.length < 3) continue;
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.page !== e.page || marks.has(i)) continue;
      const next = lines[i + 1]?.page === l.page ? lines[i + 1] : null;
      const one = norm(l.text);
      const span = matches(one, want) ? 1 : next && norm(l.text + ' ' + next.text) === want ? 2 : 0;
      if (span && (!best || l.size > lines[best.i].size)) best = { i, span };
    }
    if (best) marks.set(best.i, { title: e.title, level, ...(best.span > 1 ? { span: 2 } : {}) });
  }
  return marks;
}

/** Whether the bookmarks are worth trusting over the type sizes: a real outline (not one or two), and enough matched. */
const MIN_BOOKMARKS = 5, MIN_MATCHED = 3;
export const outlineUsable = (marks, outline) => (outline || []).length >= MIN_BOOKMARKS && marks.size >= MIN_MATCHED;

/** The PDF's bookmarks with their page numbers, from a pdf.js document; [] when it has none. */
export async function readOutline(doc) {
  const tree = await doc.getOutline();
  if (!tree?.length) return [];
  const pageOf = async dest => {
    try {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      return Array.isArray(d) && d[0] ? (typeof d[0] === 'number' ? d[0] : await doc.getPageIndex(d[0])) + 1 : null;
    } catch { return null; }
  };
  const withPages = async items => Promise.all((items || []).map(async it => ({
    title: it.title, page: await pageOf(it.dest), items: await withPages(it.items) })));
  return flatOutline(await withPages(tree));
}

