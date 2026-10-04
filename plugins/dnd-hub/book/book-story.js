// book-story.js — a book's running text (what no stat block, spell or item claimed) → story sections. Pure.
// Headings are lines clearly taller than the body text. The tallest size is the chapter; the next size starts a
// section; smaller headings stay inside their section as <h4>. An indented line starts a paragraph. Boxed read-aloud
// text (lines set wholly in a font of their own) becomes a <blockquote class="read-aloud"> and is also listed in
// `readAloud`. Text only: everything is escaped.
// Section: { id, title, chapter, html, readAloud[], page }.
import { slug, joinText, bodyFont } from './book-monsters.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mostCommonSize(lines) {
  const n = {};
  for (const l of lines) { const k = l.size.toFixed(1); n[k] = (n[k] || 0) + 1; }
  return +Object.entries(n).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 10;
}

export function findStory(lines) {
  if (!lines.length) return [];
  const bodySize = mostCommonSize(lines);
  const body = bodyFont(lines.filter(l => Math.abs(l.size - bodySize) < 0.5));
  const isHeading = l => l.size > bodySize + 0.9 && l.text.length <= 90;
  const sizes = [...new Set(lines.filter(isHeading).map(l => +l.size.toFixed(1)))].sort((a, b) => b - a);
  const chapterSize = sizes[0], sectionSize = sizes[1];
  const boxed = l => !isHeading(l) && (l.runs || []).length > 0 && l.runs.every(r => r.font === l.runs[0].font) && l.runs[0].font !== body;

  const out = [];
  const used = {};
  let chapter = '', cur = null, para = null; // para: { boxed, text }
  const flushPara = () => {
    if (!para || !cur) { para = null; return; }
    if (para.boxed && (para.lines > 1 || para.text.length >= 60)) {
      cur.html += `<blockquote class="read-aloud">${esc(para.text)}</blockquote>`;
      cur.readAloud.push(para.text);
    } else cur.html += `<p>${esc(para.text)}</p>`;
    para = null;
  };
  const open = (title, page) => {
    flushPara();
    if (cur && cur.html) out.push(cur);
    let id = slug(`${chapter} ${title}`) || 'section';
    used[id] = (used[id] || 0) + 1;
    if (used[id] > 1) id += `-${used[id]}`;
    cur = { id, title, chapter, html: '', readAloud: [], page };
  };

  for (const l of lines) {
    const t = l.text.trim();
    if (!t) continue;
    if (isHeading(l)) {
      const sz = +l.size.toFixed(1);
      if (sz === chapterSize) { chapter = t; open(t, l.page); continue; }
      if (sz === sectionSize) { open(t, l.page); continue; }
      flushPara();
      if (!cur) open(t, l.page);
      cur.html += `<h4>${esc(t)}</h4>`;
      continue;
    }
    if (!cur) open(chapter || 'Introduction', l.page);
    const b = boxed(l);
    if (!para || l.indent || para.boxed !== b) { flushPara(); para = { boxed: b, text: t, lines: 1 }; }
    else { para.text = joinText(para.text, t); para.lines++; }
  }
  flushPara();
  if (cur && cur.html) out.push(cur);
  return out;
}
