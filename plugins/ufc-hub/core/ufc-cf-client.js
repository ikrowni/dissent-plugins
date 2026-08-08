// core/ufc-cf-client.js — fetching CloudFront, and resolving its event id.
//
// CloudFront has NO index endpoint: /api/v3/rankings.json, /api/v3/events.json,
// /api/v3/event/live/upcoming.json and /api/v3/schedule.json all 404 (probed 2026-08-08).
// So an id still has to be discovered — but ONCE per event, not once per load, and over a
// BOUNDED span rather than the old +/-20 spiral.
//
// The old code guessed the id by extrapolating one event per week and scanning until a
// StartTime landed within three days. That premise is false: ids follow announcement
// order, and DWCS / Road To UFC cards consume ids without consuming weeks.
import { getJson } from './http.js';
import { matchEvent } from './event-index.js';
import { KEY } from './store.js';

export const CF_URL = (id) =>
  `https://d29dxerjsp82wz.cloudfront.net/api/v3/event/live/${id}.json`;

/** Ids observed in production on 2026-08-08; only ever a starting point for the probe. */
export const CF_ANCHOR_ID = 1324;
export const CF_ANCHOR_DATE = '2026-08-08';

/**
 * Fetch every id in [from, to] and keep the ones that resolve.
 *
 * Deliberately inclusive and bounded: the caller decides the span, so a wrong anchor
 * costs a fixed number of requests instead of fanning out.
 */
export async function probeRange(from, to, { fetcher = getJson } = {}) {
  const ids = [];
  for (let id = from; id <= to; id += 1) ids.push(id);

  const results = await Promise.all(ids.map(async (id) => {
    try {
      const raw = await fetcher(CF_URL(id));
      // `fetcher` is getJson in production (already parsed) but a test stub returns the
      // host envelope, so accept both rather than assuming one.
      const json = typeof raw?.body === 'string' ? JSON.parse(raw.body) : raw;
      const d = json?.LiveEventDetail;
      if (!d?.EventId) return null;
      return { eventId: Number(d.EventId), startTime: d.StartTime ?? null, name: d.Name ?? '' };
    } catch {
      return null;
    }
  }));

  return results.filter(Boolean);
}

/**
 * The CloudFront id for an ESPN event, cached to user storage forever once learned.
 *
 * @param target  an entry from parseMonthIndex: { id, date, name }
 */
export async function resolveCfId(target, {
  store, fetcher = getJson, anchorId = CF_ANCHOR_ID, anchorDate = CF_ANCHOR_DATE, span = 12,
} = {}) {
  if (!target?.id || !target?.date) return null;

  const cacheKey = KEY.cfId(target.id);
  const cached = await store.getUser(cacheKey, null);
  if (cached) return Number(cached);

  // A previous probe for a NEIGHBOURING event very likely already learned this one.
  const byDate = await cachedIdForDate(target.date, { store });
  if (byDate) {
    await store.setUser(cacheKey, byDate);
    return byDate;
  }

  // Ids track announcement order, which correlates loosely with date — so centre the
  // probe on the anchor offset by the number of weeks between the dates, then widen by
  // `span` on each side. Bounded, unlike the original spiral.
  //
  // Measured drift against live data on 2026-08-08 (anchor 1324 @ Aug 8): Aug 1 -> 1321
  // (2 off), Aug 15 -> 1317 (8 off, and LOWER than the anchor despite being LATER), Aug 18
  // -> 1329 (4 off). span 12 covers the observed worst case with margin.
  const weeks = Math.round(
    (new Date(target.date).getTime() - new Date(anchorDate).getTime()) / (7 * 864e5),
  );
  const centre = Math.max(1, anchorId + weeks);
  const found = await probeRange(centre - span, centre + span, { fetcher });

  // A probe of 25 ids discovers ~25 events, and the caller will very likely want several
  // of them (the schedule view walks a whole month). Caching only the one we were asked
  // for would re-pay the same 25 requests for the very next event, so every discovered
  // mapping is written by DATE. `resolveCfId` reads the id-keyed entry first and this
  // date-keyed entry second — see the lookup above and byDate() below.
  await Promise.all(found.map((c) => {
    const day = String(c.startTime ?? '').slice(0, 10);
    return day ? store.setUser(KEY.cfDate(day), c.eventId) : null;
  }).filter(Boolean));

  const hit = matchEvent(target, found);
  if (!hit) return null;

  await store.setUser(cacheKey, hit.eventId);
  return hit.eventId;
}

/**
 * The cheap path: an id already learned for this DATE by a previous probe.
 *
 * Dates are unique across UFC events (measured: 40 events, nine months, zero collisions),
 * so a date-keyed cache is safe and lets one 25-request probe serve a whole month.
 */
export async function cachedIdForDate(date, { store }) {
  if (!date) return null;
  const hit = await store.getUser(KEY.cfDate(date), null);
  return hit ? Number(hit) : null;
}
