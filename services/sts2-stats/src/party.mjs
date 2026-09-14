// services/sts2-stats/src/party.mjs — a relay for co-op parties. MEMORY ONLY: nothing here touches disk.
//
// In Slay the Spire 2 co-op only the HOST's game keeps the run, so a guest's computer has nothing to
// read. A party member's Companion seals the run with a key derived from the party code and posts it
// here; the others fetch it and open it. This service sees a channel id (a hash of the code) and
// opaque bytes — never a deck, a name, or the code (plugin core/partyCrypto.js).
//
// Bounded: one current run per channel (2 h after its last write), up to MAX_FINISHED finished runs
// (7 days), a global byte budget that evicts the least recently written channels, and a per-address
// hourly request allowance keyed by a salted hash that rotates, as limits.mjs does.

import { createHash, randomBytes } from 'node:crypto';

export const PARTY_TTL_MS = 2 * 3600 * 1000;
export const FINISHED_TTL_MS = 7 * 86400 * 1000;
export const MAX_FINISHED = 10;
export const MAX_BLOB = 400_000; // base64 chars; a sealed run projection is ~70 KB
export const CHANNEL_RE = /^[a-f0-9]{32}$/;
export const KEY_RE = /^[a-f0-9]{32}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const HOURLY = 3600;

export function createParty({ now = () => Date.now(), budgetBytes = 64 * 1024 * 1024 } = {}) {
  const channels = new Map(); // insertion order = least recently written first
  let used = 0;
  let hour = null; let salt = null; let hits = new Map();

  const sizeOf = (c) => (c.current?.data.length ?? 0) + c.finished.reduce((n, f) => n + f.data.length, 0);

  function expire(id, c) {
    const t = now();
    const before = sizeOf(c);
    if (c.current && t - c.current.updatedAt > PARTY_TTL_MS) c.current = null;
    c.finished = c.finished.filter((f) => t - f.at <= FINISHED_TTL_MS);
    used -= before - sizeOf(c);
    if (!c.current && !c.finished.length) channels.delete(id);
  }

  function touch(id) {
    const c = channels.get(id) ?? { current: null, finished: [] };
    channels.delete(id);
    channels.set(id, c);
    return c;
  }

  function evict() {
    for (const [id, c] of channels) {
      if (used <= budgetBytes) break;
      used -= sizeOf(c);
      channels.delete(id);
    }
  }

  return {
    putCurrent(id, data) {
      const c = touch(id);
      used -= c.current?.data.length ?? 0;
      c.current = { data, updatedAt: now() };
      used += data.length;
      evict();
    },
    getCurrent(id) {
      const c = channels.get(id);
      if (!c) return null;
      expire(id, c);
      return c.current ? { ...c.current } : null;
    },
    putFinished(id, key, data) {
      const c = touch(id);
      if (c.finished.some((f) => f.key === key)) return;
      c.finished.push({ key, data, at: now() });
      used += data.length;
      while (c.finished.length > MAX_FINISHED) used -= c.finished.shift().data.length;
      evict();
    },
    getFinished(id) {
      const c = channels.get(id);
      if (!c) return [];
      expire(id, c);
      return c.finished.map((f) => ({ ...f }));
    },
    /** false once an address has made HOURLY requests this hour. */
    allow(ip) {
      const h = Math.floor(now() / 3_600_000);
      if (h !== hour) { hour = h; salt = randomBytes(16); hits = new Map(); }
      const k = createHash('sha256').update(salt).update(String(ip)).digest('hex');
      const n = (hits.get(k) ?? 0) + 1;
      hits.set(k, n);
      return n <= HOURLY;
    },
    bytes: () => used,
  };
}

export const validBlob = (d) => typeof d === 'string' && d.length > 0 && BASE64_RE.test(d);
