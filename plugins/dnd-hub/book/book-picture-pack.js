// book-picture-pack.js — how a book's pictures are stored: big ones (maps) one file each, small ones (a card deck,
// handouts) packed together into a few files. Pure.
//
// WHY: the node takes 20 plugin-file uploads a minute per person (dissent-core router_plugins.go), and a book used
// to upload every picture as its own file. A 40-card deck ran into that limit, the save failed, and the clean-up
// (deletes count against the same limit) left the uploaded half behind (2026-10-04, 53 orphan files). Packed, the
// deck is one upload. A pack is JSON (the node accepts text; it refuses unknown binary), pictures in base64.

export const PACK_KIND = 'lanternkeep-picture-pack';
export const SMALL = 600_000;      // a picture under this (bytes) goes in a pack
export const PACK_MAX = 6_000_000; // raw bytes per pack (base64 makes it about a third bigger)

/** `pics` [{ id, size }] → [{ single: pic }] and [{ pack: [pics] }], in order; nothing is left out. */
export function planPictureFiles(pics, { small = SMALL, packMax = PACK_MAX } = {}) {
  const out = [];
  let pack = null, packBytes = 0;
  for (const p of pics) {
    if (p.size >= small) { out.push({ single: p }); continue; }
    if (!pack || packBytes + p.size > packMax) { pack = []; packBytes = 0; out.push({ pack }); }
    pack.push(p); packBytes += p.size;
  }
  return out;
}

const b64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** A pack file's text from [{ id, bytes: Uint8Array }]. */
export const packText = items => JSON.stringify({ kind: PACK_KIND, v: 1, pictures: items.map(i => ({ id: i.id, data: b64(i.bytes) })) });

/** A pack file's pictures: picture id → Uint8Array (WebP). Throws on a file that is not a pack. */
export function unpack(text) {
  const j = JSON.parse(text);
  if (j?.kind !== PACK_KIND || !Array.isArray(j.pictures)) throw new Error('not a LanternKeep picture pack');
  return Object.fromEntries(j.pictures.filter(p => typeof p?.id === 'string' && typeof p.data === 'string').map(p => [p.id, unb64(p.data)]));
}

/** Whether an upload failed only because the node's per-minute limit was reached (worth waiting and trying again). */
export const isRateLimited = e => /rate limit|too many requests|\b429\b/i.test(String(e?.message || e || ''));
