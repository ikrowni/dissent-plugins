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

/**
 * Find the CloudFront candidate for an ESPN event.
 *
 * @param target      { date: 'YYYY-MM-DD', name }
 * @param candidates  [{ eventId, startTime, name }]
 */
export function matchEvent(target, candidates) {
  const date = target?.date;
  if (!date || !Array.isArray(candidates) || !candidates.length) return null;

  const sameDay = candidates.filter(
    (c) => String(c?.startTime ?? '').slice(0, 10) === date,
  );
  if (!sameDay.length) return null;
  // The measured common case: a date identifies an event outright, whatever it is called.
  if (sameDay.length === 1) return sameDay[0];

  // Only when a day genuinely holds more than one card does the name decide.
  const want = normaliseEventName(target.name);
  return sameDay.find((c) => normaliseEventName(c.name) === want) ?? sameDay[0];
}

/** The event a viewer most likely wants: the next upcoming one, else the most recent. */
export function nearestEvent(index, now = new Date()) {
  const list = (index ?? []).filter((e) => e?.date);
  if (!list.length) return null;
  const t = now.getTime();
  const upcoming = list
    .filter((e) => new Date(e.startTime ?? e.date).getTime() >= t)
    .sort((a, b) => new Date(a.startTime ?? a.date) - new Date(b.startTime ?? b.date));
  if (upcoming.length) return upcoming[0];
  return list
    .slice()
    .sort((a, b) => new Date(b.startTime ?? b.date) - new Date(a.startTime ?? a.date))[0];
}
