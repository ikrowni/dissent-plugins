// book-story.js — a book's running text (what no stat block, spell or item claimed) → the book's INDEX. Pure.
// The reader shows the real pages (plan 2026-10-06 page reader), so only where each chapter and section starts is
// kept, never its text. Headings are lines clearly taller than the body text: the tallest size is the chapter, the
// next size starts a section, smaller headings stay inside their section (they are not index lines). A section with
// nothing under it (a heading straight after another) is not an index line either.
// Entry: { id, title, chapter, page }.
import { slug } from './book-monsters.js';
import { isScanHeading, scanName, clean, titleCase } from './book-scan.js';
import { outlineMarks, outlineUsable } from './book-outline.js';

const DANGLING = /\b(of|the|and|to|in|on|at)$/i; // a scanned chapter title cut mid-phrase

function mostCommonSize(lines) {
  const n = {};
  for (const l of lines) { const k = l.size.toFixed(1); n[k] = (n[k] || 0) + 1; }
  return +Object.entries(n).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 10;
}

// `outline` (book-outline.js): the PDF's bookmarks. When enough of them match a line, they open the chapters and
// sections, and every other heading stays inside its section (a keyed area still opens its own).
// `scanned` (book-scan.js): a scan's sizes are machine estimates, different for every heading, so headings are known
// by their look instead (big capitals): very big or "CHAPTER …" opens a chapter, big a section, the rest stay inside.
export function findStory(lines, { scanned = false, outline = null } = {}) {
  if (!lines.length) return [];
  const bodySize = mostCommonSize(lines);
  const isHeading = scanned ? isScanHeading : l => l.size > bodySize + 0.9 && l.text.length <= 90;
  // Heading sizes, biggest first, leaving out sizes used once that are bigger than any repeated one: a cover title ("DEATH HOUSE",
  // 63 pt) is not the chapter level, and taking it for one flattened a whole adventure into two sections.
  const count = {};
  for (const l of lines) if (isHeading(l)) { const k = +l.size.toFixed(1); count[k] = (count[k] || 0) + 1; }
  const all = Object.keys(count).map(Number).sort((a, b) => b - a);
  const topRepeated = all.find(k => count[k] > 1);
  const sizes = topRepeated == null ? all : all.filter(k => k <= topRepeated); // only once-used sizes ABOVE all others
  const chapterSize = sizes[0], sectionSize = sizes[1];
  // A keyed area ("12. Master Suite", "23A. Empty Crypt") is always a section of its own: what a DM looks up.
  const isArea = t => /^\d{1,3}[A-Z]?\.\s+[A-Z]/.test(t) && t.length <= 60;
  const level = l => (!scanned ? (+l.size.toFixed(1) === chapterSize ? 'chapter' : +l.size.toFixed(1) === sectionSize ? 'section' : 'sub')
    : /^chapter\b/i.test(clean(l.text)) || l.size >= 17 ? 'chapter' : l.size >= 13 ? 'section' : 'sub');
  const out = [];
  const used = {};
  let chapter = '', cur = null; // cur.has: something (text or a sub-heading) sits under it
  const open = (title, page) => {
    if (cur?.has) out.push(cur);
    let id = slug(`${chapter} ${title}`) || 'section';
    used[id] = (used[id] || 0) + 1;
    if (used[id] > 1) id += `-${used[id]}`;
    cur = { id, title, chapter, page, has: false };
  };
  // Text or a sub-heading: it belongs to the open section (an opening with none yet is the chapter's introduction).
  const under = page => { if (!cur) { chapter ||= 'Introduction'; open(chapter, page); } cur.has = true; };

  const marks = outline?.length ? outlineMarks(lines, outline) : new Map();
  const byOutline = outlineUsable(marks, outline);
  const skip = new Set(); // the second line of a two-line bookmarked heading

  let unfinished = null; // { at, sec, count }: a scanned chapter title waiting for its second half
  for (const [n, l] of lines.entries()) {
    if (skip.has(n)) continue;
    const mark = byOutline ? marks.get(n) : null;
    if (mark?.level === 'sub') {
      if (mark.span) skip.add(n + 1);
      under(l.page);
      continue;
    }
    if (mark) {
      if (mark.span) skip.add(n + 1);
      if (mark.level === 'chapter' || !chapter) chapter = mark.title; // a section before any chapter is its own
      open(mark.title, l.page);
      continue;
    }
    const t = scanned && isHeading(l) ? (scanName(l.text) || titleCase(clean(l.text))) : l.text.trim();
    if (!t) continue;
    if (isHeading(l) && byOutline) {
      // Not bookmarked: a sub-heading, unless it is set as big as the chapters (an appendix the outline left out).
      if (!scanned && level(l) === 'chapter') { chapter = t; open(t, l.page); continue; }
      if (isArea(t)) { open(t, l.page); continue; }
      under(l.page);
      continue;
    }
    if (isHeading(l)) {
      const lv = level(l);
      // A scan: a chapter title cut mid-phrase ("Chapter 2: the Lands of" … "Barovia"; "Chapter 3: the Village" …
      // "Of Barovia") is finished by the next big heading within a page's worth of lines, wherever the scan put it.
      const joins = unfinished && (DANGLING.test(chapter) || /^(of|and|the|to|in|on|at)\b/i.test(t));
      if (joins && lv === 'chapter' && n - unfinished.at < 60) {
        const whole = titleCase(`${chapter} ${t}`);
        for (const sec of [unfinished.sec, ...out.slice(unfinished.count), cur]) {
          if (sec?.chapter === chapter) { if (sec.title === chapter) sec.title = whole; sec.chapter = whole; }
        }
        chapter = whole; unfinished = null;
        continue;
      }
      if (lv !== 'chapter' && isArea(t)) { open(t, l.page); continue; }
      if (lv === 'chapter') {
        chapter = t; open(t, l.page);
        unfinished = scanned ? { at: n, sec: cur, count: out.length } : null;
        continue;
      }
      if (lv === 'section') { open(t, l.page); continue; }
      if (!cur) open(t, l.page);
      cur.has = true;
      continue;
    }
    under(l.page);
  }
  if (cur?.has) out.push(cur);
  return out.map(({ has, ...e }) => e);
}
