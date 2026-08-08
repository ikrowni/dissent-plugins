// core/schedule.js — month navigation for the schedule pager.
//
// ⚠️ ONE MONTH AT A TIME, ALWAYS. `?dates=YYYY` is 2,035,461 bytes — over the 1 MB
// fetch:external cap — and fails silently through the proxy. core/ufc-espn.js documents
// the measurements; this module exists so a pager can walk months without anyone being
// tempted to fetch a year.
//
// Pure: no fetching, no DOM. The app calls shiftMonth to decide what to load next.

/** `YYYYMM` -> { year, month } with month 1-12. */
function parseKey(key) {
  const s = String(key ?? '');
  const m = /^(\d{4})(\d{2})$/.exec(s);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Move a month key by `delta` months, rolling the year over in both directions.
 *
 * ⚠️ Do NOT do this with `new Date(y, m + delta)` and read the month back: for a key
 * built from a day-31 date that lands in a 30-day month, Date rolls forward into the
 * next month and the pager skips one.
 */
export function shiftMonth(key, delta) {
  const p = parseKey(key);
  if (!p) return null;
  const zero = (p.year * 12) + (p.month - 1) + Number(delta ?? 0);
  const year = Math.floor(zero / 12);
  const month = (zero % 12) + 1;
  return `${year}${pad(month)}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** `202608` -> `August 2026`. */
export function monthLabel(key) {
  const p = parseKey(key);
  return p ? `${MONTHS[p.month - 1]} ${p.year}` : '';
}

/** The month key an event belongs to, from its own start time. */
export function monthOf(startTime) {
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;
}

/**
 * A card runs about six hours. Shared with core/event-index.js's lifecycle so the pager
 * and the selector cannot disagree about whether a card is over.
 */
const CARD_RUNTIME_MS = 6 * 60 * 60 * 1000;

/**
 * 'past' | 'live' | 'upcoming' for a schedule row.
 *
 * Deliberately clock-based rather than reading ESPN's `state`/`completed`: the month
 * index is cached for an hour, so its status lags the fight by up to that long — which
 * is exactly the window a viewer is most likely to be looking.
 */
export function eventPhase(event, now = new Date()) {
  const t = new Date(event?.startTime ?? event?.date).getTime();
  if (!Number.isFinite(t)) return 'upcoming';
  const t0 = now.getTime();
  if (t0 < t) return 'upcoming';
  if (t0 < t + CARD_RUNTIME_MS) return 'live';
  return 'past';
}

/** Chronological, so a month reads top-to-bottom the way it happened. */
export function sortByDate(events) {
  return [...(events ?? [])].sort(
    (a, b) => new Date(a.startTime ?? a.date) - new Date(b.startTime ?? b.date),
  );
}
