// core/store.js — plugin storage. Keys are sharded so a stale entry is never shown.
import { storageGet, storageSet } from '../../plugin-sdk.js';

export const KEY = {
  // ESPN event id -> CloudFront event id. Immutable once learned, which is what makes
  // the bounded probe a once-per-event cost rather than a once-per-load cost.
  cfId: (espnEventId) => `cfid:${espnEventId}`,
  // Date -> CloudFront id, written for EVERY event a probe discovers, not just the one
  // asked for. One 25-request probe then serves a whole month. Safe as a key because no
  // two UFC events share a date (measured: 40 events over nine months, zero collisions).
  cfDate: (day) => `cfdate:${day}`,
  prefs: () => 'prefs',
};

export function createStore({ get = storageGet, set = storageSet } = {}) {
  return {
    // Storage is best-effort: a failed read costs a recompute, never an error surface.
    async getUser(key, fallback = null) {
      try { return (await get(key, 'user')) ?? fallback; } catch { return fallback; }
    },
    async setUser(key, value) {
      try { await set(key, value, 'user'); return true; } catch { return false; }
    },
  };
}

export const store = createStore();
