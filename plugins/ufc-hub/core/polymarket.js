// core/polymarket.js — implied win probability, and the method/round markets, for a card.
//
// ⚠️ THE QUERY IS BOUNDED BY DATE, AND THAT IS NOT A DETAIL. Measured 2026-08-08 against
// the live gamma API:
//     ?tag_slug=ufc&active=true&limit=200                  2,493,954 B   OVER the 1 MB cap
//     ?tag_slug=ufc&active=true&closed=false&limit=40      2,540,381 B   OVER
//     ?tag_slug=ufc&active=true&closed=false&limit=10        869,632 B   under, barely
//     end_date_min/max spanning the card's day                462,681 B   under, and COMPLETE
// The old `ufc-fights` plugin used the `limit=200` form. Through `fetch:external` that
// arrives truncated at exactly 1,048,576 bytes and fails to parse — the same shape of
// silent failure as `?dates=YYYY` in core/ufc-espn.js.
//
// A `limit` does not bound the payload because each event embeds up to 40 markets at
// ~4 KB each; only the date window does.
//
// ⚠️ SLUGS ARE NOT DERIVABLE. The Gamrot fight is `ufc-mat10-qui2-2026-08-08` — the
// numbers are internal ids, not anything we hold. Never try to build one; match on the
// fighter NAMES in the event title.

const GAMMA = 'https://gamma-api.polymarket.com/events';

/** JSON-encoded string arrays arrive as strings, e.g. '["Yes", "No"]'. */
function arr(v) {
  if (Array.isArray(v)) return v;
  try {
    const p = JSON.parse(String(v ?? '[]'));
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The window that captures one card.
 *
 * An event's `startDate` is when the MARKET opened (the Gamrot market opened 13 days
 * before the fight), so it cannot select a card. `endDate` is the fight's own day —
 * `2026-08-09T03:59:59Z` for an Aug 8 card, i.e. local midnight — so the window has to
 * run from the morning of the card to a day after it.
 */
export function cardWindow(startTime) {
  const t = new Date(startTime);
  if (Number.isNaN(t.getTime())) return null;
  const from = new Date(t.getTime() - 12 * 3600 * 1000);
  const to = new Date(t.getTime() + 36 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function cardUrl(startTime) {
  const w = cardWindow(startTime);
  if (!w) return null;
  return `${GAMMA}?tag_slug=ufc&closed=false&limit=30`
    + `&end_date_min=${encodeURIComponent(w.from)}`
    + `&end_date_max=${encodeURIComponent(w.to)}`;
}

/** Strip diacritics and non-letters, so "José" matches "Jose". */
function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

const MONEYLINE = 'moneyline';

/** Classify a market by its question. Everything we cannot place is dropped. */
export function classify(question, title) {
  const q = String(question ?? '');
  if (q && q === title) return { kind: MONEYLINE };
  if (/go the distance/i.test(q)) return { kind: 'distance' };
  if (/^will (.+) win by KO or TKO/i.test(q)) {
    return { kind: 'fighterKo', who: /^will (.+) win by KO or TKO/i.exec(q)[1] };
  }
  if (/won by KO or TKO/i.test(q)) return { kind: 'ko' };
  if (/won by submission/i.test(q)) return { kind: 'sub' };
  if (/won by decision/i.test(q)) return { kind: 'dec' };
  const ou = /O\/U\s*([\d.]+)\s*Rounds?/i.exec(q);
  if (ou) return { kind: 'rounds', line: Number(ou[1]) };
  return { kind: null };
}

/**
 * One Polymarket event -> the shape a view wants.
 *
 * `outcomePrices` is the mid price and is already a probability in [0,1]; it is NOT a
 * decimal odd and must not be inverted.
 */
export function parseFightMarket(event) {
  if (!event) return null;
  const title = event.title ?? '';
  const out = {
    slug: event.slug ?? null,
    title,
    names: [],
    prob: {},        // fighter name -> implied probability
    distance: null,  // P(goes to decision)
    ko: null,
    sub: null,
    rounds: [],      // [{ line, over }]
    volume: num(event.volume),
  };

  for (const m of event.markets ?? []) {
    if (m?.closed === true) continue;
    const c = classify(m?.question, title);
    const outcomes = arr(m?.outcomes);
    const prices = arr(m?.outcomePrices).map(num);
    if (!prices.length) continue;

    if (c.kind === MONEYLINE && outcomes.length === 2) {
      out.names = outcomes.slice();
      out.prob[outcomes[0]] = prices[0];
      out.prob[outcomes[1]] = prices[1];
    } else if (c.kind === 'distance') out.distance = prices[0];
    else if (c.kind === 'ko') out.ko = prices[0];
    else if (c.kind === 'sub') out.sub = prices[0];
    else if (c.kind === 'rounds') out.rounds.push({ line: c.line, over: prices[0] });
  }
  out.rounds.sort((a, b) => a.line - b.line);
  return out.names.length ? out : null;
}

/**
 * Match parsed markets onto the card's fights, by BOTH fighters' names.
 *
 * ⚠️ Both names, never one. The 2026-08-08 window returns a market for
 * "Henrique da Silva Lopes vs. Louie Sutherland" — a bout that is NOT on the card,
 * while Sutherland IS (against José Montanha). Matching on a single name attaches the
 * wrong odds to a real fight.
 */
export function joinMarkets(fights, events) {
  const parsed = (events ?? []).map(parseFightMarket).filter(Boolean);
  const out = new Map();

  for (const fight of fights ?? []) {
    const red = fight?.red;
    const blue = fight?.blue;
    if (!red || !blue) continue;
    const want = [red, blue].map((f) => ({
      last: norm(f.lastName), first: norm(f.firstName),
    }));

    const hit = parsed.find((p) => {
      const keys = p.names.map(norm);
      return want.every((w) => w.last && keys.some(
        (k) => k.includes(w.last) && (!w.first || k.includes(w.first)),
      ));
    });
    if (!hit) continue;

    // Map the market's own outcome labels back to our fighter ids.
    const byId = {};
    for (const f of [red, blue]) {
      const label = hit.names.find(
        (n) => norm(n).includes(norm(f.lastName)) && norm(n).includes(norm(f.firstName)),
      );
      if (label != null) byId[f.fighterId] = hit.prob[label] ?? null;
    }
    out.set(fight.fightId, { ...hit, byFighter: byId });
  }
  return out;
}

/** A probability as a whole-number percentage, or null. */
export function pct(p) {
  return p == null || !Number.isFinite(p) ? null : Math.round(p * 100);
}

/**
 * American odds from an implied probability, which is what a viewer recognises.
 * 0.445 -> +125, 0.555 -> -125.
 */
export function american(p) {
  if (p == null || !Number.isFinite(p) || p <= 0 || p >= 1) return null;
  return p >= 0.5
    ? `-${Math.round((p / (1 - p)) * 100)}`
    : `+${Math.round(((1 - p) / p) * 100)}`;
}
