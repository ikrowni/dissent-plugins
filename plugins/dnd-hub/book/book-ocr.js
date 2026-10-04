// book-ocr.js — read a scanned book's stat-block pages again with our own OCR, on the DM's screen. Never uploaded.
//
// Tesseract (Apache-2.0, tesseract.js-core 6.1.2, the SIMD + LSTM build) and its English data (tessdata 4.0.0
// best_int) are vendored in vendor/tesseract/ and loaded only when a scan is imported. 🔴 Three limits shape this:
//   - No Worker (the frame's CSP has no worker-src): the engine runs on this thread, one page at a time, yielding
//     between pages so Cancel works. A page takes a few seconds.
//   - A mirrored plugin file may be at most 2 MB (dissent-core registry_integrity.go): the engine ships gzipped
//     (1.1 MB) and the English data gzipped in two parts; both are unzipped here (DecompressionStream).
//   - The mirror serves .wasm and .gz as text/plain (an allowlist, on purpose): they are fetched as bytes and
//     compiled from bytes, never streamed by type.
// pdf.js needs its own decoders for a scan's page pictures (JPEG 2000 and JBIG2): vendor/pdfjs/wasm/.
import { pdfjs, openPdf } from './book-pdf.js';
import { pagesToRead, tsvToLines, replacePages, blackAndWhite } from './book-ocr-lines.js';

const SCALE = 3; // pixels per PDF point, about 216 dpi: at 144 dpi a stat block's score row misread ("1432) 173)")
let _engine = null;

const url = p => new URL(p, document.baseURI).href;
async function bytes(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`could not fetch the reader (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
const gunzip = async parts => new Uint8Array(await new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
const script = src => new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => fail(new Error('could not load the reader'));
  document.head.appendChild(s);
});

async function engine() {
  if (_engine) return _engine;
  const base = url('./vendor/tesseract/');
  if (!globalThis.TesseractCore) await script(base + 'tesseract-core-simd-lstm.js');
  const [wasm, a, b] = await Promise.all([
    bytes(base + 'tesseract-core-simd-lstm.wasm.gz').then(x => gunzip([x])),
    bytes(base + 'eng.traineddata.gz.1'), bytes(base + 'eng.traineddata.gz.2'),
  ]);
  const core = await globalThis.TesseractCore({ wasmBinary: wasm });
  core.FS.writeFile('./eng.traineddata', await gunzip([a, b]));
  const api = new core.TessBaseAPI();
  if (api.Init(null, 'eng', 1) !== 0) throw new Error('the reader could not start');
  api.SetVariable('tessedit_pageseg_mode', '3'); // automatic page layout: it finds the columns
  _engine = { core, api };
  return _engine;
}

/**
 * `lines` (from a scan's own text layer) with the stat-block pages read again. `onProgress(done, total)`;
 * `signal` stops between pages. Returns { lines, pages } (pages = how many were read again).
 */
export async function readScannedPages(source, lines, { onProgress, signal } = {}) {
  const lib = await pdfjs();
  const doc = await openPdf(lib, source, { wasmUrl: url('./vendor/pdfjs/wasm/') });
  try {
    const pages = pagesToRead(lines, doc.numPages);
    if (!pages.length) return { lines, pages: 0 };
    onProgress?.(0, pages.length);
    const { core, api } = await engine();
    const byPage = new Map();
    for (const [n, p] of pages.entries()) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
      await new Promise(r => setTimeout(r, 0));
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // transparent reads as black
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      page.cleanup();
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      blackAndWhite(img.data); // the parchment goes, the ink stays (book-ocr-lines.js)
      ctx.putImageData(img, 0, 0);
      const png = await new Promise(r => canvas.toBlob(r, 'image/png'));
      canvas.width = canvas.height = 0;
      core.FS.writeFile('/input', new Uint8Array(await png.arrayBuffer()));
      if (api.SetImageFile(1, 0) === 0) {
        api.Recognize(null);
        byPage.set(p, tsvToLines(api.GetTSVText(0), p, SCALE));
      }
      onProgress?.(n + 1, pages.length);
    }
    return { lines: replacePages(lines, byPage), pages: byPage.size };
  } finally {
    doc.destroy();
  }
}
