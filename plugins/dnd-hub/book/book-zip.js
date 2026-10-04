// book-zip.js — read a .zip the DM dropped in, one file at a time, without loading the whole zip. Pure (Blob APIs).
//
// A bought adventure often arrives as a zip of several PDFs (the book, a maps pack of hundreds of MB) and image
// folders. The zip's table of contents (the "central directory") sits at its end: it is read first, and each entry is
// then cut out of the File with slice() and unpacked as a stream by the browser's own DecompressionStream
// ('deflate-raw'), so a 1 GB zip never sits in memory whole. ZIP64 (zips or entries over 4 GB) is read too.
// Supported: stored (0) and deflated (8) entries, which is what every common zip tool writes. Encrypted entries are
// reported, not opened.

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);
const u64 = (v, o) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 2 ** 32;
const view = async (blob, from, to) => new DataView(await blob.slice(from, to).arrayBuffer());

/** The end-of-central-directory record: where the table of contents is. */
async function directory(blob) {
  const tailLen = Math.min(blob.size, 65557); // the record (22 bytes) + the longest comment (65535)
  const tail = await view(blob, blob.size - tailLen, blob.size);
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { at = i; break; }
  if (at < 0) throw new Error('That file is not a zip, or it is damaged.');
  let count = u16(tail, at + 10), size = u32(tail, at + 12), offset = u32(tail, at + 16);
  // ZIP64: the real numbers are in the ZIP64 end record, found through its locator just before.
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const loc = at - 20;
    if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
      const recAt = u64(tail, loc + 8);
      const rec = await view(blob, recAt, recAt + 56);
      if (u32(rec, 0) === 0x06064b50) { count = u64(rec, 32); size = u64(rec, 40); offset = u64(rec, 48); }
    }
  }
  return { count, size, offset };
}

/**
 * The files in a zip: [{ name, size, compressedSize, method, encrypted, headerOffset }]. Folders are left out.
 * Names are the zip's paths ("Tarokka Deck/Abjurer.png").
 */
export async function listZip(blob) {
  const { count, size, offset } = await directory(blob);
  const cd = await view(blob, offset, offset + size);
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (u32(cd, p) !== 0x02014b50) throw new Error('That zip is damaged (its table of contents does not read).');
    const flags = u16(cd, p + 8), method = u16(cd, p + 10);
    let compressedSize = u32(cd, p + 20), sizeU = u32(cd, p + 24), headerOffset = u32(cd, p + 42);
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // ZIP64 extra field: the 8-byte values for whichever of the three were 0xffffffff, in this order.
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = u16(cd, e), len = u16(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (sizeU === 0xffffffff) { sizeU = u64(cd, q); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cd, q); q += 8; }
        if (headerOffset === 0xffffffff) { headerOffset = u64(cd, q); }
      }
      e += 4 + len;
    }
    if (!name.endsWith('/')) out.push({ name, size: sizeU, compressedSize, method, encrypted: !!(flags & 1), headerOffset });
    p = end + commentLen;
  }
  return out;
}

/** One entry's bytes as a Blob (unpacked as a stream). */
export async function entryBlob(blob, entry, type = '') {
  if (entry.encrypted) throw new Error(`${entry.name} is password protected.`);
  const h = await view(blob, entry.headerOffset, entry.headerOffset + 30);
  if (u32(h, 0) !== 0x04034b50) throw new Error(`${entry.name} could not be found in the zip.`);
  const start = entry.headerOffset + 30 + u16(h, 26) + u16(h, 28);
  const raw = blob.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new Blob([raw], { type });
  if (entry.method !== 8) throw new Error(`${entry.name} is packed in a way this reader does not know (method ${entry.method}).`);
  const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream, { headers: type ? { 'Content-Type': type } : {} }).blob();
}
