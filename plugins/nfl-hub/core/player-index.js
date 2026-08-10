// core/player-index.js — the client's copy of the player index.
//
// One loader shared by every league view, so the 308 KB asset is fetched once
// per session rather than once per view that happens to need a name.
//
// ⚠️ SAME-ORIGIN, so no 1 MiB fetch cap applies — the index is a static asset on
// the plugin's own origin. The SERVER module reaches the same file through the
// host fetch proxy and reduces it to positions only; this side keeps the whole
// record because it renders names, teams and positions.
//
// ⚠️ PRESENTATION ONLY. The module validates every lineup against its own copy.
// Nothing here decides whether a move is legal — a disagreement shows up as a
// refused save, which is the correct outcome.

let index = null;
let loading = null;

/** Inject an index directly. For tests, and for a view that already has one. */
export function setIndex(map) {
  index = map;
  loading = null;
}

/** The loaded index, or null if it has not loaded yet. */
export function getIndex() {
  return index;
}

/**
 * Load the index once. Concurrent callers share the same request rather than
 * each firing their own — three views mounting together would otherwise pull
 * the asset three times.
 */
export async function loadIndex() {
  if (index) return index;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(new URL('../assets/players.index.json', import.meta.url));
      if (!res.ok) throw new Error(`player index ${res.status}`);
      index = await res.json();
      return index;
    } catch {
      // A missing index must not break a view. Names degrade to ids, which is
      // ugly but usable; throwing here would blank a roster over cosmetics.
      index = index ?? {};
      return index;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** "Name (POS · TEAM)", or "#id" when the index has no record. */
export function playerLabel(id) {
  const rec = index?.[String(id)];
  if (!rec) return `#${id}`;
  const team = rec.t ? ` · ${rec.t}` : '';
  return `${rec.n} (${rec.p ?? '—'}${team})`;
}

/** A player's position, or null. */
export function positionOf(id) {
  return index?.[String(id)]?.p ?? null;
}

/** A player's display name alone. */
export function playerName(id) {
  return index?.[String(id)]?.n ?? `#${id}`;
}

const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/**
 * Search the index by name.
 *
 * ⚠️ EXCLUDES PLAYERS ALREADY TAKEN. A draft board that offers a drafted player
 * produces a refusal on every click, and the user cannot tell whether they
 * mistyped or somebody beat them to it.
 *
 * Results are ranked by prefix match first, because a manager typing "jef" wants
 * Justin Jefferson before Van Jefferson.
 */
export function searchPlayers(query, { taken = new Set(), limit = 12, positions = null } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (q.length < 2 || !index) return [];

  const allow = positions ? new Set(positions) : FANTASY_POSITIONS;
  const prefix = [];
  const contains = [];

  for (const [id, rec] of Object.entries(index)) {
    if (taken.has(String(id))) continue;
    const pos = rec?.p;
    if (!pos || !allow.has(pos)) continue;
    const name = String(rec.n ?? '').toLowerCase();
    if (!name) continue;
    if (name.startsWith(q)) prefix.push([id, rec]);
    else if (name.includes(q)) contains.push([id, rec]);
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...contains]
    .slice(0, limit)
    .map(([id, rec]) => ({ id: String(id), name: rec.n, position: rec.p, team: rec.t ?? null }));
}
