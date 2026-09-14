// services/sts2-stats/src/limits.mjs — how many runs a contributor, and an address, may send per day.
//
// 🔴 Memory only, and an address is never held as itself: it is keyed by SHA-256 over a random salt that
// is replaced every UTC day, so yesterday's keys cannot be matched to today's and nothing survives a
// restart. The spec's promise is that no IP is written down anywhere (§5).

import { createHash, randomBytes } from 'node:crypto';

export function createLimits({ perContributor = 300, perIp = 600, now = () => Date.now() } = {}) {
  let day = null;
  let salt = null;
  let counts = new Map();

  function roll() {
    const d = Math.floor(now() / 86_400_000);
    if (d !== day) { day = d; salt = randomBytes(16); counts = new Map(); }
  }

  return {
    /** Reserve up to `n` runs; returns how many fit today (0…n). */
    take(contributorId, ip, n) {
      roll();
      const c = `c:${contributorId}`;
      const i = `ip:${createHash('sha256').update(salt).update(String(ip)).digest('hex')}`;
      const room = Math.max(0, Math.min(perContributor - (counts.get(c) ?? 0), perIp - (counts.get(i) ?? 0)));
      const got = Math.min(n, room);
      counts.set(c, (counts.get(c) ?? 0) + got);
      counts.set(i, (counts.get(i) ?? 0) + got);
      return got;
    },
    /** Tests only. */
    _keys: () => [...counts.keys()],
  };
}
