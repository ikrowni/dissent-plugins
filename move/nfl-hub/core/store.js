// core/store.js — plugin storage with week-sharded keys.
//
// The host allows 64 KB per key and 10 MB per install. A season of pick'em in one blob
// would breach the per-key limit, so anything that grows with the season shards by
// week. Sharding also removes most write contention: two members picking different
// weeks never touch the same key.
import { storageGet as hostGet, storageSet as hostSet } from '../../plugin-sdk.js';

export const MAX_KEY_BYTES = 64 * 1024;

export const KEY = {
  picks: (season, week) => `pickem:${season}:w${week}`,
  pickemStandings: (season) => `pickem:standings:${season}`,
  powerBallots: (season, week) => `power:${season}:w${week}`,
  bets: (season) => `bets:${season}`,
  awards: (season) => `awards:${season}`,
  // Derived, not authored — sharded by week so a settled sim is never shown against a
  // schedule that has since moved on.
  playoffOdds: (leagueId, season, week) => `odds:${leagueId}:${season}:w${week}`,
  prefs: () => 'prefs',
};

export function createStore({ storageGet = hostGet, storageSet = hostSet } = {}) {
  async function read(key, scope, fallback) {
    try {
      const v = await storageGet(key, scope);
      return v ?? fallback;
    } catch {
      // A storage read failure must never blank a panel.
      return fallback;
    }
  }

  async function write(key, value, scope) {
    const bytes = new TextEncoder().encode(JSON.stringify(value ?? null)).length;
    if (bytes > MAX_KEY_BYTES) {
      // Thrown, not swallowed: this is a programming error (state that should have
      // been sharded), and it names the key so the fix is obvious.
      throw new Error(
        `${key} is ${bytes} bytes, over the host's 64 KB per-key limit — shard it`);
    }
    try {
      await storageSet(key, value, scope);
      return true;
    } catch {
      return false;
    }
  }

  return {
    getShared: (key, fallback = null) => read(key, 'server', fallback),
    setShared: (key, value) => write(key, value, 'server'),
    getUser: (key, fallback = null) => read(key, 'user', fallback),
    setUser: (key, value) => write(key, value, 'user'),

    /** Read-modify-write against shared state. Writes are last-write-wins per key, so
     *  re-reading immediately before writing keeps two members editing the same week
     *  from clobbering each other in the common case. */
    async mergeShared(key, mutate, fallback = {}) {
      const current = await read(key, 'server', fallback);
      return write(key, mutate(current), 'server');
    },
  };
}

export const store = createStore();
