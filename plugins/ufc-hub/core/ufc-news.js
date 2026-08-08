// core/ufc-news.js — ESPN's MMA news feed.
//
// Costs no new permission: it is `site.api.espn.com`, already granted for the event
// index. 20 articles is ~82 KB, well under the 1 MB fetch cap.
//
// ⚠️ THIS IS MMA NEWS, NOT UFC NEWS, despite the endpoint path. Measured 2026-08-08: of
// 20 articles the top one was about the PFL, and `categories` carries
// "Professional Fighters League" alongside "UFC". The view says "MMA" for that reason —
// do not relabel it "UFC news", it would be untrue.
//
// ⚠️ Articles carry ESPN **athleteId**s in their categories, which is the same id
// core/espn-athletes.js already joins onto CloudFront fighters. That makes "news about
// someone on this card" an id match rather than a name match. It is also USUALLY EMPTY:
// across the whole of August 2026, only two cards had any match at all —
//     Aug 1  Medic vs Rodriguez     1 of 28 fighters (Jan Blachowicz)
//     Aug 15 UFC 330                2 of 22 (Islam Makhachev, Mackenzie Dern)
//     every other card, including a full Fight Night and all three DWCS     0
// so an empty card-news section is the NORMAL case, not a failure. The view must say so
// rather than rendering a blank.

const clean = (s) => String(s ?? '').trim();

/** Prefer the readable web link; some article types only carry a mobile one. */
function linkOf(a) {
  const l = a?.links ?? {};
  return clean(l.web?.href) || clean(l.mobile?.href) || null;
}

/**
 * The image to show.
 *
 * ESPN offers several crops of the same photo; they are all 16:9 here. Take the first
 * with a usable url rather than the largest — the biggest measured is 1296x729, which is
 * far more than a 96px thumbnail needs and still has to cross the image proxy.
 */
function imageOf(a) {
  for (const img of a?.images ?? []) {
    const u = clean(img?.url);
    if (u) return u;
  }
  return null;
}

export function parseNews(json) {
  const arts = json?.articles;
  if (!Array.isArray(arts)) return [];
  return arts.map((a) => ({
    id: String(a?.id ?? ''),
    headline: clean(a?.headline),
    description: clean(a?.description),
    published: clean(a?.published) || null,
    image: imageOf(a),
    link: linkOf(a),
    // ESPN+ articles exist in this feed. Sending someone to a paywall unannounced is
    // rude, so the flag is carried through and the view badges it.
    premium: a?.premium === true,
    type: clean(a?.type) || null,
    athleteIds: (a?.categories ?? [])
      .filter((c) => c?.type === 'athlete' && c?.athleteId != null)
      .map((c) => Number(c.athleteId))
      .filter((n) => Number.isFinite(n)),
  })).filter((a) => a.headline);
}

/**
 * Articles mentioning any of these ESPN athlete ids.
 *
 * @param articles  parseNews output
 * @param ids       iterable of ESPN athlete ids (espn-athletes.js gives them as strings)
 */
export function relevantTo(articles, ids) {
  const want = new Set([...(ids ?? [])].map(Number).filter((n) => Number.isFinite(n)));
  if (!want.size) return [];
  return (articles ?? []).filter((a) => a.athleteIds.some((n) => want.has(n)));
}

/**
 * espnId -> display name, for everyone on the card.
 *
 * The view needs this to SAY WHO an article matched. Without it the section claims a
 * relationship the reader cannot check — and the match is often loose: a
 * pound-for-pound rankings round-up carries a dozen athlete categories, so it matches a
 * card while being about nobody on it in particular.
 */
export function cardAthleteNames(fights, athletes) {
  const out = {};
  for (const f of fights ?? []) {
    for (const x of f?.fighters ?? []) {
      const id = athletes?.get?.(x?.fighterId)?.espnId;
      if (id) out[Number(id)] = x.lastName || x.name;
    }
  }
  return out;
}

/** ESPN athlete ids for everyone on the card, from the espn-athletes join. */
export function cardAthleteIds(athletes) {
  return [...(athletes?.values?.() ?? [])]
    // ⚠️ Filter BEFORE Number(): `Number(null)` and `Number('')` are both 0, which is
    // finite, so an unmatched fighter would emit athlete id 0 and could match an
    // article that carries one.
    .map((v) => v?.espnId)
    .filter((v) => v != null && v !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** "2h ago" / "3d ago" — a feed reads better relative than absolute. */
export function relativeTime(iso, now = new Date()) {
  // ⚠️ `new Date(null)` is the epoch, not Invalid Date, so a null timestamp would
  // render as "1/1/1970" instead of nothing.
  if (iso == null || iso === '') return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((now.getTime() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 30 ? `${days}d ago` : new Date(t).toLocaleDateString();
}
