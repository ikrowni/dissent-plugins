// core/trending.js — who the rest of fantasy is picking up and dropping.
//
// The waiver wire's missing half. A free-agent list sorted by name tells a
// manager nothing about which of those names just became relevant; this is the
// signal every other fantasy platform puts front and centre, and it is 900 bytes.
//
// PURE PARSE, injected fetcher. The network call belongs to the caller so this
// can be tested without one.

/** Sleeper's trending endpoints. `type` is 'add' or 'drop'. */
export const trendingUrl = (type, { hours = 24, limit = 25 } = {}) =>
  `https://api.sleeper.app/v1/players/nfl/trending/${type === 'drop' ? 'drop' : 'add'}`
  + `?lookback_hours=${hours}&limit=${limit}`;

/**
 * Turn the raw response into rows the UI can render.
 *
 * Sleeper returns `[{ player_id, count }]` and nothing else — no name, no
 * position, no team. Those come from the local index, which is why an unknown
 * id is DROPPED rather than rendered: a row reading "13533" with a transaction
 * count is worse than one fewer row.
 */
export function parseTrending(raw, index = {}, { limit = 10 } = {}) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    const id = String(row?.player_id ?? '');
    const player = index[id];
    if (!id || !player) continue;
    // A count of zero is not a trend; a negative one is nonsense.
    const count = Number(row?.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    out.push({ id, count, player });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Format a transaction count for a chip.
 *
 * ⚠️ THOUSANDS ARE THE NORMAL CASE — the top add today is 52,614 — so the raw
 * number is noise in a narrow column. Rounded to a thousand it still says
 * "everyone is taking this player", which is the entire message.
 */
export function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(v);
}

/**
 * Fetch and parse both directions.
 *
 * ⚠️ ONE FAILING DIRECTION MUST NOT LOSE THE OTHER. These are two independent
 * requests and the panel is useful with either — an empty array is a normal
 * answer here, not an error worth surfacing.
 */
export async function loadTrending(fetchJson, index, { hours = 24, limit = 10 } = {}) {
  const get = async (type) => {
    try {
      return parseTrending(await fetchJson(trendingUrl(type, { hours, limit: limit * 3 })), index, { limit });
    } catch {
      return [];
    }
  };
  const [adds, drops] = await Promise.all([get('add'), get('drop')]);
  return { adds, drops };
}
