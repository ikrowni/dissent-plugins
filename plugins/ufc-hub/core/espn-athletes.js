// core/espn-athletes.js — ESPN athlete ids and country flags, for a CloudFront card.
//
// CloudFront carries records, physicals and results but NO images and no country flag.
// ESPN's month index — which the hub already fetches for the event index, so this costs
// zero additional requests — carries an athlete id and a flag href for every competitor.
// This module is the join between them.
//
// Measured on the 2026-08-08 card: first + last name matches 24 of 24 exactly.
//
// ⚠️ THE LAST NAME ALONE IS NOT A KEY. That same card carries BOTH Ty Miller and
// Juliana Miller, so a last-name join silently gives two different fighters the same
// headshot. The first name is required, not a tiebreaker.
//
// ⚠️ Names are folded before comparison because ESPN writes `Medić` where CloudFront
// writes `Medic` — the same divergence core/event-index.js documents for event names.
//
// Unrelated: ufc.com's IMAGE FILENAMES use different first names again (GOFF_BILLY for
// "Billy Ray Goff", ASPLUND_STEVE for "Steven Asplund"). That affects only the deferred
// ufc.com artwork work, not this join.

/** Fold a name for comparison: strip diacritics, keep letters only. */
function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/** Every competitor on one ESPN event, flattened out of the month index. */
export function athletesForEvent(monthJson, espnEventId) {
  const ev = (monthJson?.events ?? []).find((e) => String(e?.id) === String(espnEventId));
  if (!ev) return [];
  const out = [];
  for (const comp of ev.competitions ?? []) {
    for (const c of comp.competitors ?? []) {
      const a = c?.athlete ?? {};
      out.push({
        espnId: String(c?.id ?? ''),
        name: a.displayName ?? a.fullName ?? '',
        flag: a.flag?.href ?? null,
        country: a.flag?.alt ?? null,
      });
    }
  }
  return out.filter((a) => a.espnId);
}

/**
 * ESPN headshots are 600x436 transparent-background PNGs. Present for 24 of 24 fighters
 * on the measured card. Must be rendered through `Dissent.imageUrl()` — the plugin CSP
 * is `img-src data: blob: {asset} {core}` and forbids a direct third-party load.
 */
export function headshotUrl(espnId) {
  const id = String(espnId ?? '').trim();
  return id ? `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png` : null;
}

/**
 * Map CloudFront fighterId -> { espnId, flag, country }.
 *
 * Last name AND first name, both required — see the header for why the last name alone
 * is not a key. A fighter with no unambiguous match is left out entirely rather than
 * guessed at: a missing headshot degrades to an empty mug, a wrong one shows the reader
 * the wrong person.
 */
export function joinAthletes(fights, athletes) {
  const out = new Map();
  const pool = (athletes ?? []).map((a) => ({ a, key: norm(a.name) }));
  if (!pool.length) return out;

  for (const fight of fights ?? []) {
    for (const f of fight?.fighters ?? []) {
      if (f?.fighterId == null) continue;
      const last = norm(f.lastName);
      const first = norm(f.firstName);
      if (!last || !first) continue;

      const hits = pool.filter((p) => p.key.includes(last) && p.key.includes(first));
      if (hits.length !== 1) continue;

      const { a } = hits[0];
      out.set(f.fighterId, { espnId: a.espnId, flag: a.flag, country: a.country });
    }
  }
  return out;
}
