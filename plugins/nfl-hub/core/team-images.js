// core/team-images.js — turning a stored file id into something an <img> can use.
//
// The module stores a node file id and nothing else (server/ops-identity.js says
// why at length). The node will not hand out a durable URL for one: `files:getUrl`
// issues a SIGNED, EXPIRING URL on the node's own origin, because a
// storage-origin presigned URL cannot survive the plugin iframe's CSP. So a file
// id has to be redeemed, and redeeming it is a host round trip.
//
// ⚠️ RENDER FUNCTIONS IN THIS HUB ARE SYNCHRONOUS — every view returns an HTML
// string. An async lookup cannot happen during a render, so this module splits
// the two halves: `resolve()` is awaited by a view's `load()`, and `urlFor()` is
// a pure cache read the render calls. A miss is not an error state; it falls back
// to the monogram, which is the correct picture for most teams anyway.

import { request, requestWithTransfer } from '../../plugin-sdk.js';

/**
 * How long a resolved URL is reused.
 *
 * ⚠️ SHORTER THAN THE NODE'S SIGNATURE, DELIBERATELY. `pluginFileSigTTL` is 15
 * minutes (internal/api/handlers/plugin_file_sig.go); caching for the full window
 * guarantees that a URL handed to an <img> at the last moment is already dead.
 * Ten minutes leaves five for the browser to actually load it.
 */
const URL_TTL_MS = 10 * 60 * 1000;

/**
 * The largest image accepted for an avatar or a banner.
 *
 * ⚠️ THIS IS OUR RULE, NOT THE NODE'S. The node allows 500 MB and then bills it
 * against the uploader's per-server quota — so an unchecked picker lets somebody
 * spend their whole allowance on one banner and discover it later. Refusing here
 * costs one message instead.
 *
 * Raised 4 → 20 MB on 2026-08-12 (owner). 4 MB refused ordinary phone photos and
 * screenshots, which is what people actually reach for. Still two orders of
 * magnitude under the node's own cap.
 *
 * ⚠️ A per-file limit is not the only ceiling. The node ALSO enforces a
 * role-derived per-file limit and a per-member quota and answers
 * `file_too_large` / `quota_exceeded` — both surface here as the module's own
 * message, so a server with a tighter policy still wins.
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** What the node will actually store. Anything else is refused after upload. */
const ACCEPT_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const ACCEPT_ATTR = ACCEPT_MIME.join(',');

/**
 * What shape each image is actually drawn in, and what to upload for it.
 *
 * ⚠️ EVERY BANNER IS `object-fit: cover`, so an image of the wrong shape is not
 * letterboxed — it is CROPPED, from the centre, silently. Somebody uploading a
 * portrait photo as a 6:1 team banner gets a thin horizontal slice of its middle
 * and no explanation. Telling them the ratio up front is the whole fix; there is
 * no cropping UI and this is not the round to build one.
 *
 * ⚠️ THE RATIOS ARE MIRRORED IN `styles/league.css` and `core/team-images.test.js`
 * asserts the two agree. A ratio changed in one place and not the other would
 * advertise a size that then gets cropped — the failure being described above,
 * caused by the fix for it.
 *
 * The widths come from the real frame: the plugin is ~890px with the member list
 * open and ~1530px with it collapsed, so a banner has to look sharp at ~1530 CSS
 * px. These are comfortably above that without being absurd under a 20 MB cap.
 */
export const IMAGE_SPEC = Object.freeze({
  avatar: { ratio: '1 / 1', label: 'square', best: '512 × 512' },
  teamBanner: { ratio: '6 / 1', label: '6:1 (wide)', best: '1800 × 300' },
  leagueBanner: { ratio: '5 / 1', label: '5:1 (wide)', best: '1600 × 320' },
});

/** One line of guidance for a picker, e.g. "Square · 512 × 512 works best". */
export function specHint(key) {
  const s = IMAGE_SPEC[key];
  if (!s) return '';
  return `${s.label} · ${s.best} works best — anything else is cropped to fit`;
}

// fileId -> { url, at }. Module-scoped, so every view shares one resolution.
const cache = new Map();
// fileId -> in-flight promise, so twelve standings rows asking at once make one
// request rather than twelve.
const inFlight = new Map();

/** Clear everything. Called when the section is left, and by the tests. */
export function reset() {
  cache.clear();
  inFlight.clear();
}

/**
 * A URL for this file id, if one has already been resolved and is still fresh.
 *
 * ⚠️ SYNCHRONOUS AND NEVER THROWS. It is called from render functions; returning
 * null is a normal answer meaning "draw the fallback".
 */
export function urlFor(fileId) {
  const id = String(fileId ?? '');
  if (!id) return null;
  const hit = cache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > URL_TTL_MS) {
    cache.delete(id);
    return null;
  }
  return hit.url;
}

/**
 * Resolve a batch of file ids, ignoring the ones already cached.
 *
 * ⚠️ NEVER REJECTS. A league whose banner has been deleted must still render its
 * standings — one dead image cannot be allowed to take the pane down. Failures
 * are simply absent from the cache and every caller falls back.
 *
 * Returns true when anything new was resolved, so a caller knows whether a
 * repaint would show something it did not show before.
 */
export async function resolve(fileIds) {
  const wanted = [...new Set((fileIds ?? []).map((f) => String(f ?? '')).filter(Boolean))]
    .filter((id) => urlFor(id) === null);
  if (wanted.length === 0) return false;

  const results = await Promise.all(wanted.map((id) => {
    if (inFlight.has(id)) return inFlight.get(id);
    const p = request('files:getUrl', { fileId: id })
      .then((res) => {
        const url = res?.url ?? null;
        if (url) cache.set(id, { url, at: Date.now() });
        return Boolean(url);
      })
      // A 404 (deleted file) or a 403 (not a member any more) is an ordinary
      // outcome here, not an exception the view should hear about.
      .catch(() => false)
      .finally(() => inFlight.delete(id));
    inFlight.set(id, p);
    return p;
  }));
  return results.some(Boolean);
}

/**
 * Upload one image and return its file id.
 *
 * ⚠️ `attachContext` IS NOT OPTIONAL. It ties the file to the thing it belongs to,
 * so the node reclaims it when that thing is deleted and the 7-day abandoned-upload
 * sweep leaves it alone. A banner uploaded without one disappears after a week.
 *
 * Throws on refusal — this is called from an action, which already has the
 * try/catch and the place to show a message.
 */
export async function uploadImage(file, { context }) {
  if (!file) throw new Error('no file chosen');
  if (!context) throw new Error('an upload needs a context to be attached to');
  if (!ACCEPT_MIME.includes(file.type)) {
    throw new Error(`${file.type || 'that file'} is not an image the server accepts — use PNG, JPEG, WebP or GIF`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`that image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  }

  const buf = await file.arrayBuffer();
  // ⚠️ The buffer is TRANSFERRED, not copied, and 120 s is the interactive
  // timeout: an upload crosses the postMessage bridge and then the network, and
  // the default 10 s request timeout kills a perfectly healthy 3 MB upload on a
  // slow connection.
  const res = await requestWithTransfer('files:upload', {
    name: file.name, mime: file.type, size: file.size, dmOnly: false,
    data: buf, attachContext: context,
  }, [buf], 120000);

  const id = res?.id;
  if (!id) throw new Error('the upload returned no file id');
  // ⚠️ THE RETURNED `url` IS DELIBERATELY DISCARDED. It is a storage-origin URL
  // that the plugin CSP blocks and that a private bucket 403s — see
  // server/ops-identity.js. The id is the only durable part of this response.
  return String(id);
}

/**
 * Drop a file that has just been replaced.
 *
 * ⚠️ BEST EFFORT, AND ONLY AFTER THE NEW ID IS STORED. The node lets only the
 * UPLOADER delete a file, so a commissioner replacing somebody else's avatar gets
 * a 403 here — which must not turn a successful rename into a failed one. A file
 * that survives is not lost: it is still attached to its context and goes when
 * the league does.
 */
export async function discard(fileId) {
  const id = String(fileId ?? '');
  if (!id) return;
  cache.delete(id);
  try {
    await request('files:delete', { fileId: id });
  } catch {
    // Deliberately silent: see above.
  }
}

/** The context key an image belongs to. One definition, used by both callers. */
export const contextFor = {
  league: (leagueId) => `league:${leagueId}`,
  team: (leagueId, teamId) => `team:${leagueId}:${teamId}`,
};
