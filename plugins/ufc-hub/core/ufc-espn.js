// core/ufc-espn.js — ESPN is the EVENT INDEX, not the detail source.
//
// It is the only source that enumerates events with exact dates, which is what makes the
// CloudFront id resolvable without scanning. It carries no odds and no fighter records —
// CloudFront supplies those.
//
// ⚠️ Fetch ONE MONTH at a time. Measured 2026-08-08:
//     ?dates=202611  ->    10,571 B
//     ?dates=202609  ->   147,458 B
//     ?dates=202608  ->   297,938 B   (busiest of six months measured)
//     ?dates=2026    -> 2,035,461 B   OVER the 1 MB fetch:external cap
// The year form fails silently through the proxy. Never build it.
import { getJson } from './http.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc';

/** ESPN wants a month as YYYYMM. */
export function monthKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const urls = {
  month: (key) => `${SITE}/scoreboard?dates=${key}`,
  scoreboard: () => `${SITE}/scoreboard`,
  news: (limit = 20) => `${SITE}/news?limit=${limit}`,
};

export function parseMonthIndex(json) {
  const evs = json?.events;
  if (!Array.isArray(evs)) return [];
  return evs.map((e) => ({
    id: String(e?.id ?? ''),
    // The date is the join key, so it is kept as a bare YYYY-MM-DD day.
    date: String(e?.date ?? '').slice(0, 10),
    startTime: e?.date ?? null,
    name: e?.name ?? '',
    shortName: e?.shortName ?? '',
    state: e?.status?.type?.state ?? 'pre',
    completed: e?.status?.type?.completed === true,
    fightCount: Array.isArray(e?.competitions) ? e.competitions.length : 0,
  }));
}

export const fetchMonthIndex = async (key) => parseMonthIndex(await getJson(urls.month(key)));
