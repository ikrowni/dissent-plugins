// core/ufc-links.js — ufc.com URLs, normalised.
//
// ⚠️ THE HOST IS LOAD-BEARING. `hostAllowed` in the node's fetch proxy is an EXACT,
// case-insensitive match and is applied to EVERY redirect hop. `www.ufc.com` is the
// granted host; `ufc.com` is a different host and is NOT granted. Always emit www.
//
// ⚠️ The proxy allows THREE hops. CloudFront's UFCLink is `http://` with a capitalised
// slug, which burns two of them (http->https, capitalised->lowercase) before the page
// is even reached. Normalising costs nothing and leaves the budget for ufc.com's own
// redirects.

const HOST = 'https://www.ufc.com';

/** CloudFront `UFCLink` -> a fetchable athlete URL, or null. */
export function athleteUrl(ufcLink) {
  const m = /^https?:\/\/(?:www\.)?ufc\.com\/athlete\/([^/?#]+)/i.exec(String(ufcLink ?? ''));
  return m ? `${HOST}/athlete/${m[1].toLowerCase()}` : null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * The event page's slug.
 *
 * Two shapes, and the numbered one wins when both could apply:
 *   UFC 330                     -> ufc-330
 *   UFC Fight Night, 8 Aug 2026 -> ufc-fight-night-august-08-2026
 *
 * ⚠️ DWCS and Road To UFC cards follow neither and return null. They must degrade to
 * the composed hero rather than fetching a URL that does not exist.
 */
export function eventPageSlug(name, startTime) {
  const numbered = /UFC\s+(\d{2,4})\b/i.exec(String(name ?? ''));
  if (numbered) return `ufc-${numbered[1]}`;

  if (!/fight\s*night/i.test(String(name ?? ''))) return null;
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return null;
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `ufc-fight-night-${MONTHS[d.getUTCMonth()]}-${day}-${d.getUTCFullYear()}`;
}

export function eventPageUrl(name, startTime) {
  const slug = eventPageSlug(name, startTime);
  return slug ? `${HOST}/event/${slug}` : null;
}
