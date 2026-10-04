// book-pdf.js — read a PDF the DM picked into lines (book-layout.js), on the DM's own screen. Never uploaded.
//
// 🔴 No Worker: the plugin frame is a null-origin sandbox whose CSP has no worker-src or blob:, so pdf.js cannot start
// its worker. Importing pdf.worker.min.mjs first sets globalThis.pdfjsWorker, and pdf.js then runs the worker's code
// on this thread ("fake worker"). The page loop yields between pages so the screen stays alive and Cancel works.
// pdf.js (Apache-2.0) is vendored in vendor/pdfjs/ and loaded only when a DM imports a book.
import { pageLines } from './book-layout.js';

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
export async function readPdf(buffer, { onProgress, signal } = {}) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  let chars = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const it of tc.items) chars += (it.str || '').length;
      lines.push(...pageLines({ items: tc.items, width: vp.width, height: vp.height }, p));
      page.cleanup();
      onProgress?.(p, doc.numPages);
      await new Promise(r => setTimeout(r, 0));
    }
    if (chars < doc.numPages * 40) throw new ScanError();
    const meta = await doc.getMetadata().catch(() => null);
    return { lines, pages: doc.numPages, title: meta?.info?.Title || '' };
  } finally {
    doc.destroy();
  }
}
