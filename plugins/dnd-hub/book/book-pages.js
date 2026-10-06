// book-pages.js — a picture of every page of a book, saved with it, so the reader can show the real page beside a
// section ("Show the page").
//
// WHY: no reading of a PDF's text gets every book right — a scan's words are a machine's guesses (Curse of Strahd:
// "CURSE OF STRABO"), and a designed page loses its layout, sidebars and art. Every VTT that does books well either
// ships hand-made versions or simply shows the PDF (Foundry's PDFoundry). The page itself is never wrong, so it is
// kept beside the text. The PDF is never uploaded, so the pictures are made when the DM saves (the file is still
// open then): PAGE_WIDTH px wide, WebP, packed into a few files (book-picture-pack.js, the node's 20 uploads a minute).
// One entry per PDF of the import in book.docs (lk-book.js bookDocs; an old book's `pages` is doc 0):
// { name, count, fingerprint, packs: [{ fileId, from, to }] }; a page's picture is `page-<n>` in the pack that holds it.
import { pdfjs, openPdf } from './book-pdf.js';
import { PACK_MAX } from './book-picture-pack.js';
import { saveBookPack, loadBookPicture } from './book-library.js';
import { bookDocs } from '../lk-book.js';

export const PAGE_WIDTH = 900, QUALITY = 0.6;
const EST_BYTES = 90_000; // a 900 px page as WebP, measured roughly; only for the "about N MB" line
const SHOW_MAX = 4;       // pages shown beside one section at most

export const pageId = n => `page-${n}`;
/** About how many bytes the page pictures of a `pages`-page book take. */
export const pagesEstimate = pages => pages * EST_BYTES;

/**
 * The pages to show beside section `i` of `story`: from its own page through the page the next section starts on
 * (the section may run onto it), at most SHOW_MAX. The last section shows its own page and the one after.
 */
export function sectionPages(story, i, count = Infinity) {
  const s = story?.[i];
  if (!s?.page) return [];
  const next = story.slice(i + 1).find(x => x.page)?.page;
  const end = Math.min(next == null ? s.page + 1 : Math.max(next, s.page), s.page + SHOW_MAX - 1, count);
  const out = [];
  for (let n = s.page; n <= end; n++) out.push(n);
  return out;
}

/** Where page `n` of PDF `doc` has its picture: { fileId, packed, id } for loadBookPicture, or null. */
export function pagePicture(book, doc, n) {
  const pack = (bookDocs(book)[doc]?.packs || []).find(p => n >= p.from && n <= p.to);
  return pack ? { fileId: pack.fileId, packed: true, id: pageId(n) } : null;
}

/** A page's picture as bytes (cached by its pack, book-library.js). */
export const loadPage = (book, doc, n) => { const p = pagePicture(book, doc, n); return p ? loadBookPicture(p) : Promise.reject(new Error('no picture of that page')); };

/** A pack's name in its file name: the first PDF's keep the old "pages-<k>", later PDFs say which they are. */
export const packName = (doc, k) => (doc ? `d${doc + 1}-pages-${k}` : `pages-${k}`);

/**
 * Draw every page of `pdf` (a Blob, PDF number `doc` of the book) and save the pictures beside `book`, in packs.
 * `onProgress(page, pages)`, `onWait(seconds)` while the node's upload limit is waited out, `uploaded(fileId)` for each
 * file saved (so a failed save can remove them). Returns that PDF's entry for book.docs: { name, count, fingerprint, packs }.
 */
export async function savePages(book, pdf, place, { onProgress = () => {}, onWait, uploaded = () => {}, doc = 0, name = '', fingerprint = null } = {}) {
  const lib = await pdfjs();
  const pdfDoc = await openPdf(lib, pdf);
  const packs = [];
  let items = [], bytes = 0, from = 1;
  const flush = async to => {
    if (!items.length) return;
    const fileId = await saveBookPack(book, items, place, packName(doc, packs.length + 1), onWait);
    uploaded(fileId);
    packs.push({ fileId, from, to });
    items = []; bytes = 0; from = to + 1;
  };
  try {
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const blob = await drawPage(await pdfDoc.getPage(n));
      if (blob) { items.push({ id: pageId(n), blob }); bytes += blob.size; }
      if (bytes >= PACK_MAX) await flush(n);
      onProgress(n, pdfDoc.numPages);
      await new Promise(r => setTimeout(r, 0)); // the screen stays alive
    }
    await flush(pdfDoc.numPages);
    return { name, count: pdfDoc.numPages, fingerprint, packs };
  } finally {
    pdfDoc.destroy();
  }
}

async function drawPage(page) {
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: PAGE_WIDTH / vp1.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // transparent would read as black
  try {
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    return await new Promise(r => canvas.toBlob(r, 'image/webp', QUALITY));
  } catch { return null; } finally {
    page.cleanup();
    canvas.width = canvas.height = 0;
  }
}
