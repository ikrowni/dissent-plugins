// core/event-index.js — resolve an ESPN event to its CloudFront document.
//
// THE PROBLEM THIS REPLACES: the old plugin extrapolated "one UFC event per week" from a
// hardcoded base id and then scanned +/-20 — up to 41 sequential proxied fetches on load.
// CloudFront ids are assigned by ANNOUNCEMENT ORDER, not by date. Measured 2026-08-08:
//     1317 -> Aug 15    1324 -> Aug 8     1332 -> Oct 17
//     1320 -> Jul 18    1328 -> DWCS Aug 11
// DWCS and Road To UFC events consume ids without consuming weeks, so the drift grows
// without bound. This module resolves the id from the DATE instead.
//
// ⚠️ DATE IS PRIMARY, NAME IS CONFIRMATION ONLY. Measured across 40 events over nine
// months: no two UFC events share a date. Names cannot be trusted as the key because ESPN
// and CloudFront use different vocabularies — ESPN's "Dana White's Contender Series:
// Season 10, Week 1" is CloudFront's "DWCS 10.1". A name-first join silently loses every
// DWCS and Road To UFC card.

/**
 * Fold a display name to a comparable key.
 *
 * Strips diacritics (ESPN writes `Medić`, CloudFront writes `Medic`), folds `&` to `and`,
 * and reduces everything else to lowercase alphanumerics — which also collapses
 * `vs.` and `vs`.
 */
export function normaliseEventName(name) {
  return String(name ?? '')
    .normalize('NFKD')
    // Combining marks left behind by NFKD decomposition.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Events this far apart in time cannot be the same card. */
const MATCH_WINDOW_MS = 36 * 60 * 60 * 1000;

/**
 * Find the CloudFront candidate for an ESPN event.
 *
 * Matching is on the START TIME, not the date string.
 *
 * ⚠️ A bare YYYY-MM-DD comparison is WRONG, and live data proves it: DWCS 10.3 is
 * `2026-08-25T23:00Z` in ESPN and `2026-08-26T00:00Z` in CloudFront — one hour apart, but
 * straddling midnight UTC, so the date strings disagree and a date-string join drops the
 * event entirely. An exact date match is still tried first because it is the common case;
 * anything else falls back to the nearest start time inside a 36-hour window.
 *
 * @param target      { date: 'YYYY-MM-DD', startTime?, name }
 * @param candidates  [{ eventId, startTime, name }]
 */
export function matchEvent(target, candidates) {
  const date = target?.date;
  if (!date || !Array.isArray(candidates) || !candidates.length) return null;

  const pick = (list) => {
    if (list.length === 1) return list[0];
    // Only when a window genuinely holds more than one card does the name decide.
    const want = normaliseEventName(target.name);
    return list.find((c) => normaliseEventName(c.name) === want) ?? list[0];
  };

  const sameDay = candidates.filter(
    (c) => String(c?.startTime ?? '').slice(0, 10) === date,
  );
  if (sameDay.length) return pick(sameDay);

  // Nothing on the exact day — fall back to proximity, which survives the midnight straddle.
  const t = new Date(target.startTime ?? `${date}T12:00:00Z`).getTime();
  if (!Number.isFinite(t)) return null;

  const near = candidates
    .map((c) => ({ c, dt: Math.abs(new Date(c?.startTime ?? 0).getTime() - t) }))
    .filter((x) => Number.isFinite(x.dt) && x.dt <= MATCH_WINDOW_MS)
    .sort((a, b) => a.dt - b.dt);

  return near.length ? pick(near.map((x) => x.c)) : null;
}

/**
 * A UFC card runs about six hours from the first prelim to the final bell.
 *
 * Deliberately clock-based rather than reading ESPN's `state`/`completed`: the month
 * index is cached for an hour (TTL.MONTH_INDEX), so its status can lag the fight by
 * up to that long — which is exactly the window this needs to be right in.
 */
export const CARD_RUNTIME_MS = 6 * 60 * 60 * 1000;

/** How long a finished card stays selected before the next one takes over. */
export const RESULTS_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The event a viewer most likely wants.
 *
 * ⚠️ THIS IS NOT "the next event". It used to be, and that made the live and final
 * states unreachable: an event stopped being "upcoming" the instant its first prelim
 * began, so at 21:01 on a fight night the hub showed a card three days away. Measured
 * against the real August index 2026-08-08.
 *
 * A card now HOLDS the view from its start time until its results have been readable
 * for a day — but never past the next card's start, or the hub would sit on a stale
 * card while a new one is live.
 */
export function nearestEvent(index, now = new Date()) {
  const list = (index ?? [])
    .filter((e) => e?.date)
    .map((e) => ({ e, t: new Date(e.startTime ?? e.date).getTime() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  if (!list.length) return null;

  const t0 = now.getTime();

  // Hold windows cannot overlap, because each is capped at the next card's start.
  for (let i = 0; i < list.length; i += 1) {
    if (t0 < list[i].t) break;
    const nextStart = list[i + 1]?.t ?? Infinity;
    const holdUntil = Math.min(
      list[i].t + CARD_RUNTIME_MS + RESULTS_GRACE_MS,
      nextStart,
    );
    if (t0 < holdUntil) return list[i].e;
  }

  const upcoming = list.find((x) => x.t >= t0);
  return upcoming ? upcoming.e : list[list.length - 1].e;
}
