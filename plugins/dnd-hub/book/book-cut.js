// book-cut.js — the box tool (plan 2026-10-06 page reader, owner's choice): on any page in the reader, the DM draws a
// box round a map, a piece of art or a handout, and does something with it (book-cut-actions.js). The box is cut from
// the PDF itself when it is open this session (sharp: a 900 px page picture is fine to read and blurry as a battle
// map), else from the page picture, saying so and offering to open the PDF. The PDF is never uploaded.
// Geometry is book-cut-geom.js (pure). `suggestions` ([{ rect, kind }]) are drawn dashed, one click takes one: where
// the PDF put its pictures, or — on a page with none, after "Find pictures" — boxes the on-device AI found
// (book-ai-regions.js).
import { esc } from '../../plugin-sdk.js';
import { icon } from '../lk-icons.js';
import { bookDocs } from '../lk-book.js';
import { loadPage } from './book-pages.js';
import { pdfjs, openPdf, rememberPdf, rememberedPdf, pdfIdentity } from './book-pdf.js';
import { rectFromDrag, moveRect, resizeRect, tooSmall, toPixels, pdfScale } from './book-cut-geom.js';
import { findPictures } from './book-ai-regions.js';

const HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
let C = null; // { book, place: { doc, page }, rect, suggestions, actions, busy, note }

export const cutting = () => !!C;

/**
 * Start the box tool on the page shown by book-viewer.js. `actions`: [{ label, primary?, run(cut) }], each given
 * { blob, width, height, sharp, doc, page, rect } when clicked; a run that returns true ends the tool.
 */
export function startCut(book, place, { actions = [], suggestions = [] } = {}) {
  stopCut();
  C = { book, place: { doc: place.doc, page: place.page }, rect: null, suggestions, actions, busy: false, note: '' };
  document.addEventListener('keydown', onEsc, true);
  paint();
}

export function stopCut() {
  if (!C) return;
  document.removeEventListener('keydown', onEsc, true);
  document.querySelector('#bk-view-page .bk-cut-layer')?.remove();
  document.querySelector('#book-panel .bk-cut-bar')?.remove();
  C = null;
}

function onEsc(ev) { if (ev.key === 'Escape' && C) { ev.stopPropagation(); ev.preventDefault(); stopCut(); } }

const pct = v => `${(v * 100).toFixed(3)}%`;
const docOf = () => bookDocs(C.book)[C.place.doc];
// A book saved before fingerprints (format 1) has none: a PDF the DM picks for it is known by book and PDF number.
const _alias = new Map(); // `${book id}:${doc}` → the session key its PDF was remembered under
const pdfFor = (book, doc) => rememberedPdf(bookDocs(book)[doc]?.fingerprint) || rememberedPdf(_alias.get(`${book.id}:${doc}`));
const sharpNow = () => !!pdfFor(C.book, C.place.doc);

function paint() {
  const page = document.getElementById('bk-view-page');
  if (!C || !page) return stopCut();
  let layer = page.querySelector('.bk-cut-layer');
  if (!layer) {
    layer = Object.assign(document.createElement('div'), { className: 'bk-cut-layer' });
    layer.addEventListener('pointerdown', onDown);
    page.appendChild(layer);
  }
  const r = C.rect;
  layer.innerHTML = (r ? '' : C.suggestions.map((s, i) => `<div class="bk-cut-sug" data-sug="${i}" title="Use this box"
      style="left:${pct(s.rect[0])};top:${pct(s.rect[1])};width:${pct(s.rect[2])};height:${pct(s.rect[3])}"></div>`).join(''))
    + (r ? `<div class="bk-cut-box" style="left:${pct(r[0])};top:${pct(r[1])};width:${pct(r[2])};height:${pct(r[3])}">
        ${HANDLES.map(h => `<span class="bk-cut-h" data-h="${h}"></span>`).join('')}</div>` : '');
  let bar = document.querySelector('#book-panel .bk-cut-bar');
  if (!bar) {
    bar = Object.assign(document.createElement('div'), { className: 'bk-cut-bar' });
    document.querySelector('#book-panel .bk-view-bar')?.after(bar);
  }
  const sharp = sharpNow();
  bar.innerHTML = `<b style="font-size:12px;color:var(--lk-gold)">✂ ${r ? 'Your box:' : 'Drag a box on the page'}</b>
    <button class="btn btn-ghost btn-sm" data-cut="whole">Whole page</button>
    ${!r && !C.suggestions.length && !C.found ? `<button class="btn btn-ghost btn-sm" data-cut="find" ${C.busy ? 'disabled' : ''} title="Windows desktop app: your PC looks for the pictures on this page">✨ Find pictures</button>` : ''}
    ${r ? C.actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="${i}" ${C.busy ? 'disabled' : ''}>${esc(a.label)}</button>`).join('') : ''}
    <button class="btn btn-ghost btn-sm" data-cut="look" ${r && !C.busy ? '' : 'disabled'}>${icon('eye', { size: 13 })} Look</button>
    <button class="btn btn-ghost btn-sm" data-cut="cancel">Cancel</button>
    <span class="bk-cut-note ${sharp ? 'sharp' : ''}">${C.note ? esc(C.note) : sharp ? 'Sharp: cut from your PDF.'
      : `Low detail: cut from the page picture. <button class="btn btn-ghost btn-sm" data-cut="pdf">Use my PDF for a sharp copy</button>`}</span>
    <input type="file" accept="application/pdf,.pdf" hidden data-cut="file">`;
  bar.onclick = onBar;
  bar.querySelector('[data-cut=file]').onchange = e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) usePdf(f); };
}

// ── Drawing the box ──────────────────────────────────────────────────────────────────────────────────────────
function at(ev, layer) {
  const b = layer.getBoundingClientRect();
  return { x: (ev.clientX - b.left) / b.width, y: (ev.clientY - b.top) / b.height };
}
function onDown(ev) {
  if (!C || ev.button > 0) return;
  const layer = ev.currentTarget, start = at(ev, layer);
  const sug = ev.target.closest?.('[data-sug]');
  if (sug) { C.rect = C.suggestions[+sug.dataset.sug].rect.slice(); return paint(); }
  const handle = ev.target.dataset?.h, onBox = ev.target.closest?.('.bk-cut-box');
  const mode = handle ? 'resize' : onBox && C.rect ? 'move' : 'new';
  const from = C.rect ? C.rect.slice() : null;
  ev.preventDefault();
  layer.setPointerCapture?.(ev.pointerId);
  const move = e => {
    const p = at(e, layer), dx = p.x - start.x, dy = p.y - start.y;
    const had = !!C.rect;
    C.rect = mode === 'new' ? rectFromDrag(start, p) : mode === 'move' ? moveRect(from, dx, dy) : resizeRect(from, handle, dx, dy);
    const box = had && layer.querySelector('.bk-cut-box'); // a drag moves the box alone; the bar is drawn once it has one
    if (box) Object.assign(box.style, { left: pct(C.rect[0]), top: pct(C.rect[1]), width: pct(C.rect[2]), height: pct(C.rect[3]) });
    else paint();
  };
  const up = () => {
    layer.removeEventListener('pointermove', move);
    layer.removeEventListener('pointerup', up);
    layer.removeEventListener('pointercancel', up);
    if (!C) return;
    if (mode === 'new' && tooSmall(C.rect)) C.rect = from; // a click is not a box
    paint();
  };
  layer.addEventListener('pointermove', move);
  layer.addEventListener('pointerup', up);
  layer.addEventListener('pointercancel', up);
}

async function onBar(ev) {
  const b = ev.target.closest('button');
  if (!b || !C) return;
  if (b.dataset.cut === 'cancel') return stopCut();
  if (b.dataset.cut === 'whole') { C.rect = [0, 0, 1, 1]; return paint(); }
  if (b.dataset.cut === 'pdf') return document.querySelector('#book-panel .bk-cut-bar [data-cut=file]')?.click();
  if (b.dataset.cut === 'look') return look();
  if (b.dataset.cut === 'find') return find();
  if (b.dataset.act != null) return act(C.actions[+b.dataset.act]);
}

async function act(action) {
  if (!C?.rect || C.busy) return;
  C.busy = true; C.note = 'Cutting…'; paint();
  try {
    const cut = await cutPicture(C.book, C.place, C.rect);
    if (!C) return;
    C.busy = false; C.note = '';
    const done = await action.run(cut);
    if (done) stopCut(); else paint();
  } catch (e) {
    if (!C) return;
    C.busy = false; C.note = e?.shown ? '' : `That did not work (${e?.message || e}).`;
    paint();
  }
}

/** "Find pictures": the on-device AI's boxes for this page become dashed suggestions (book-ai-regions.js). */
async function find() {
  if (!C || C.busy) return;
  const place = { ...C.place }, book = C.book;
  C.busy = true; C.note = 'Your PC is looking for pictures on this page…'; paint();
  const r = await findPictures(book.id, place, async () => (await cutPicture(book, place, [0, 0, 1, 1])).blob);
  if (!C || C.place.doc !== place.doc || C.place.page !== place.page) return;
  C.busy = false; C.found = true;
  if (r.rects?.length) C.suggestions = [...C.suggestions, ...r.rects.map(rect => ({ rect, ai: true }))];
  C.note = r.why || (r.rects.length ? `Found ${r.rects.length} picture${r.rects.length === 1 ? '' : 's'}: click a dashed box to use it.`
    : 'No pictures found on this page: drag a box yourself.');
  paint();
}

async function look() {
  if (!C?.rect) return;
  C.busy = true; C.note = 'Cutting…'; paint();
  try {
    const cut = await cutPicture(C.book, C.place, C.rect);
    const url = URL.createObjectURL(cut.blob);
    const el = Object.assign(document.createElement('div'), { className: 'bk-cut-look', role: 'dialog', ariaLabel: 'Your box' });
    el.innerHTML = `<div><img src="${url}" alt="Your box"><p>${cut.width} × ${cut.height} px · ${cut.sharp ? 'sharp, from your PDF' : 'from the page picture'} · click to close</p></div>`;
    el.onclick = () => { URL.revokeObjectURL(url); el.remove(); };
    document.body.appendChild(el);
  } catch (e) { if (C) C.note = `The box could not be cut (${e?.message || e}).`; }
  if (C) { C.busy = false; if (C.note === 'Cutting…') C.note = ''; paint(); }
}

/** The DM picked their PDF again: if it is this book's (same fingerprint; an old book: same page count), cut from it. */
async function usePdf(file) {
  const d = docOf();
  C.note = 'Opening your PDF…'; paint();
  try {
    const id = await pdfIdentity(file);
    const same = d.fingerprint ? id.fingerprint === d.fingerprint : id.pages === d.count;
    if (!C) return;
    if (!same) { C.note = 'That is a different PDF from the one this book was made from.'; return paint(); }
    const key = d.fingerprint || `old:${C.book.id}:${C.place.doc}`;
    rememberPdf(key, file);
    if (!d.fingerprint) _alias.set(`${C.book.id}:${C.place.doc}`, key); // this session only: never saved
    C.note = '';
  } catch (e) { if (C) C.note = `That PDF could not be opened (${e?.message || e}).`; }
  paint();
}

// ── Cutting the picture ──────────────────────────────────────────────────────────────────────────────────────
/** The box on page `place` of `book` as a WebP: { blob, width, height, sharp, doc, page, rect }. */
export async function cutPicture(book, place, rect) {
  const pdf = pdfFor(book, place.doc);
  const base = { doc: place.doc, page: place.page, rect: rect.slice() };
  if (pdf) {
    try { return { ...(await fromPdf(pdf, place.page, rect)), sharp: true, ...base }; } catch { /* the page picture will do */ }
  }
  const buf = await loadPage(book, place.doc, place.page);
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/webp' }));
  try {
    const p = toPixels(rect, bmp.width, bmp.height);
    const canvas = new OffscreenCanvas(p.w, p.h);
    canvas.getContext('2d').drawImage(bmp, p.x, p.y, p.w, p.h, 0, 0, p.w, p.h);
    return { blob: await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 }), width: p.w, height: p.h, sharp: false, ...base };
  } finally { bmp.close?.(); }
}

let _open = { blob: null, doc: null };
async function fromPdf(blob, pageNo, rect) {
  if (_open.blob !== blob) { (await _open.doc)?.destroy?.(); _open = { blob, doc: openPdf(await pdfjs(), blob) }; }
  const page = await (await _open.doc).getPage(pageNo);
  try {
    const vp1 = page.getViewport({ scale: 1 });
    const s = pdfScale(rect, vp1.width, vp1.height);
    const vp = page.getViewport({ scale: s, offsetX: -rect[0] * vp1.width * s, offsetY: -rect[1] * vp1.height * s });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect[2] * vp1.width * s));
    canvas.height = Math.max(1, Math.round(rect[3] * vp1.height * s));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // transparent would read as black
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const out = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.9));
    const size = { width: canvas.width, height: canvas.height };
    canvas.width = canvas.height = 0;
    if (!out) throw new Error('the picture could not be made');
    return { blob: out, ...size };
  } finally { page.cleanup(); }
}
