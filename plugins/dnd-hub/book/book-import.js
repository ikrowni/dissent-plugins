// book-import.js — everything the DM dropped in (one PDF, several files, a folder, a .zip) → one book to review.
//
// The sorting is book-bundle.js, the zip is book-zip.js; this runs it: each PDF read in turn (a scan's stat-block
// pages read again with OCR, book-ocr.js), each loose picture made a WebP, all of it merged into one book. A PDF that
// cannot be read is noted and the rest goes on. Nothing is uploaded here: only what the DM keeps is saved, later.
import { readPdf, ScanError } from './book-pdf.js';
import { parseBook } from './book-parse.js';
import { isScanned } from './book-scan.js';
import { readScannedPages } from './book-ocr.js';
import { listZip, entryBlob } from './book-zip.js';
import { planBundle, bundleTitle, mergeParsed, niceName } from './book-bundle.js';
import { fitWithin, guessKind } from './book-images.js';
import { docxLines, docxRels } from './book-docx.js';

const isZip = f => /\.zip$/i.test(f.name) || /zip/.test(f.type || '');
const TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
const typeOf = p => TYPES[String(p).split('.').pop().toLowerCase()] || '';

/** `files` (File[], each maybe with `relPath` from a dropped folder) → [{ path, size, get() → Blob }], and a label. */
export async function bundleItems(files) {
  const items = [];
  let label = '';
  for (const f of files) {
    if (isZip(f)) {
      label ||= f.name;
      for (const e of await listZip(f)) items.push({ path: e.name, size: e.size, get: () => entryBlob(f, e, typeOf(e.name)) });
    } else {
      const path = f.relPath || f.webkitRelativePath || f.name;
      if (!label && path.includes('/')) label = path.split('/')[0];
      items.push({ path, size: f.size, get: async () => f });
    }
  }
  return { items, label: label || (files.length === 1 ? files[0].name : '') };
}

/**
 * A Word file (.docx: a zip) → what parseBook finds in it, and its pictures, each named after the creature above it
 * (book-docx.js). No pages, so no index: a Word manual gives creatures, spells, items and pictures.
 */
async function readDocx(blob, name, notes) {
  const entries = await listZip(blob);
  const text = async path => { const e = entries.find(x => x.name === path); return e ? (await entryBlob(blob, e, 'text/xml')).text() : ''; };
  const xml = await text('word/document.xml');
  if (!xml) throw new Error('it has no word/document.xml');
  const { lines, pictures } = docxLines(xml);
  const rels = docxRels(await text('word/_rels/document.xml.rels'));
  const parsed = parseBook(lines, { scanned: false });
  parsed.story = [];
  parsed.images = [];
  const used = new Set(), named = {};
  for (const p of pictures) {
    const path = rels[p.rid], e = path && entries.find(x => x.name === path);
    if (!e || used.has(path)) continue;
    used.add(path);
    try {
      const pic = await picture(await entryBlob(blob, e, typeOf(path)));
      named[p.name] = (named[p.name] || 0) + 1;
      parsed.images.push({ id: `docx-${parsed.images.length + 1}`, page: 0, width: pic.width, height: pic.height,
        kind: guessKind(pic.width, pic.height), name: named[p.name] > 1 ? `${p.name} ${named[p.name]}` : p.name, group: name, blob: pic.blob });
    } catch { notes.failed.push({ name: `${name}: ${path.split('/').pop()}`, why: 'a picture this browser cannot open' }); }
  }
  return parsed;
}

/** A loose picture as a WebP no bigger than 4096 px a side: { blob, width, height }. */
async function picture(blob) {
  const bmp = await createImageBitmap(blob);
  const { w, h } = fitWithin(bmp.width, bmp.height);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const out = { width: bmp.width, height: bmp.height, blob: await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 }) };
  bmp.close?.();
  return out;
}

/**
 * Read a bundle. `progress({ file, files, name, page, pages, phase })` as it goes; `signal` stops between pages.
 * Returns { parsed, title, pages, pdfs, pdf, notes: { read: [{ name, pages, scanned }], failed: [{ name, why }], skipped: [path],
 *   left: { mask, blank, background, page } } } — `left`: what book-pdf.js found was not a picture (`page`: a whole
 *   page of text with art behind it). `pdfs`: every PDF read, in `doc` order ({ name, blob, pages, fingerprint, boxes }), kept
 *   (never uploaded) for the page pictures and sharp cut-outs; `pdf`: the only one, when there is just one.
 */
export async function readBundle(files, { progress = () => {}, signal } = {}) {
  const { items, label } = await bundleItems(files);
  const plan = planBundle(items);
  const notes = { read: [], failed: [], skipped: plan.skipped.map(s => s.path), left: { mask: 0, blank: 0, background: 0, page: 0 } };
  if (!plan.pdfs.length && !plan.docs.length && !plan.images.length) {
    throw new Error(plan.packs.length ? 'A .lkpack copy opens on its own: drop it in by itself.' : 'There is no PDF or picture in that to import.');
  }
  const parts = [];
  let pages = 0, docTitle = '', ocr = null;
  const pdfs = [];
  for (const [n, it] of plan.pdfs.entries()) {
    const name = niceName(it.path), base = { file: n + 1, files: plan.pdfs.length, name };
    try {
      progress({ ...base, phase: `Opening ${name}…` });
      const blob = await it.get();
      const doc = await readPdf(blob, { signal, onProgress: (page, total) => progress({ ...base, page, pages: total }) });
      let lines = doc.lines, scanLines = null;
      if (isScanned(lines)) {
        try {
          progress({ ...base, phase: `${name} is a scan: getting our reader ready…` });
          const r = await readScannedPages(blob, lines, { signal, onProgress: (k, m) =>
            progress({ ...base, page: k, pages: m, phase: `${name} is a scan: reading its stat-block pages again, ${k} of ${m}…` }) });
          if (r.pages) { scanLines = lines; lines = r.lines; }
          ocr = { pages: (ocr?.pages || 0) + r.pages };
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          ocr = { ...(ocr || {}), error: String(e?.message || e) };
        }
      }
      progress({ ...base, phase: `Finding monsters, spells, items and story in ${name}…` });
      await new Promise(r => setTimeout(r, 20));
      const parsed = parseBook(lines, { scanLines, outline: doc.outline });
      parsed.images = (doc.images || []).map(img => ({ ...img, name: `Page ${img.page} picture`, group: plan.pdfs.length > 1 ? name : '' }));
      for (const k of Object.keys(notes.left)) notes.left[k] += doc.left?.[k] || 0;
      parts.push({ parsed, source: name });
      pdfs.push({ name, blob, pages: doc.pages, fingerprint: doc.fingerprint, boxes: doc.boxes || {}, noText: !!doc.noText });
      notes.read.push({ name, pages: doc.pages, scanned: parsed.scanned, noText: !!doc.noText });
      pages += doc.pages;
      // A title that is a file name ("CVR_FT.pdf", a printer's job name) is no title: the file's own name is used.
      if (!/\.(pdf|indd|docx?|qxp)$/i.test(doc.title || '') && /\s/.test((doc.title || '').trim())) docTitle ||= doc.title;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      notes.failed.push({ name, why: e instanceof ScanError ? 'a scan with no text in it' : String(e?.message || e) });
    }
  }
  // Word files after every PDF: a find's `doc` is its part's place, and the PDFs' places are their page pictures'.
  for (const [n, it] of plan.docs.entries()) {
    const name = niceName(it.path);
    try {
      progress({ file: n + 1, files: plan.docs.length, name, phase: `Reading ${name}…` });
      parts.push({ parsed: await readDocx(await it.get(), name, notes), source: name });
      notes.read.push({ name, pages: 0, docx: true });
    } catch (e) {
      notes.failed.push({ name, why: `not a Word file this can read (${e?.message || e})` });
    }
  }
  const merged = mergeParsed(parts);
  merged.scanned = parts.some(p => p.parsed.scanned);
  merged.ocr = ocr;
  for (const [k, it] of plan.images.entries()) {
    if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
    progress({ file: 0, files: 0, page: k + 1, pages: plan.images.length, phase: `Pictures: ${k + 1} of ${plan.images.length}…` });
    try {
      const pic = await picture(await it.get());
      merged.images.push({ id: `pic-${k + 1}`, page: 0, width: pic.width, height: pic.height, kind: guessKind(pic.width, pic.height),
        name: it.name, group: it.group, blob: pic.blob });
    } catch (e) { notes.failed.push({ name: it.path, why: 'not a picture this browser can open' }); }
    if (k % 8 === 7) await new Promise(r => setTimeout(r, 0));
  }
  if (!parts.length && !merged.images.length) throw new Error(notes.failed.map(f => `${f.name}: ${f.why}`).join('; ') || 'Nothing could be read.');
  const title = plan.pdfs.length === 1 && !label.endsWith('.zip') && docTitle ? docTitle.trim().slice(0, 80) : bundleTitle(label, plan);
  return { parsed: merged, title, pages, notes, pdfs, pdf: pdfs.length === 1 ? pdfs[0].blob : null };
}
