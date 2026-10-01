// rl-stats-summary.js — one key holding what the members list and leaderboard show.
//
// ⚠️ WHY IT EXISTS. Both views used to read every member's FULL stats (up to ~9 KB each) on
// every open — about 8 reads per mount — and the hub, the sidebar and the overlay mount often
// enough to pass the node's 120 reads/minute limit (429s seen 2026-10-01). The summary is one
// read. Full stats are still read per member where a view needs them: the profile, a card.
//
// ⚠️ SAME SHAPE AS THE FULL STATS, current season only. getMmr / getMemberRankInfo /
// getSeasonNums read it unchanged — a second shape would mean a second set of readers.

export const SUMMARY_KEY = 'rl:stats-summary';
// The node refuses a value over 64 KB. Past this the summary is simply not written and the
// views fall back to per-member reads — slower, never wrong.
export const SUMMARY_MAX_BYTES = 60 * 1024;

const PLAYLIST_FIELDS = ['mmr', 'rankName', 'division', 'iconSrc'];

/** The rank fields of the current season, or null when there is no season to show. */
export function summarize(data) {
  const season = data?.currentSeason;
  const playlists = data?.seasons?.[season]?.playlists;
  if (season == null || !playlists) return null;
  const kept = {};
  for (const [id, p] of Object.entries(playlists)) {
    kept[id] = Object.fromEntries(PLAYLIST_FIELDS.filter((f) => p?.[f] !== undefined).map((f) => [f, p[f]]));
  }
  return {
    currentSeason: season,
    ...(data.seasonLabels?.[season] ? { seasonLabels: { [season]: data.seasonLabels[season] } } : {}),
    seasons: { [season]: { playlists: kept } },
  };
}

/**
 * A new summary with `entries` ([statsKey, { fetchedAt, data }] pairs, full data) folded in,
 * or null when the result would be too large to store.
 */
export function withSummaries(summary, entries) {
  const next = { ...(summary ?? {}) };
  for (const [key, entry] of entries) {
    next[key] = { fetchedAt: entry.fetchedAt, data: summarize(entry.data) };
  }
  return JSON.stringify(next).length > SUMMARY_MAX_BYTES ? null : next;
}
