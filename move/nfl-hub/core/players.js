// core/players.js — loads and queries the generated player index, and resolves
// Sleeper players to ESPN athletes.
//
// The index is a static asset on the plugin's own origin, fetched with plain fetch()
// rather than the host proxy: it is same-origin under the plugin CSP, so it is not
// subject to the 1 MB fetch:external cap. Regenerate with
// scripts/build-player-index.mjs.
//
// ── Why resolveEspnId exists ──────────────────────────────────────────────────
// The design assumed Sleeper's espn_id would carry the Sleeper→ESPN join. Measured
// 2026-08-07, it does not: only 55% of all Sleeper records have one, and just 22% of
// *active fantasy players on an NFL team*. The gaps are not obscure players — they
// include starting kickers (Brandon Aubrey), starting backs (Bucky Irving) and
// first-round picks (Omarion Hampton). Sleeper appears to have largely stopped
// populating it for players who entered from ~2023 onward.
//
// So espn_id is a fast path, and a normalised name match is the real join. ESPN's own
// payloads (rosters, boxscores, summaries) all carry athlete id + display name, so the
// fallback needs no extra fetches — it matches against data the hub already holds.
import { normalizeAbbr } from './config.js';

const ASSET = 'assets/players.index.json';

/** Casefold, drop punctuation and generational suffixes, collapse whitespace.
 *
 *  The two sources disagree constantly on exactly these: Sleeper writes
 *  "Odell Beckham Jr." where ESPN writes "Odell Beckham Jr", and "A.J. Brown" vs
 *  "AJ Brown". Normalising both sides makes the match reliable. */
export function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function defaultLoader() {
  const res = await fetch(ASSET);
  if (!res.ok) throw new Error(`player index HTTP ${res.status}`);
  return res.json();
}

export function createPlayerIndex({ loader = defaultLoader } = {}) {
  let raw = null;
  let pending = null;

  const normalise = (id, p) => ({
    sleeperId: String(id),
    name: p.n ?? 'Unknown',
    position: p.p ?? null,
    teamAbbr: p.t ? normalizeAbbr(p.t) : null,
    espnId: p.e ?? null,
  });

  const api = {
    /** Resolves true on success, false on failure. Never rejects: a missing index
     *  degrades the UI to Sleeper names without live NFL context, not to an error. */
    load() {
      if (raw) return Promise.resolve(true);
      if (pending) return pending;
      pending = Promise.resolve()
        .then(loader)
        .then((data) => { raw = data ?? {}; return true; })
        .catch(() => false)
        .finally(() => { pending = null; });
      return pending;
    },

    get(sleeperId) {
      if (!raw || sleeperId === null || sleeperId === undefined) return null;
      const p = raw[String(sleeperId)];
      return p ? normalise(sleeperId, p) : null;
    },

    getMany(ids) {
      return (ids ?? []).map((id) => api.get(id)).filter(Boolean);
    },

    /**
     * Resolve a player from this index to an ESPN athlete id.
     *
     * @param player        a record from get(), or null
     * @param espnAthletes  ESPN athletes to match against. Accepts ESPN's raw shape
     *                      ({ id, displayName, position }) or an already-flattened
     *                      one ({ id, name }).
     * @returns numeric ESPN athlete id, or null when there is no confident match.
     *
     * Position is deliberately NOT required to match: ESPN says PK where Sleeper says
     * K, DEF/DST differ too, and a name match within a supplied athlete list is
     * already tightly scoped by the caller (one game, or one team's roster).
     */
    resolveEspnId(player, espnAthletes) {
      if (!player) return null;
      if (player.espnId) return player.espnId;

      const target = normalizeName(player.name);
      if (!target) return null;

      for (const a of espnAthletes ?? []) {
        const name = a.displayName ?? a.name ?? a.fullName ?? null;
        if (normalizeName(name) === target) {
          const id = Number(a.id);
          return Number.isFinite(id) ? id : null;
        }
      }
      return null;
    },

    get isReady() { return raw !== null; },
    get size() { return raw ? Object.keys(raw).length : 0; },
  };

  return api;
}

export const players = createPlayerIndex();
