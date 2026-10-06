// book-viewer.js — the reader's page view (plan 2026-10-06 page reader): the book's index beside its REAL pages.
// No reading of a PDF's text gets every book right (memory lk-book-import), so the page itself is what the DM reads.
// Drawn into the Book panel by book-reader.js; moving around is book-view-nav.js (pure). `view`: { doc, page, zoom, toc }.
import { esc } from '../../plugin-sdk.js';
import { icon } from '../lk-icons.js';
import { bookDocs } from '../lk-book.js';
import { loadPage } from './book-pages.js';
import { entryAt } from './book-view-nav.js';

// The index: one line per chapter, and the sections of the chapter being read under it (Heliana has 32 chapters and
// 164 sections; listing them all at once was the "not organized" index). A chapter's own opening is its line.
// `onClick(id)`: the window function a line calls; `mark(id)`: text after a line (the reader's "shared" tick).
export function tocHtml(story, current, { onClick = 'bookPanelSection', mark = () => '' } = {}) {
  const groups = [];
  for (const x of story) {
    const g = groups[groups.length - 1];
    if (g && g.chapter === x.chapter && (g.doc ?? 0) === (x.doc ?? 0)) g.items.push(x); else groups.push({ chapter: x.chapter, doc: x.doc, items: [x] });
  }
  return groups.map(g => {
    const open = g.items.includes(current), subs = g.items.filter(x => x.title !== x.chapter);
    return `<button class="bk-toc-ch" aria-expanded="${open}" aria-current="${g.items[0] === current && g.items[0].title === g.chapter}"
        onclick="${onClick}('${esc(g.items[0].id)}')">${esc(g.chapter || 'Introduction')}${!open && subs.length ? ` <span>${subs.length}</span>` : ''}</button>`
      + (open ? subs.map(x => `<button class="bk-toc-s" aria-current="${x === current}" onclick="${onClick}('${esc(x.id)}')">${esc(x.title)}${mark(x.id)}</button>`).join('') : '');
  }).join('');
}

/** The page view for `book` at `view`. Its picture is filled in by fillPage() once the HTML is on screen. */
export function pageViewHtml(book, view, { mark } = {}) {
  const docs = bookDocs(book), d = docs[view.doc] || docs[0];
  // Several PDFs: the index lists the one being read (the switcher picks the PDF).
  const story = (book.story || []).filter(e => docs.length < 2 || (e.doc || 0) === view.doc);
  const current = entryAt(story, view);
  const zoomLabel = view.zoom > 1 ? `${Math.round(view.zoom * 100)} %` : 'Fit';
  return `<div class="bk-view ${view.toc ? '' : 'no-toc'}">
    ${view.toc ? `<nav class="bk-toc" aria-label="Index">${tocHtml(story, current, { mark })}</nav>` : ''}
    <div class="bk-view-main">
      <div class="bk-view-bar" role="toolbar" aria-label="Pages">
        <button class="btn btn-ghost btn-sm" onclick="bookViewToc()" aria-pressed="${!!view.toc}" title="${view.toc ? 'Hide' : 'Show'} the index">${icon('list-ordered', { size: 14 })}</button>
        ${docs.length > 1 ? `<select aria-label="Which PDF" onchange="bookViewDoc(+this.value)">${docs.map((x, i) =>
          `<option value="${i}" ${i === view.doc ? 'selected' : ''}>${esc(x.name || `PDF ${i + 1}`)}</option>`).join('')}</select>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="bookViewGo(-1)" ${view.page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>
        <label class="bk-view-num">Page <input value="${view.page}" inputmode="numeric" size="3" aria-label="Page number"
          onchange="bookViewPage(this.value)" onkeydown="if(event.key==='Enter')this.blur()"> of ${d?.count || '?'}</label>
        <button class="btn btn-ghost btn-sm" onclick="bookViewGo(1)" ${view.page >= (d?.count || 1) ? 'disabled' : ''} aria-label="Next page">›</button>
        <button class="btn btn-ghost btn-sm" onclick="bookViewZoom()" title="Zoom">${icon('zoom-in', { size: 14 })} ${zoomLabel}</button>
        <span class="bk-view-where">${current ? esc(current.title) : ''}</span>
        <span class="bk-view-tools" id="bk-view-tools"></span>
      </div>
      <div class="bk-view-scroll" id="bk-view-scroll" tabindex="0" aria-label="Page ${view.page}">
        <img id="bk-view-img" alt="Page ${view.page}" style="width:${Math.round((view.zoom || 1) * 100)}%">
      </div>
    </div></div>`;
}

const _urls = new Map(); // `${book id}:${doc}:${page}` → object URL, for the session
function pageUrl(book, doc, n) {
  const key = `${book.id}:${doc}:${n}`;
  if (!_urls.has(key)) {
    const p = loadPage(book, doc, n).then(buf => URL.createObjectURL(new Blob([buf], { type: 'image/webp' })));
    _urls.set(key, p);
    p.catch(() => _urls.delete(key));
  }
  return _urls.get(key);
}

/** Put the page's picture into the view drawn by pageViewHtml, and get the pages either side ready. */
export async function fillPage(book, view) {
  const img = document.getElementById('bk-view-img');
  if (!img) return;
  try {
    const url = await pageUrl(book, view.doc, view.page);
    if (img.isConnected) img.src = url;
  } catch {
    img.replaceWith(Object.assign(document.createElement('div'), { className: 'bk-empty', textContent: `Page ${view.page} could not be loaded.` }));
    return;
  }
  const count = bookDocs(book)[view.doc]?.count || 0;
  for (const n of [view.page + 1, view.page - 1]) if (n >= 1 && n <= count) pageUrl(book, view.doc, n).catch(() => {});
}

/** ←/→ and PageUp/PageDown turn pages while the panel is open, unless the DM is typing. Returns -1, 1 or 0. */
export function pageKey(ev) {
  if (ev.altKey || ev.ctrlKey || ev.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target?.tagName || '') || ev.target?.isContentEditable) return 0;
  return ev.key === 'ArrowRight' || ev.key === 'PageDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'PageUp' ? -1 : 0;
}
