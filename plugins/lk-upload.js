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

/** `guarded(requestWithTransfer)('files:upload', …same arguments)`: the transport, with uploadFile's message. */
export const guarded = send => (...args) => uploadFile(() => send(...args), undefined);
