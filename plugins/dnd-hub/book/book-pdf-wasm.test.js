// pdf.js's JPEG 2000 decoder ships gzipped (a signed plugin file may carry no .wasm — dissent-core dplug.go) and
// GzWasmData unzips it. pdf.js here is pdfjs-dist's legacy build at the vendored version (5.7.284 — the vendored one
// is the browser build, which needs DOMMatrix); the decoder files are the vendored ones the page loads.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { GzWasmData } from './book-pdf.js';

const VENDOR = new URL('../vendor/pdfjs/', import.meta.url);
const WASM = 'https://plugin.test/vendor/pdfjs/wasm/';
// An 8×8 red picture as JPXDecode, the whole PDF (864 bytes).
const JPX_PDF = 'JVBERi0xLjUKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA4IDhdIC9SZXNvdXJjZXMgPDwgL1hPYmplY3QgPDwgL0ltMCA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL1hPYmplY3QgL1N1YnR5cGUgL0ltYWdlIC9XaWR0aCA4IC9IZWlnaHQgOCAvRmlsdGVyIC9KUFhEZWNvZGUgL0xlbmd0aCAyNDQgPj4Kc3RyZWFtCgAAAAxqUCAgDQqHCgAAABRmdHlwanAyIAAAAABqcDIgAAAALWpwMmgAAAAWaWhkcgAAAAgAAAAIAAMHBwAAAAAAD2NvbHIBAAAAAAAQAAAAp2pwMmP/T/9RAC8AAAAAAAgAAAAIAAAAAAAAAAAAAAAIAAAACAAAAAAAAAAAAAMHAQEHAQEHAQH/UgAMAAAAAQADBAQAAf9cAA1AQEhIUEhIUEhIUP9kACUAAUNyZWF0ZWQgYnkgT3BlbkpQRUcgdmVyc2lvbiAyLjUuNP+QAAoAAAAAACYAAf+Tz7QIBE/PtAgIn8+0CAifgICAgICAgICA/9kKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMjYgPj4Kc3RyZWFtCnEgOCAwIDAgOCAwIDAgY20gL0ltMCBEbyBRCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA2MDUgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo2ODEKJSVFT0YK';

// The node serves the plugin's files; here they come from the folder. Anything else is a 404.
const asked = [];
function serveFolder() {
  vi.stubGlobal('fetch', async (u) => {
    asked.push(String(u));
    const rel = String(u).startsWith(WASM) ? `wasm/${String(u).slice(WASM.length)}` : null;
    const file = rel && new URL(rel, VENDOR);
    if (!file || !existsSync(file)) return new Response('', { status: 404 });
    return new Response(readFileSync(file));
  });
}
afterEach(() => { vi.unstubAllGlobals(); asked.length = 0; });

async function decodedPicture(extra) {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await lib.getDocument({ data: Uint8Array.from(Buffer.from(JPX_PDF, 'base64')), isEvalSupported: false, verbosity: 0, wasmUrl: WASM, ...extra }).promise;
  try {
    const page = await doc.getPage(1);
    const ops = await page.getOperatorList();
    const i = ops.fnArray.indexOf(lib.OPS.paintImageXObject);
    if (i < 0) return null;
    const id = ops.argsArray[i][0];
    const img = await new Promise((ok) => page.objs.get(id, ok));
    return img;
  } finally { await doc.destroy(); }
}

describe('pdf.js JPEG 2000 decoder from a .wasm.gz (GzWasmData)', () => {
  it('ships no .wasm, only .wasm.gz, for the pdf.js it tests with', async () => {
    expect(readFileSync(new URL('pdf.min.mjs', VENDOR), 'utf8')).toContain('pdfjsVersion = 5.7.284');
    expect((await import('pdfjs-dist/legacy/build/pdf.mjs')).version).toBe('5.7.284');
    expect(existsSync(new URL('wasm/openjpeg.wasm', VENDOR))).toBe(false);
    expect(existsSync(new URL('wasm/jbig2.wasm', VENDOR))).toBe(false);
    expect(existsSync(new URL('wasm/openjpeg.wasm.gz', VENDOR))).toBe(true);
    expect(existsSync(new URL('wasm/jbig2.wasm.gz', VENDOR))).toBe(true);
  });

  // pdf.js keeps the decoder once loaded (per process), so the case without it runs first.
  it('without it (the browser default, which fetches <name>.wasm as is), the picture is lost', async () => {
    serveFolder();
    class PlainFetch { // pdf.js's DOMBinaryDataFactory, in short (not exported)
      constructor({ wasmUrl }) { this.wasmUrl = wasmUrl; }
      async fetch({ filename }) { const r = await fetch(this.wasmUrl + filename); if (!r.ok) throw new Error('404'); return new Uint8Array(await r.arrayBuffer()); }
    }
    const img = await decodedPicture({ BinaryDataFactory: PlainFetch });
    expect(asked.some((u) => u.endsWith('openjpeg.wasm'))).toBe(true);
    expect(img?.width === 8).toBe(false);
  });
  it('decodes a JPEG 2000 picture through the gzipped decoder', async () => {
    serveFolder();
    const img = await decodedPicture({ BinaryDataFactory: GzWasmData });
    expect(asked).toContain(`${WASM}openjpeg.wasm.gz`);
    expect(img?.width).toBe(8);
    expect(img?.height).toBe(8);
  });

});
