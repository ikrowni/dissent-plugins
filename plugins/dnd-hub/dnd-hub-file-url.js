// dnd-hub-file-url.js — a stored file's link, reused for a while instead of asked for again.
//
// Each files:getUrl answer is a NEW signed link (the node signs it for 15 minutes), so the browser could never reuse
// a picture it had already downloaded: every tavern or shop opening fetched its picture and sound again, and from a
// slow bucket that took ~10 s (owner, 2026-10-05). The same link for 10 minutes lets the browser cache do its job.
import { request } from '../plugin-sdk.js';

const KEEP_MS = 10 * 60 * 1000;
const _links = new Map(); // fileId → { url, mime, at }

/** { url, mime } for a stored file, or null when it cannot be had. */
export async function fileUrl(fileId) {
  if (!fileId) return null;
  const hit = _links.get(fileId);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit;
  const res = await request('files:getUrl', { fileId }).catch(() => null);
  if (!res?.url) return null;
  const link = { url: res.url, mime: res.mime || '', at: Date.now() };
  _links.set(fileId, link);
  return link;
}
