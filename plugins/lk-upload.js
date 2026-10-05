// lk-upload.js — every LanternKeep upload goes through here (plan 2026-10-03, plugin files off the node).
// ⚠️ SOURCE; vendored into dnd-hub, dnd-master and dnd-player (scripts/vendor-shared.mjs).
//
// The node decides where a file goes (your own storage, else your share of the server's) and, when there is
// nowhere, refuses with a sentence naming the fix. Show that sentence; never swallow it (a sound zone used to
// save with no sound and say nothing).

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** What to tell the person, from the error the upload failed with. */
export function storageAdvice(msg) {
  const m = String(msg || '').trim();
  if (/Settings → Storage|used all your storage|limit on this server/.test(m)) return cap(m);
  if (/\b413\b|too large/i.test(m)) return 'That file is too large for your storage here.';
  return `That file could not be uploaded (${m || 'no reason given'}).`;
}

// Marked so a caller's own catch knows the person has already been told (`if (!e?.shown) alert(…)`).
const shownError = msg => Object.assign(new Error(msg), { shown: true });

/**
 * `send(params)` performs the upload (requestWithTransfer or request, bound to 'files:upload'). `show(message)`
 * displays a failure (default: alert). Rejects after showing, so a caller stops and must not show it again.
 */
export async function uploadFile(send, params, show = m => alert(m)) {
  let res;
  try {
    res = await send(params);
  } catch (e) {
    const msg = storageAdvice(e?.message || e);
    show(msg);
    throw shownError(msg);
  }
  if (!res?.id) {
    const msg = storageAdvice('the upload returned no file');
    show(msg);
    throw shownError(msg);
  }
  return res;
}

// ── Pictures are shrunk before they go up (owner, 2026-10-05) ────────────────────────────────────────────────────
// Item art arrived as 7–8 MB PNGs; every screen that shows the item downloads all of it, and from a slow bucket one
// picture took minutes. Anything over SHRINK_OVER is re-encoded as WebP with its longest side at most `maxSide`
// (MAX_SIDE unless the caller asks for less: item and portrait art is shown small). GIFs (animation) and SVGs are
// left alone, and so is any picture the re-encode would not make smaller.
export const SHRINK_OVER = 600 * 1024, MAX_SIDE = 4096;
const SHRINKABLE = /^image\/(png|jpeg|webp|bmp)$/;

/** What to upload instead of `params` (a files:upload call): smaller when it is a big picture, else `params` itself. */
export async function shrinkPicture(params, encode = encodeWebp) {
  const { maxSide, ...rest } = params || {};
  const data = rest.data;
  if (!(data instanceof ArrayBuffer) || !SHRINKABLE.test(rest.mime || '') || data.byteLength <= SHRINK_OVER) return rest;
  let out = null;
  try { out = await encode(data, rest.mime, Math.max(256, maxSide || MAX_SIDE)); } catch { out = null; }
  if (!out || out.byteLength >= data.byteLength) return rest;
  return { ...rest, data: out, mime: 'image/webp', size: out.byteLength, name: String(rest.name || 'picture').replace(/\.[a-z0-9]+$/i, '') + '.webp' };
}

async function encodeWebp(data, mime, maxSide) {
  const bmp = await createImageBitmap(new Blob([data], { type: mime }));
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
    : await new Promise(r => canvas.toBlob(r, 'image/webp', 0.86));
  return blob?.type === 'image/webp' ? blob.arrayBuffer() : null; // a browser that cannot write WebP gives a PNG: keep the original
}

/**
 * `guarded(requestWithTransfer)('files:upload', …same arguments)`: the transport, with uploadFile's message. A big
 * picture is shrunk first (shrinkPicture); a transfer list then carries the new bytes instead of the old.
 */
export const guarded = send => async (action, params, transfers, ...rest) => {
  const p = action === 'files:upload' ? await shrinkPicture(params) : params;
  const t = Array.isArray(transfers) && p?.data !== params?.data ? [p.data] : transfers;
  return uploadFile(() => send(action, p, ...(transfers === undefined && !rest.length ? [] : [t, ...rest])), undefined);
};
