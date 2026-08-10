// core/draft-ranking.js — the client's copy of the draft ranking.
//
// One loader shared by the live draft and the mock, so the 22 KB asset is
// fetched once per session rather than once per board.
//
// ⚠️ THE RANKING IS BACKWARD-LOOKING AND THE UI MUST SAY SO. It is value over
// replacement for last season, which knows nothing about rookies, injuries or a
// changed depth chart. That is an honest basis for a board; presenting it as a
// projection would not be.

let ranking = null;
let loading = null;

/** Inject a ranking directly. For tests, and for a view that already has one. */
export function setRanking(value) {
  ranking = value;
  loading = null;
}

/** The loaded ranking, or null if it has not loaded yet. */
export function getRanking() {
  return ranking;
}

/**
 * Load the ranking once. Concurrent callers share the same request.
 *
 * ⚠️ THROWS ON FAILURE, unlike the player index. A missing index degrades names
 * to ids and the screen still works; a missing ranking leaves a draft board with
 * no players in it, and pretending that is an empty pool would tell a manager
 * that everybody is already drafted.
 */
export async function loadRanking() {
  if (ranking) return ranking;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(new URL('../assets/draft-ranking.json', import.meta.url));
      if (!res.ok) throw new Error(`draft ranking ${res.status}`);
      ranking = await res.json();
      return ranking;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/**
 * The ordered id list for a scoring type.
 *
 * Falls back to PPR for an unrecognised type rather than returning nothing — a
 * league with an unusual scoring name should still get a board.
 */
export function rankingFor(scoring = 'ppr') {
  const key = String(scoring ?? 'ppr').toLowerCase();
  const list = ranking?.[key];
  if (Array.isArray(list) && list.length) return list;
  return Array.isArray(ranking?.ppr) ? ranking.ppr : [];
}
