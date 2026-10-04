// book-pdf.js — read a PDF the DM picked into lines (book-layout.js), on the DM's own screen. Never uploaded.
//
// 🔴 No Worker: the plugin frame is a null-origin sandbox whose CSP has no worker-src or blob:, so pdf.js cannot start
// its worker. Importing pdf.worker.min.mjs first sets globalThis.pdfjsWorker, and pdf.js then runs the worker's code
// on this thread ("fake worker"). The page loop yields between pages so the screen stays alive and Cancel works.
// pdf.js (Apache-2.0) is vendored in vendor/pdfjs/ and loaded only when a DM imports a book.
import { pageLines } from './book-layout.js';
import { isWorthOffering, guessKind, fitWithin, rgbaFrom, fingerprint } from './book-images.js';

let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  const base = new URL('./vendor/pdfjs/', document.baseURI).href;
  await import(base + 'pdf.worker.min.mjs');
  _pdfjs = await import(base + 'pdf.min.mjs');
  _pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  return _pdfjs;
}

export class ScanError extends Error {
  constructor() { super('This PDF has no text in it (a scan, or pictures of pages). Book import can only read PDFs with real text.'); }
}

/**
 * The book's lines. `onProgress(page, pages)` after each page; `signal` (AbortSignal) stops between pages.
 * Throws ScanError when the PDF has (almost) no text layer.
 */
export async function readPdf(buffer, { onProgress, signal, images: wantImages = true } = {}) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [], images = [], seen = new Set();
  let chars = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const it of tc.items) chars += (it.str || '').length;
      lines.push(...pageLines({ items: tc.items, width: vp.width, height: vp.height }, p));
      if (wantImages) images.push(...await pageImages(lib, page, p, seen).catch(() => []));
      page.cleanup();
      onProgress?.(p, doc.numPages);
      await new Promise(r => setTimeout(r, 0));
    }
    // A book of maps alone has pictures and little text: that is fine. Neither is a scan.
    if (chars < doc.numPages * 40 && !images.length) throw new ScanError();
    const meta = await doc.getMetadata().catch(() => null);
    return { lines, images, pages: doc.numPages, title: meta?.info?.Title || '' };
  } finally {
    doc.destroy();
  }
}

/**
 * The pictures on one page worth offering (book-images.js), each once per book: { id, page, width, height, kind,
 * blob } (WebP, at most 4096 px a side). A picture shared between pages lives in commonObjs; a lookup that never
 * answers is given up after 5 s rather than stopping the whole book.
 */
async function pageImages(lib, page, pageNo, seen) {
  const ops = await page.getOperatorList();
  const out = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn !== lib.OPS.paintImageXObject && fn !== lib.OPS.paintInlineImageXObject) continue;
    // paintImageXObject's arguments are [name, width, height]: decorations are skipped without fetching them.
    const [arg, aw, ah] = ops.argsArray[i];
    if (aw && ah && !isWorthOffering(aw, ah)) continue;
    if (typeof arg === 'string') { if (seen.has(`name:${pageNo}:${arg}`)) continue; seen.add(`name:${pageNo}:${arg}`); }
    const img = typeof arg === 'object' ? arg : await objectOf(page, arg);
    if (!img || !isWorthOffering(img.width, img.height)) continue;
    const fp = fingerprint(img);
    if (seen.has(fp)) continue;
    seen.add(fp);
    const blob = await encode(img).catch(() => null);
    if (blob) out.push({ id: `p${pageNo}-${out.length + 1}`, page: pageNo, width: img.width, height: img.height, kind: guessKind(img.width, img.height), blob });
  }
  return out;
}

function objectOf(page, name) {
  const store = String(name).startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 5000);
    try { store.get(name, v => { clearTimeout(t); resolve(v); }); } catch { clearTimeout(t); resolve(null); }
  });
}

async function encode(img) {
  const { w, h } = fitWithin(img.width, img.height);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0, w, h);
  else {
    const rgba = rgbaFrom(img);
    if (!rgba) return null;
    const full = await createImageBitmap(new ImageData(rgba, img.width, img.height));
    ctx.drawImage(full, 0, 0, w, h);
    full.close?.();
  }
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
}
