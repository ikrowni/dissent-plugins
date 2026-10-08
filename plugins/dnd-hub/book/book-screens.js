// book-screens.js — Your library, Import a book, and its Review (plan 2026-10-04 book import, stage C).
// Drawn in #screen-library. Owner, 2026-10-04: "The import campaign feature needs to be finished up and easy to work
// with": one drop zone, a progress bar with Cancel, then a review where the sure finds are already ticked and one
// click saves; the unsure ones say why.
import { esc, saveToDevice, request } from '../../plugin-sdk.js';
import { icon } from '../lk-icons.js';
import { serverData, userId, setServerData } from '../dnd-hub-state.js?v=20261015t';
import { saveHubDm, loadHubDm } from '../dnd-hub-storage.js?v=20261015t';
import { makeBook, toPack, fromPack, packFileName } from '../lk-book.js';
import { readBundle } from './book-import.js';
import { rememberPdf } from './book-pdf.js';
import { filesFromDrop } from './book-drop.js';
import { listBooks, saveBook, deleteBook, deleteFiles, campaignsUsing, attachBook, loadBook, saveBookImage, saveBookPack, loadBookPicture } from './book-library.js';
import { planPictureFiles } from './book-picture-pack.js';
import { savePages, pagesLine } from './book-pages.js';
import { snippetUrls, closeSnippets } from './book-snippets.js';
import { SORT_OPTIONS, kindFromChoice, paintedPage } from './book-images.js';
import { parseBook } from './book-parse.js';
import { readScannedPages } from './book-ocr.js';
import { needsScores, readMissingScores } from './book-ai-scores.js';

const KINDS = [['monsters', 'Monsters'], ['spells', 'Spells'], ['items', 'Magic items'], ['story', 'Index'], ['images', 'Maps & art']];
let S = null; // { mode: 'list'|'reading'|'review'|'saved', ... }
const root = () => document.getElementById('screen-library');
const myCampaigns = () => Object.values(serverData?.campaigns || {}).filter(c => c.dmUserId === userId);
const fmtSize = n => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
const newId = () => `bk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function showLibrary() {
  S = { mode: 'list', books: null, personalError: null, notice: '' };
  window.showScreen('library');
  render();
  await refreshList();
}

async function refreshList() {
  try { Object.assign(S, await listBooks()); } catch (e) { S.books = []; S.notice = `Your library could not be read (${e?.message || e}).`; }
  if (S.mode === 'list') render();
}

function render() {
  const el = root();
  if (!el || !S) return;
  el.innerHTML = `<div class="bk">${S.mode === 'list' ? listView() : S.mode === 'reading' ? readingView()
    : S.mode === 'review' ? reviewView() : savedView()}</div>`;
  if (S.mode === 'review' && S.open) fillSnippet();
  else if (S.mode !== 'review') closeSnippets();
}

// ── The library ───────────────────────────────────────────────────────────────────────────────────────────
function listView() {
  const used = id => campaignsUsing(serverData?.campaigns, id).map(c => c.name);
  return `<div class="screen-header">
      <button class="screen-back" onclick="showDMPortal()" aria-label="Back">${icon('arrow-left')}</button>
      <div class="screen-title lk-title">${icon('book-open', { size: 18 })} Your library</div></div>
    <label class="bk-drop" id="bk-drop" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')"
      ondrop="event.preventDefault();this.classList.remove('over');bookDrop(event)">
      <input type="file" accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.zip,application/zip,.lkpack,image/*" multiple onchange="bookPickFiles(this.files)" hidden>
      <div class="bk-drop-icon">${icon('book-open', { size: 34 })}</div>
      <b>Import a book</b>
      <span>Drop an adventure or rules PDF (or a Word file of monsters) here, or click to choose one. Its monsters, spells, magic items and story
        become usable at your table. A whole download works too: a <b>.zip</b>, several PDFs at once (the book and its
        maps), or a folder with picture sets like a card deck. A <b>.lkpack</b> copy of a book you saved opens as well.</span>
      <small>Only import books you own. The files stay on your computer; only what you keep is saved, and only you can read it.</small>
    </label>
    <label class="bk-folder">or <u>choose a folder</u><input type="file" webkitdirectory multiple onchange="bookPickFiles(this.files)" hidden></label>
    ${S.notice ? `<div class="bk-notice">${esc(S.notice)}</div>` : ''}
    <div class="section-label">Your books</div>
    ${S.books == null ? '<div class="bk-empty">Opening your library…</div>'
      : !S.books.length ? '<div class="bk-empty">No books yet. Import one above.</div>'
      : `<div class="bk-list">${S.books.map(b => `<div class="bk-book">
          <div class="bk-spine" style="--h:${hue(b.title)}"></div>
          <div class="bk-book-info"><b>${esc(b.title)}</b>
            <span>${b.place === 'personal' ? 'Personal: on every server' : 'This server only'} · ${fmtSize(b.size)}
              ${used(b.id).length ? ` · used by ${used(b.id).map(esc).join(', ')}` : ''}</span></div>
          <div class="bk-book-actions">
            ${myCampaigns().length ? `<select onchange="if(this.value)bookAttach('${esc(b.fileId)}',this.value)" aria-label="Use in a campaign">
              <option value="">Use in a campaign…</option>${myCampaigns().filter(c => !used(b.id).includes(c.name))
                .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="bookExport('${esc(b.fileId)}')" title="Save a copy of this book to your device (.lkpack): a backup, or to bring it to another node">Save a copy</button>
            <button class="btn btn-ghost btn-sm" onclick="bookDelete('${esc(b.fileId)}','${esc(b.id)}')" aria-label="Delete ${esc(b.title)}">${icon('trash-2', { size: 14 })}</button>
          </div></div>`).join('')}</div>`}
    ${S.personalError ? `<div class="bk-notice">Your personal library is not available on this server (${esc(S.personalError)}). Books saved to this server still work.</div>` : ''}`;
}
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export async function bookPickFile(file) { return bookPickFiles(file ? [file] : []); }
/** A drop: files, or folders walked for their files (book-drop.js). */
export async function bookDrop(ev) { return bookPickFiles(await filesFromDrop(ev.dataTransfer).catch(() => [...(ev.dataTransfer?.files || [])])); }

/**
 * One PDF, several files, a folder or a .zip (book-import.js reads them all into one book). Progress says which file
 * and which page; Cancel stops between pages.
 */
export async function bookPickFiles(list) {
  const files = [...(list || [])].filter(Boolean);
  if (!files.length) return;
  if (files.length === 1 && /\.lkpack$/i.test(files[0].name)) return openPack(files[0]);
  const ctrl = new AbortController();
  const label = files.length === 1 ? files[0].name : `${files.length} files`;
  S = { mode: 'reading', file: label, page: 0, pages: 0, ctrl, phase: 'Opening…' };
  render();
  try {
    const { parsed, title, pages, notes, pdfs } = await readBundle(files, { signal: ctrl.signal, progress: p => {
      S.page = p.page || 0; S.pages = p.pages || 0;
      const which = p.files > 1 ? `File ${p.file} of ${p.files}, ${p.name}: ` : '';
      S.phase = p.phase || `${which}page ${p.page} of ${p.pages}`;
      updateProgress();
    } });
    // Pictures: decorations, masks, page backgrounds and pages of text with art behind them were left behind by
    // book-pdf.js, so each one offered starts ticked — except a whole-page picture that is not a map (a cover, an art
    // plate): the DM picks those. A whole-page map stays ticked: Heliana's battle maps are whole pages.
    for (const p of pdfs) rememberPdf(p.fingerprint, p.blob); // the reader cuts boxes from them, sharp, this session
    parsed.images = (parsed.images || []).map(({ thumb, ...img }) => ({ ...img, url: URL.createObjectURL(thumb || img.blob) }));
    const keep = {};
    for (const [k] of KINDS) keep[k] = new Set(parsed[k].filter(e => k === 'story' || (k === 'images' ? !e.fullPage || e.kind === 'map' : e.confidence === 'sure')).map(e => e.id));
    S = { mode: 'review', parsed, keep, tab: KINDS.find(([k]) => parsed[k].length)?.[0] || 'story', open: null, filter: '',
      picShow: 'all', title, place: 'personal', pages, notes, pdfs, personalError: null };
    render();
    listBooks().then(r => { if (S?.mode === 'review') { S.personalError = r.personalError; if (r.personalError) S.place = 'server'; render(); } }).catch(() => {});
  } catch (e) {
    const msg = e?.name === 'AbortError' ? '' : `That could not be read (${e?.message || e}).`;
    S = { mode: 'list', books: null, notice: msg };
    render(); refreshList();
  }
}
// A .lkpack (a book saved with Save a copy): straight to the review, everything ticked.
async function openPack(file) {
  try {
    const { parsed, title } = fromPack(await file.text());
    parsed.images = (parsed.images || []).map(({ dataB64, ...i }) => {
      const blob = b64ToBlob(dataB64, 'image/webp');
      return { ...i, blob, url: URL.createObjectURL(blob) };
    });
    const keep = {};
    for (const [k] of KINDS) keep[k] = new Set(parsed[k].map(e => e.id));
    S = { mode: 'review', parsed, keep, tab: KINDS.find(([k]) => parsed[k].length)?.[0] || 'story', open: null, filter: '',
      picShow: 'all', title, place: 'personal', pages: null, pdfs: [], personalError: null };
    render();
    listBooks().then(r => { if (S?.mode === 'review') { S.personalError = r.personalError; if (r.personalError) S.place = 'server'; render(); } }).catch(() => {});
  } catch (e) {
    S = { mode: 'list', books: null, notice: e.message };
    render(); refreshList();
  }
}

/** Save a copy of a library book to the person's device, as a .lkpack (the host asks first). */
export async function bookExport(fileId) {
  try {
    const book = await loadBook(fileId);
    S.notice = book.images?.length ? `Packing ${book.images.length} pictures…` : ''; render();
    const pictures = {};
    for (const img of book.images || []) pictures[img.id] = bufToB64(await loadBookPicture(img));
    const data = new TextEncoder().encode(toPack(book, pictures)).buffer;
    if (data.byteLength > 50 * 1024 * 1024) { S.notice = 'This book is too big to save as one copy (over 50 MB with its pictures).'; render(); return; }
    S.notice = ''; render();
    await saveToDevice(data, packFileName(book), 'application/json');
  } catch (e) {
    const m = String(e?.message || e);
    if (/cancel/i.test(m)) return;
    S.notice = /unknown action/i.test(m) ? 'Saving a copy needs a newer Dissent app. It already works in the web app.' : `The copy could not be saved (${m}).`;
    render();
  }
}

function readingView() {
  const pct = S.pages ? Math.round(100 * S.page / S.pages) : 0;
  return `<div class="bk-reading">
    <div class="bk-reading-book">${icon('book-open', { size: 54 })}</div>
    <div class="lk-title" style="font-size:18px">Reading ${esc(S.file)}</div>
    <div class="bk-bar"><span id="bk-bar" style="width:${pct}%"></span></div>
    <div id="bk-phase" class="bk-phase">${S.phase || `Page ${S.page} of ${S.pages}`}</div>
    <button class="btn btn-ghost btn-sm" onclick="bookCancel()">Cancel</button></div>`;
}
function updateProgress() {
  const bar = document.getElementById('bk-bar'), ph = document.getElementById('bk-phase');
  if (bar && S.pages) bar.style.width = `${Math.round(100 * S.page / S.pages)}%`;
  if (ph) ph.textContent = S.phase || `Page ${S.page} of ${S.pages}`;
}
export function bookCancel() { S?.ctrl?.abort(); }

// ── Review ────────────────────────────────────────────────────────────────────────────────────────────────
// The header's line for a bundle: "3 PDFs, 410 pages read · 40 pictures".
function readSummary(st) {
  const n = st.notes.read.length, pics = (st.parsed.images || []).filter(i => !i.page).length;
  return [n ? `${n > 1 ? `${n} PDFs, ` : ''}${st.pages} pages read` : '', pics ? `${pics} pictures` : ''].filter(Boolean).join(' · ');
}
// What a bundle held besides what is listed: the PDFs read (when more than one), any that failed, files left out.
function bundleNotes(nt) {
  const parts = [];
  if (nt.read.length > 1) parts.push(`Read: ${nt.read.map(r => `${esc(r.name)} (${r.pages} pages${r.scanned ? ', a scan' : ''})`).join(', ')}.`);
  if (nt.failed.length) parts.push(`Could not read: ${nt.failed.map(f => `${esc(f.name)} (${esc(f.why)})`).join(', ')}.`);
  const left = nt.left || {}, nLeft = (left.background || 0) + (left.blank || 0) + (left.mask || 0);
  if (nLeft) parts.push(`Left out ${[left.background && `${left.background} page backgrounds`, left.blank && `${left.blank} blank textures`,
    left.mask && `${left.mask} masks`].filter(Boolean).join(', ')}: they are not pictures.`);
  if (left.page) parts.push(`${left.page} pages of text with art behind them are not offered as pictures: in the reader, draw a box on any page to cut out a map or art.`);
  if (nt.skipped.length) parts.push(`Left out (not a PDF or a picture): ${nt.skipped.slice(0, 6).map(p => esc(p.split('/').pop())).join(', ')}${nt.skipped.length > 6 ? ` and ${nt.skipped.length - 6} more` : ''}.`);
  return parts.length ? `<p class="bk-help bk-notes">${parts.join(' ')}</p>` : '';
}

// A PDF with no text layer at all (pictures of pages nobody read: Volo's Guide to Baldur's Gate II) gives nothing to
// find. Our OCR can read every page on this computer: a few seconds a page, so it is offered, not done.
const SECONDS_A_PAGE = 5; // measured 2026-10-06: 3 pages of Volo's Guide in 19 s, the reader's start included
function noTextNotice() {
  return (S.pdfs || []).map((p, d) => (p.noText && !S.ocrDone?.[d] ? `<p class="bk-help bk-scan">⚠ <b>${esc(p.name)} has no text in it:</b> its
      pages are pictures that were never read, so nothing could be found and every page is listed as a picture.
      <button class="btn btn-gold btn-sm" onclick="bookReadPages(${d})">Read its pages</button>
      <small>about ${Math.max(1, Math.round(p.pages * SECONDS_A_PAGE / 60))} minutes, on this computer; nothing is sent anywhere</small></p>` : '')).join('');
}

/** Read every page of PDF `d` with our OCR and find what is in it, in place of what its (missing) text layer gave. */
export async function bookReadPages(d) {
  const pdf = S?.pdfs?.[d];
  if (!pdf || S.mode !== 'review') return;
  const back = S, ctrl = new AbortController();
  S = { mode: 'reading', file: pdf.name, page: 0, pages: pdf.pages, ctrl, phase: 'Getting our reader ready…' };
  render();
  try {
    const all = Array.from({ length: pdf.pages }, (_, i) => i + 1);
    const r = await readScannedPages(pdf.blob, [], { pages: all, signal: ctrl.signal,
      onProgress: (k, m) => { S.page = k; S.pages = m; S.phase = `Reading page ${k} of ${m}…`; updateProgress(); } });
    S = back;
    applyReadPages(S, d, parseBook(r.lines, { scanned: true }), r.lines);
  } catch (e) {
    S = back;
    if (e?.name !== 'AbortError') S.notice = `The pages could not be read (${e?.message || e}).`;
  }
  render();
}

// What a PDF's pages gave, in place of its finds; whole-page pictures over a page of text are pages, not pictures.
function applyReadPages(st, d, found, lines) {
  const chars = {};
  for (const l of lines) chars[l.page] = (chars[l.page] || 0) + l.text.replace(/\s+/g, '').length;
  for (const [k] of KINDS) {
    if (k === 'images') continue;
    const taken = new Set(st.parsed[k].filter(e => (e.doc || 0) !== d).map(e => e.id));
    const fresh = (found[k] || []).map(e => {
      let id = e.id, n = 1;
      while (taken.has(id)) id = `${e.id}-${++n}`;
      taken.add(id);
      return { ...e, id, doc: d };
    });
    st.parsed[k] = [...st.parsed[k].filter(e => (e.doc || 0) !== d), ...fresh];
    st.keep[k] = new Set([...[...st.keep[k]].filter(id => st.parsed[k].some(e => e.id === id && (e.doc || 0) !== d)),
      ...fresh.filter(e => k === 'story' || e.confidence === 'sure').map(e => e.id)]);
  }
  const before = st.parsed.images.length;
  st.parsed.images = st.parsed.images.filter(e => !((e.doc || 0) === d && e.fullPage && paintedPage({ fullPage: true, pageChars: chars[e.page] || 0 })));
  for (const id of [...st.keep.images]) if (!st.parsed.images.some(e => e.id === id)) st.keep.images.delete(id);
  st.parsed.scanned = true;
  st.ocrDone = { ...(st.ocrDone || {}), [d]: true };
  st.notice = `Read ${Object.keys(chars).length} pages: ${countOf(st, 'story', d)} index lines, ${countOf(st, 'monsters', d)} creatures; `
    + `${before - st.parsed.images.length} pages of text are no longer listed as pictures.`;
}
const countOf = (st, k, d) => st.parsed[k].filter(e => (e.doc || 0) === d).length;

function meta(k, e) {
  if (k === 'monsters') return [`CR ${crText(e.cr)}`, [e.size, e.type].filter(Boolean).join(' '), e.hp ? `${e.hp} HP` : '',
    e.aiScores ? 'scores read by on-device AI' : ''].filter(Boolean).join(' · ');
  if (k === 'spells') return e.level === 0 ? `${e.school} cantrip` : `Level ${e.level} ${String(e.school || '').toLowerCase()}`;
  if (k === 'items') return `${e.category}, ${String(e.rarity || '').toLowerCase()}`;
  if (k === 'images') return `${e.kind === 'map' ? 'Map' : 'Art'} · ${picWhere(e)}`;
  // An index line: where it starts (and in which PDF, when there are several).
  return [e.chapter && e.chapter !== e.title ? e.chapter : '', e.page ? `page ${e.page}` : '', (S.pdfs?.length > 1 && S.pdfs[e.doc || 0]?.name) || ''].filter(Boolean).join(' · ');
}
// A picture from a PDF says its page; a loose one its set (folder) and name ("Oracle Deck · Card 03").
const picWhere = e => (e.page ? `${e.group ? `${e.group}, ` : ''}page ${e.page}` : [e.group, e.name].filter(Boolean).join(' · '));
const crText = cr => cr == null ? '?' : cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr);

function preview(k, e) {
  // Monsters: the numbers and the name can be put right here (a scan misreads them; a "?" was not read at all).
  const num = (f, label, w = 3) => `<label class="bk-edit"><b>${label}</b><input inputmode="decimal" size="${w}" value="${esc(e[f] ?? '')}" placeholder="?"
    aria-label="${label}" oninput="bookEdit('${esc(e.id)}','${f}',this.value)"></label>`;
  if (k === 'monsters') return `<label class="bk-edit bk-edit-name"><b>Name</b><input value="${esc(e.name)}" maxlength="80" aria-label="Name"
      oninput="bookEdit('${esc(e.id)}','name',this.value)"></label>
    <div class="bk-stat">${['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => num(a, a.toUpperCase(), 2)).join('')}</div>
    <p class="bk-stat">${num('ac', 'AC')}${num('hp', 'HP')}${num('cr', 'CR')}</p>
    <p>${e.ac_type ? `(${esc(e.ac_type)}) ` : ''}${e.hp_dice ? `HP ${esc(e.hp_dice)} · ` : ''}<b>Speed</b> ${esc(Object.entries(e.speed || {}).filter(([, v]) => v !== true).map(([k2, v]) => k2 === 'walk' ? v : `${k2} ${v}`).join(', '))}</p>
    ${[...(e.special_abilities || []), ...(e.actions || [])].slice(0, 6).map(a => `<p><b><i>${esc(a.name)}.</i></b> ${esc(a.desc.slice(0, 220))}${a.desc.length > 220 ? '…' : ''}</p>`).join('')}`;
  if (k === 'spells') return `<p><b>Casting time</b> ${esc(e.casting_time)} · <b>Range</b> ${esc(e.range)} · <b>Duration</b> ${esc(e.duration)}${e.classes?.length ? ` · ${esc(e.classes.join(', '))}` : ''}</p><p>${esc(e.desc.slice(0, 600))}${e.desc.length > 600 ? '…' : ''}</p>`;
  if (k === 'items') return `<p>${esc(e.desc.slice(0, 700)).replace(/\n/, '<br>')}${e.desc.length > 700 ? '…' : ''}</p>`;
  // An index line: its name can be put right (a scan's headings are machine-read); untick to leave it out.
  return `<label class="bk-edit bk-edit-name"><b>Name</b><input value="${esc(e.title)}" maxlength="80" aria-label="Name"
      oninput="bookEdit('${esc(e.id)}','title',this.value)"></label>
    <p class="bk-help">The reader opens the real page at this line. Untick it to leave it out of the index.</p>`;
}

// Look: the real page beside what was read (spec 2026-10-06 on-device AI, step 1). Only while the review still has
// the PDF it was read from (a saved copy has none) and the find knows where it sat (src).
const pdfOf = e => S.pdfs?.[e.doc || 0]?.blob || null;
function compare(k, e) {
  if (k === 'story' || !pdfOf(e) || !e.src?.length) return preview(k, e);
  return `<div class="bk-compare">
    <figure class="bk-snippet"><figcaption>What the book says</figcaption><div id="bk-snip" class="bk-snip-body">Opening the page…</div></figure>
    <div class="bk-entered"><div class="bk-snip-cap">What we entered</div>${preview(k, e)}</div></div>`;
}

async function fillSnippet() {
  const k = S?.tab, e = S?.parsed?.[k]?.find(x => x.id === S.open);
  if (!e || !document.getElementById('bk-snip')) return;
  try {
    const urls = await snippetUrls(pdfOf(e), `${k}:${e.id}`, e.src);
    const el = document.getElementById('bk-snip'); // the DM may have opened another find meanwhile
    if (el && S.open === e.id) el.innerHTML = urls.length ? urls.map(u => `<img src="${u}" alt="The page this was read from">`).join('') : 'Not found on the page.';
  } catch {
    const el = document.getElementById('bk-snip');
    if (el) el.textContent = 'The page could not be shown.';
  }
}

function reviewView() {
  const k = S.tab, list = S.parsed[k], keep = S.keep[k];
  const q = S.filter.toLowerCase();
  const shown = list.filter(e => (!q || (e.name || e.title || '').toLowerCase().includes(q)) && (k !== 'images' || picShown(e)));
  const total = KINDS.reduce((n, [kk]) => n + S.keep[kk].size, 0);
  return `<div class="screen-header">
      <button class="screen-back" onclick="showLibrary()" aria-label="Back">${icon('arrow-left')}</button>
      <div class="screen-title lk-title">${icon('book-open', { size: 18 })} Review the book</div>
      <span style="margin-left:auto;color:var(--lk-muted);font-size:12px">${S.notes ? readSummary(S) : S.pages ? `${S.pages} pages read` : 'From a saved copy'}</span></div>
    ${S.notes ? bundleNotes(S.notes) : ''}
    ${noTextNotice()}
    ${S.notice ? `<div class="bk-notice">${esc(S.notice)}</div>` : ''}
    <p class="bk-help">Everything below was found in the book. The ones we're sure of are already ticked. Click one to
      check it against what we read. Untick anything you don't want; ⚠ marks the ones to look at.</p>
    ${S.parsed.scanned ? `<p class="bk-help bk-scan">⚠ <b>This book is a scanned copy.</b> Its pages are pictures, and the words were
      read from them by a machine, with mistakes.${S.parsed.ocr?.pages ? ` We read its ${S.parsed.ocr.pages} stat-block pages again with our own reader.`
        : S.parsed.ocr?.error ? ` Our own reader could not run (${esc(S.parsed.ocr.error)}), so this is the scan's own text.` : ''}
      Only creatures whose numbers check out (hit points match their hit dice) are ticked. Check the rest against the
      page, fix a name or a number under <i>Look</i>, and leave out anything that came out garbled.</p>` : ''}
    <div class="bk-tabs" role="tablist">${KINDS.map(([kk, label]) => `<button role="tab" aria-selected="${kk === k}" onclick="bookTab('${kk}')"
      ${S.parsed[kk].length ? '' : 'disabled'}>${label} <span>${S.keep[kk].size}/${S.parsed[kk].length}</span></button>`).join('')}</div>
    <div class="bk-tools">
      <input type="search" placeholder="Search ${KINDS.find(x => x[0] === k)[1].toLowerCase()}…" value="${esc(S.filter)}" oninput="bookFilter(this.value)" aria-label="Search">
      ${k === 'images' ? '' : `<button class="btn btn-ghost btn-sm" onclick="bookKeepAll('sure')">Keep the sure ones</button>`}
      <button class="btn btn-ghost btn-sm" onclick="bookKeepAll('all')">Keep all${k === 'images' && S.picShow !== 'all' ? ' shown' : ''}</button>
      <button class="btn btn-ghost btn-sm" onclick="bookKeepAll('none')">Keep none${k === 'images' && S.picShow !== 'all' ? ' shown' : ''}</button></div>
    ${k === 'monsters' ? aiScoresBar() : ''}
    ${k === 'images' ? imageGrid(shown, keep) : `<div class="bk-rows" id="bk-rows">${shown.slice(0, 400).map(e => `<div class="bk-row ${keep.has(e.id) ? 'kept' : ''} ${S.open === e.id ? 'open' : ''}">
        <label class="bk-row-head"><input type="checkbox" ${keep.has(e.id) ? 'checked' : ''} onchange="bookKeep('${esc(e.id)}', this.checked)">
          <b>${esc(e.name || e.title)}</b><span>${esc(meta(k, e))}</span>
          ${e.confidence === 'unsure' ? `<em title="${esc(e.problems.join(', '))}">⚠ ${esc(e.problems.join(', '))}</em>` : ''}
          <button class="bk-peek" onclick="event.preventDefault();bookPeek('${esc(e.id)}')" aria-expanded="${S.open === e.id}">${S.open === e.id ? 'Hide' : 'Look'}</button></label>
        ${S.open === e.id ? `<div class="bk-preview">${compare(k, e)}</div>` : ''}</div>`).join('')}
      ${shown.length > 400 ? `<div class="bk-empty">${shown.length - 400} more: search to find them.</div>` : ''}
      ${!shown.length ? '<div class="bk-empty">Nothing here.</div>' : ''}</div>`}
    <div class="bk-save">
      <label>Book name <input id="bk-title" value="${esc(S.title)}" maxlength="80" oninput="bookTitle(this.value)"></label>
      <fieldset><legend>Save to</legend>
        <label><input type="radio" name="bk-place" value="personal" ${S.place === 'personal' ? 'checked' : ''} ${S.personalError ? 'disabled' : ''} onchange="bookPlace('personal')"> Your personal library <small>(every server you play on)</small></label>
        <label><input type="radio" name="bk-place" value="server" ${S.place === 'server' ? 'checked' : ''} onchange="bookPlace('server')"> This server <small>(only you can read it)</small></label></fieldset>
      ${S.pdfs?.length ? `<p class="bk-help bk-keep-pages">${esc(pagesLine(S.pdfs))}: the reader shows the real pages.</p>` : ''}
      <button class="btn btn-gold" id="bk-save" onclick="bookSave()" ${total ? '' : 'disabled'}>Save ${total} thing${total === 1 ? '' : 's'}</button>
      <div class="bk-error" role="alert" id="bk-error"></div></div>`;
}

// Maps & art: a grid of thumbnails; each picture is kept or not, and is a map or art (the DM decides). A big book
// offers hundreds, so they can be shown by kind: maps, art, or whole pages (art painted onto a page, a scan's page).
const PIC_SHOW = [['all', 'All', () => true], ['map', 'Maps', e => e.kind === 'map'], ['art', 'Art', e => e.kind === 'art' && !e.fullPage],
  ['page', 'Full pages', e => !!e.fullPage]];
const picShown = e => (PIC_SHOW.find(([id]) => id === S.picShow) || PIC_SHOW[0])[2](e);
function imageGrid(list, keep) {
  const all = S.parsed.images;
  return `<p class="bk-help">Pictures found in the book. A <b>map</b> can become the table's map in one click; <b>art</b> can be shown to the
      players. <b>Full pages</b> are whole-page pictures (a map, a cover, an art plate): tick the ones worth keeping.
      For anything else, draw a box on its page in the reader.</p>
    <div class="bk-ai-sort"><button class="btn btn-ghost btn-sm" onclick="bookAiSort()" ${S.aiSort?.busy ? 'disabled' : ''}>✨ Sort with on-device AI</button>
      <span id="bk-ai-note">${esc(S.aiSort?.note || 'Windows desktop app: your PC sorts these into maps and art. Nothing is sent anywhere.')}</span></div>
    <div class="bk-seg bk-pic-show" role="group" aria-label="Show">${PIC_SHOW.filter(([id, , f]) => id === 'all' || all.some(f)).map(([id, label, f]) =>
      `<button aria-pressed="${S.picShow === id}" onclick="bookPicShow('${id}')">${label} <span>${all.filter(e => keep.has(e.id) && f(e)).length}/${all.filter(f).length}</span></button>`).join('')}</div>
    ${!list.length ? '<div class="bk-empty">Nothing here.</div>' : ''}
    <div class="bk-grid">${list.map(e => `<div class="bk-pic ${keep.has(e.id) ? 'kept' : ''}">
      <label><input type="checkbox" ${keep.has(e.id) ? 'checked' : ''} onchange="bookKeep('${esc(e.id)}', this.checked)">
        <img src="${esc(e.url)}" alt="${esc(e.name)}" loading="lazy" decoding="async"></label>
      <div class="bk-pic-foot"><span>${esc(picWhere(e))} · ${e.width}×${e.height}${e.ai ? ' · <b title="Sorted by the on-device AI">AI</b>' : ''}</span>
        <div class="bk-seg" role="group" aria-label="Map or art">${['map', 'art'].map(kind => `<button aria-pressed="${e.kind === kind}" onclick="bookPicKind('${esc(e.id)}','${kind}')">${kind === 'map' ? 'Map' : 'Art'}</button>`).join('')}</div></div>
    </div>`).join('')}</div>`;
}
export function bookPicKind(id, kind) { const e = S.parsed.images.find(x => x.id === id); if (e) { e.kind = kind; e.ai = false; render(); } }

/**
 * "Sort with on-device AI": each picture to the plugin capability `ai.choose` (the DM's PC answers: Windows desktop
 * app; spec 2026-10-06 §6–7) with SORT_OPTIONS. A map is ticked, an advert or a text page unticked, art left as the DM
 * had it. Nothing changes when it is not available; the line says why. The DM can still change every picture.
 */
export async function bookAiSort() {
  const pics = (S?.parsed?.images || []).filter(e => e.blob);
  if (!pics.length || S.aiSort?.busy) return;
  S.aiSort = { busy: true, note: 'Asking your PC…' };
  render();
  const note = t => { S.aiSort.note = t; const el = document.getElementById('bk-ai-note'); if (el) el.textContent = t; };
  let maps = 0, out = 0, done = 0;
  for (const e of pics) {
    let r = null;
    for (let tries = 0; !r; tries++) {
      try { r = await request('ai.choose', { image: e.blob, options: SORT_OPTIONS }, 15 * 60000); } catch (err) {
        const msg = String(err?.message || err);
        if (/a minute/.test(msg) && tries < 3) { note(`Sorting… ${done} of ${pics.length} (a short pause)`); await new Promise(res => setTimeout(res, 30000)); continue; }
        // The app's refusals (dissent-client dispatch.ts): not granted / not declared, or an app too old to know the action.
        S.aiSort = { busy: false, note: /not granted|no longer declared/.test(msg) ? 'LanternKeep has not been allowed to use on-device AI on this server yet.'
          : /unknown action/.test(msg) ? 'Update the Dissent app to use on-device AI.' : `On-device AI could not run (${msg}).` };
        return render();
      }
    }
    if (S?.mode !== 'review') return;
    if (!r.available) { S.aiSort = { busy: false, note: `On-device AI is not available: ${r.why}.` }; return render(); }
    const k = kindFromChoice(r.choice);
    e.kind = k.kind; e.ai = true;
    if (!k.keep) { S.keep.images.delete(e.id); out++; } else if (k.kind === 'map') { S.keep.images.add(e.id); maps++; }
    note(`Sorting… ${++done} of ${pics.length}`);
  }
  S.aiSort = { busy: false, note: `Sorted ${done} pictures on your PC: ${maps} maps; ${out} left out (adverts, pages of text). Change any you disagree with.` };
  render();
}
export function bookPicShow(id) { S.picShow = id; render(); }

// "Read the missing scores with on-device AI" (book-ai-scores.js): shown while a scanned creature's score row is unread.
function aiScoresBar() {
  const n = needsScores(S.parsed.monsters).length;
  if (!n && !S.aiScores?.note) return '';
  return `<div class="bk-ai-sort">${n ? `<button class="btn btn-ghost btn-sm" onclick="bookAiScores()" ${S.aiScores?.busy ? 'disabled' : ''}>✨ Read ${n} missing score row${n === 1 ? '' : 's'} with on-device AI</button>` : ''}
    <span id="bk-ai-scores-note">${esc(S.aiScores?.note || 'Windows desktop app: your PC reads each row off the page. A row is kept only if every score fits its modifier.')}</span></div>`;
}
export async function bookAiScores() {
  if (!needsScores(S?.parsed?.monsters).length || S.aiScores?.busy) return;
  S.aiScores = { busy: true, note: 'Asking your PC…' };
  render();
  const note = t => { S.aiScores.note = t; const el = document.getElementById('bk-ai-scores-note'); if (el) el.textContent = t; };
  const r = await readMissingScores(S.parsed.monsters, pdfOf, note, () => S?.mode === 'review');
  if (S?.mode !== 'review') return;
  S.aiScores = { busy: false, note: r.why || `Read ${r.read} of ${r.of} score rows on your PC; each one checked against its modifiers. ${r.read < r.of ? 'The rest stay for you to fill in.' : ''}`.trim() };
  render();
}

export function bookTab(k) { S.tab = k; S.open = null; S.filter = ''; render(); }
export function bookFilter(v) {
  S.filter = v; const pos = document.querySelector('.bk-tools input')?.selectionStart; render();
  const inp = document.querySelector('.bk-tools input'); inp?.focus(); inp?.setSelectionRange(pos, pos);
}
export function bookKeep(id, on) { const set = S.keep[S.tab]; on ? set.add(id) : set.delete(id); renderKeepCounts(); }
export function bookKeepAll(mode) {
  if (S.tab === 'images') { // the pictures shown (one kind): ticked or unticked, the others left as they are
    for (const e of S.parsed.images.filter(picShown)) mode === 'none' ? S.keep.images.delete(e.id) : S.keep.images.add(e.id);
    return render();
  }
  const list = S.parsed[S.tab];
  S.keep[S.tab] = new Set(mode === 'none' ? [] : list.filter(e => mode === 'all' || S.tab === 'story' || S.tab === 'images' || e.confidence === 'sure').map(e => e.id));
  render();
}
/** A number or the name put right in the review (Look). Typing does not redraw, so the field keeps its focus. */
export function bookEdit(id, field, value) {
  if (field === 'title') { const x = S?.parsed?.story?.find(y => y.id === id); if (x && value.trim()) x.title = value.trim().slice(0, 80); return; }
  const e = S?.parsed?.monsters?.find(x => x.id === id);
  if (!e) return;
  if (field === 'name') { if (value.trim()) e.name = value.trim(); return; }
  const v = String(value).trim();
  if (field === 'cr') { const f = v.match(/^(\d+)\/(\d+)$/); e.cr = !v ? null : f ? +f[1] / +f[2] : Number.isFinite(+v) ? +v : e.cr; return; }
  e[field] = !v ? null : /^\d+$/.test(v) ? +v : e[field];
}
export function bookPeek(id) { S.open = S.open === id ? null : id; render(); }
export function bookTitle(v) { S.title = v; }
export function bookPlace(p) { S.place = p; }
// Ticking a box re-counts without redrawing the list (the list keeps its scroll and focus).
function renderKeepCounts() {
  const tabs = document.querySelectorAll('.bk-tabs button span');
  KINDS.forEach(([k], i) => { if (tabs[i]) tabs[i].textContent = `${S.keep[k].size}/${S.parsed[k].length}`; });
  const total = KINDS.reduce((n, [k]) => n + S.keep[k].size, 0);
  const b = document.getElementById('bk-save');
  if (b) { b.textContent = `Save ${total} thing${total === 1 ? '' : 's'}`; b.disabled = !total; }
  document.querySelectorAll('.bk-row').forEach(row => { const c = row.querySelector('input'); row.classList.toggle('kept', !!c?.checked); });
}

export async function bookSave() {
  const btn = document.getElementById('bk-save'), err = document.getElementById('bk-error');
  const title = S.title.trim();
  if (!title) { err.textContent = 'Give the book a name.'; return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  const keep = Object.fromEntries(KINDS.map(([k]) => [k, [...S.keep[k]]]));
  const book = makeBook({ title, parsed: S.parsed, keep, id: newId() });
  const pics = (S.parsed.images || []).filter(e => S.keep.images?.has(e.id));
  const saved = [];
  const meta = (e, fileId, packed) => ({ id: e.id, fileId, page: e.page, width: e.width, height: e.height, kind: e.kind, title: e.name,
    ...(e.group ? { group: e.group } : {}), ...(packed ? { packed: true } : {}) });
  const fileIds = [];
  try {
    // Pictures first, then the book that lists them. Big ones (maps) a file each; small ones (a card deck) packed
    // together (book-picture-pack.js), so a deck is one upload, not forty against the node's 20 a minute.
    const plan = planPictureFiles(pics.map(e => ({ ...e, size: e.blob.size })));
    let done = 0, packs = 0;
    const onWait = s => { btn.textContent = `Saved ${done} of ${pics.length} pictures. The server takes 20 files a minute: going on in ${s} s…`; };
    for (const step of plan) {
      btn.textContent = `Saving pictures: ${done} of ${pics.length}…`;
      if (step.single) {
        const fileId = await saveBookImage(book, step.single, S.place, onWait);
        fileIds.push(fileId); saved.push(meta(step.single, fileId, false)); done++;
      } else {
        const fileId = await saveBookPack(book, step.pack, S.place, ++packs, onWait);
        fileIds.push(fileId); for (const e of step.pack) saved.push(meta(e, fileId, true)); done += step.pack.length;
      }
    }
    book.images = saved;
    // Every PDF's pages (the reader shows the real pages): one docs entry each, in the order finds say (`doc`).
    book.docs = [];
    for (const [doc, pdf] of (S.pdfs || []).entries()) {
      const which = S.pdfs.length > 1 ? ` (${pdf.name}, PDF ${doc + 1} of ${S.pdfs.length})` : '';
      btn.textContent = `Pictures of the pages${which}: starting…`;
      const boxes = pdf.boxes && Object.keys(pdf.boxes).length ? { boxes: pdf.boxes } : {}; // where its pictures sit (box tool)
      book.docs.push({ ...boxes, ...await savePages(book, pdf.blob, S.place, { doc, name: pdf.name, fingerprint: pdf.fingerprint,
        onProgress: (n, of) => { btn.textContent = `Pictures of the pages${which}: ${n} of ${of}…`; },
        onWait: s => { btn.textContent = `Pictures of the pages${which}: the server takes 20 files a minute, going on in ${s} s…`; },
        uploaded: id => fileIds.push(id) }) });
    }
    btn.textContent = 'Saving the book…';
    const fileId = await saveBook(book, S.place);
    S = { mode: 'saved', book, fileId, place: S.place };
    render();
  } catch (e) {
    deleteFiles(fileIds); // no half-saved book (paced: deletes count against the same limit)
    btn.disabled = false; btn.textContent = 'Save';
    if (!e?.shown) err.textContent = `The book could not be saved (${e?.message || e}).`;
    else err.textContent = S.place === 'personal' ? 'Try saving to this server instead.' : 'Free some space in Settings → Storage, or save to your personal library.';
  }
}

function savedView() {
  const b = S.book;
  return `<div class="bk-saved">
    <div class="bk-saved-seal">${icon('book-open', { size: 46 })}</div>
    <div class="lk-title" style="font-size:20px">${esc(b.title)} is in your library</div>
    <p>${[['monsters', 'monsters'], ['spells', 'spells'], ['items', 'magic items'], ['story', 'index lines'], ['images', 'maps and pictures']]
      .filter(([k]) => (b[k] || []).length).map(([k, w]) => `${b[k].length} ${w}`).join(' · ')}</p>
    ${myCampaigns().length ? `<div class="section-label">Use it in a campaign</div>
      <div class="bk-camps">${myCampaigns().map(c => `<button class="btn btn-ghost" onclick="bookAttach('${esc(S.fileId)}','${esc(c.id)}', true)">${esc(c.name)}</button>`).join('')}</div>` : ''}
    <button class="btn btn-gold" onclick="showLibrary()">Back to your library</button></div>`;
}

export async function bookAttach(fileId, campaignId, thenEnter = false) {
  const fresh = await loadHubDm().catch(() => null);
  if (fresh?.campaigns) setServerData(fresh);
  const camp = serverData?.campaigns?.[campaignId];
  if (!camp) return;
  try {
    await attachBook(camp, { fileId });
    await saveHubDm(serverData);
  } catch (e) { if (!e?.shown) alert(`The book could not be added (${e?.message || e}).`); return; }
  if (thenEnter) window.enterCampaignAsDM(campaignId); else showLibrary();
}

export async function bookDelete(fileId, bookId) {
  const users = campaignsUsing(serverData?.campaigns, bookId).map(c => c.name);
  if (!confirm(users.length ? `Delete this book? ${users.join(', ')} use${users.length === 1 ? 's' : ''} it: their players keep the spells and items, but you lose the monsters and story.` : 'Delete this book from your library?')) return;
  try { await deleteBook(fileId); } catch (e) { alert(`It could not be deleted (${e?.message || e}).`); }
  showLibrary();
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
