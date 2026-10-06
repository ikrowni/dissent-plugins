// book-pdf.js — read a PDF the DM picked into lines (book-layout.js), on the DM's own screen. Never uploaded.
//
// 🔴 No Worker: the plugin frame is a null-origin sandbox whose CSP has no worker-src or blob:, so pdf.js cannot start
// its worker. Importing pdf.worker.min.mjs first sets globalThis.pdfjsWorker, and pdf.js then runs the worker's code
// on this thread ("fake worker"). The page loop yields between pages so the screen stays alive and Cancel works.
// pdf.js (Apache-2.0) is vendored in vendor/pdfjs/ and loaded only when a DM imports a book.
import { pageLines } from './book-layout.js';
import { isWorthOffering, guessKind, fitWithin, rgbaFrom, fingerprint, pictureStats, notAPicture, FULL_PAGE, SAMPLE, THUMB } from './book-images.js';
import { readOutline } from './book-outline.js';

let _pdfjs = null;
export async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  const base = new URL('./vendor/pdfjs/', document.baseURI).href;
  await import(base + 'pdf.worker.min.mjs');
  _pdfjs = await import(base + 'pdf.min.mjs');
  _pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  return _pdfjs;
}

/**
 * Open a PDF from a File/Blob, or from bytes. A Blob is read through a range transport: pdf.js asks for the byte
 * ranges it needs and they are cut from the file with slice(), so a map pack of hundreds of MB is never loaded whole
 * (reading one into an ArrayBuffer is what failed). `wasmUrl`: pdf.js's own image decoders (JPEG 2000, JBIG2).
 */
export async function openPdf(lib, source, { wasmUrl } = {}) {
  const opts = { isEvalSupported: false, verbosity: 0, ...(wasmUrl ? { wasmUrl } : {}) };
  if (!(source instanceof Blob)) return lib.getDocument({ ...opts, data: new Uint8Array(source) }).promise;
  const first = new Uint8Array(await source.slice(0, Math.min(source.size, 1 << 20)).arrayBuffer());
  const transport = new lib.PDFDataRangeTransport(source.size, first);
  transport.requestDataRange = (begin, end) => {
    source.slice(begin, end).arrayBuffer().then(b => transport.onDataRange(begin, new Uint8Array(b)), () => {});
  };
  return lib.getDocument({ ...opts, range: transport, length: source.size, disableAutoFetch: true, disableStream: true,
    rangeChunkSize: 1 << 20 }).promise;
}

export class ScanError extends Error {
  constructor() { super('This PDF has no text in it (a scan, or pictures of pages). Book import can only read PDFs with real text.'); }
}

/**
 * The book's lines. `onProgress(page, pages)` after each page; `signal` (AbortSignal) stops between pages.
 * Throws ScanError when the PDF has (almost) no text layer.
 */
export async function readPdf(source, { onProgress, signal, images: wantImages = true } = {}) {
  const lib = await pdfjs();
  const doc = await openPdf(lib, source);
  const lines = [], images = [], seen = new Set(), left = { mask: 0, blank: 0, background: 0 };
  let chars = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const it of tc.items) chars += (it.str || '').length;
      lines.push(...pageLines({ items: tc.items, width: vp.width, height: vp.height }, p));
      const mapWord = tc.items.some(it => /\bmaps?\b/i.test(it.str || ''));
      if (wantImages) images.push(...await pageImages(lib, page, p, seen, { width: vp.width, height: vp.height, mapWord, left }).catch(() => []));
      page.cleanup();
      onProgress?.(p, doc.numPages);
      await new Promise(r => setTimeout(r, 0));
    }
    // A book of maps alone has pictures and little text: that is fine. Neither is a scan.
    if (chars < doc.numPages * 40 && !images.length) throw new ScanError();
    const meta = await doc.getMetadata().catch(() => null);
    const outline = await readOutline(doc).catch(() => []);
    return { lines, images, left, outline, pages: doc.numPages, title: meta?.info?.Title || '' };
  } finally {
    doc.destroy();
  }
}

/**
 * The pictures on one page worth offering (book-images.js), each once per book: { id, page, width, height, kind,
 * fullPage, blob } (WebP, at most 4096 px a side). A picture shared between pages lives in commonObjs; a lookup
 * that never answers is given up after 5 s rather than stopping the whole book.
 * Masks, blank textures and page backgrounds (notAPicture) are counted in `ctx.left`, never encoded: Heliana's Guide
 * offered 790 "pictures", 511 of them those. Where a picture is drawn is followed through the page's transforms, so a
 * whole-page one is known (`ctx.width/height`: the page; `ctx.mapWord`: the page says "map").
 */
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
async function pageImages(lib, page, pageNo, seen, ctx) {
  const ops = await page.getOperatorList();
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === lib.OPS.save) { stack.push(ctm); continue; }
    if (fn === lib.OPS.restore) { ctm = stack.pop() || ctm; continue; }
    if (fn === lib.OPS.transform) { ctm = mul(ctm, ops.argsArray[i]); continue; }
    if (fn !== lib.OPS.paintImageXObject && fn !== lib.OPS.paintInlineImageXObject) continue;
    const cover = (Math.hypot(ctm[0], ctm[1]) * Math.hypot(ctm[2], ctm[3])) / (ctx.width * ctx.height);
    // paintImageXObject's arguments are [name, width, height]: decorations are skipped without fetching them.
    const [arg, aw, ah] = ops.argsArray[i];
    if (aw && ah && !isWorthOffering(aw, ah)) continue;
    if (typeof arg === 'string') { if (seen.has(`name:${pageNo}:${arg}`)) continue; seen.add(`name:${pageNo}:${arg}`); }
    const img = typeof arg === 'object' ? arg : await objectOf(page, arg);
    if (!img || !isWorthOffering(img.width, img.height)) continue;
    const fp = fingerprint(img.data ? img : await bitmapPrint(img));
    if (seen.has(fp)) continue;
    seen.add(fp);
    const bmp = await bitmapOf(img).catch(() => null);
    if (!bmp) continue;
    const stats = sampleStats(bmp);
    const why = notAPicture({ cover, stats });
    if (why) { ctx.left[why]++; if (!img.bitmap) bmp.close?.(); continue; }
    const fullPage = cover >= FULL_PAGE;
    const blob = await encode(bmp, img.width, img.height).catch(() => null);
    const thumb = blob && await encode(bmp, img.width, img.height, THUMB, 0.7).catch(() => null);
    if (!img.bitmap) bmp.close?.();
    if (blob) out.push({ id: `p${pageNo}-${out.length + 1}`, page: pageNo, width: img.width, height: img.height, fullPage,
      kind: guessKind(img.width, img.height, { mapWord: ctx.mapWord, fullPage, clear: stats.clear }), blob, ...(thumb ? { thumb } : {}) });
  }
  return out;
}

/**
 * A picture the browser decoded itself (img.bitmap, no img.data) is fingerprinted from a 32×32 copy of its pixels.
 * Fingerprinting it by its size alone made every map of a maps pack (all one size) "the same picture": 1 of 24 kept.
 */
async function bitmapPrint(img) {
  try {
    const c = new OffscreenCanvas(32, 32), ctx = c.getContext('2d');
    ctx.drawImage(img.bitmap, 0, 0, 32, 32);
    return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, 32, 32).data };
  } catch { return { width: img.width, height: img.height, data: new Uint8Array([Math.random() * 255]) }; } // unknown: never a duplicate
}

function objectOf(page, name) {
  const store = String(name).startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 5000);
    try { store.get(name, v => { clearTimeout(t); resolve(v); }); } catch { clearTimeout(t); resolve(null); }
  });
}

/** The picture as something a canvas can draw: the browser's own bitmap, or one made from pdf.js's pixels. */
async function bitmapOf(img) {
  if (img.bitmap) return img.bitmap;
  const rgba = rgbaFrom(img);
  if (!rgba) return null;
  return createImageBitmap(new ImageData(rgba, img.width, img.height));
}

/** pictureStats of a SAMPLE×SAMPLE copy. */
function sampleStats(bmp) {
  const c = new OffscreenCanvas(SAMPLE, SAMPLE), cx = c.getContext('2d');
  cx.drawImage(bmp, 0, 0, SAMPLE, SAMPLE);
  return pictureStats(cx.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE, SAMPLE);
}

async function encode(bmp, width, height, max = 4096, quality = 0.85) {
  const { w, h } = fitWithin(width, height, max);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality });
}
