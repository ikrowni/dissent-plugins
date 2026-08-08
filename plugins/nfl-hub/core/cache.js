// core/cache.js — TTL memo with in-flight coalescing.
//
// Load-bearing, not an optimization: fetch:external caps responses at 1 MB and the
// node image proxy allows 120 req/min per IP. A broadcast layout has many components
// wanting the same game summary at once, so without coalescing the plugin rate-limits
// itself within seconds of opening.
export function createCache() {
  const values = new Map();   // key -> { value, expiresAt }
  const inflight = new Map(); // key -> Promise

  function fresh(key) {
    const e = values.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.expiresAt) return undefined;
    return e;
  }

  return {
    /** Cached value if unexpired, else undefined. Never triggers a load. */
    peek(key) {
      return fresh(key)?.value;
    },

    /** Stale-or-fresh value if present at all. What staleOnError falls back to. */
    peekStale(key) {
      return values.get(key)?.value;
    },

    /**
     * @param key      cache key (use the request url)
     * @param loader   () => Promise<value>, called at most once per miss
     * @param ttlMs    how long the result stays fresh
     * @param opts     { staleOnError } — on loader failure, resolve with the last
     *                 known value instead of rejecting, when one exists.
     */
    get(key, loader, ttlMs, opts = {}) {
      // fresh() returns the entry, not the value, so a cached 0 or '' still hits.
      const hit = fresh(key);
      if (hit) return Promise.resolve(hit.value);

      const pending = inflight.get(key);
      if (pending) return pending;

      const p = Promise.resolve()
        .then(loader)
        .then((value) => {
          values.set(key, { value, expiresAt: Date.now() + ttlMs });
          return value;
        })
        .catch((err) => {
          // A rejection is never cached: the next caller must be able to retry.
          if (opts.staleOnError && values.has(key)) return values.get(key).value;
          throw err;
        })
        .finally(() => { inflight.delete(key); });

      inflight.set(key, p);
      return p;
    },

    invalidate(key) { values.delete(key); inflight.delete(key); },
    clear() { values.clear(); inflight.clear(); },
    get size() { return values.size; },
  };
}

/** Shared instance. Per-endpoint TTLs are below. */
export const cache = createCache();

export const TTL = {
  SCOREBOARD_LIVE: 20_000,
  SCOREBOARD_IDLE: 300_000,
  GAME_LIVE: 20_000,
  GAME_FINAL: 3_600_000,
  STANDINGS: 900_000,
  NEWS: 600_000,
  LEADERS: 900_000,
  ATHLETE: 21_600_000,
  DEPTH_CHART: 21_600_000,
  TEAM_ROSTER: 3_600_000,
  SLEEPER_LEAGUE: 3_600_000,
  SLEEPER_MATCHUPS: 30_000,
  ODDS: 600_000,
};
