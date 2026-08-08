// core/ufc-event-page.js — a ufc.com event page -> its artwork.
//
// ⚠️ FILENAMES CANNOT BE DERIVED. August's art is
// `080826-ufc-fight-night-gamrot-vs-salkilld-EVENT-ART.jpg`; July's is the same shape
// plus `-TEMPORARY-EVENT-ART-NOT-FINAL`. The old `ufc-fights` plugin guessed filenames
// and probed them, which is why its hero was blank for months. Read the URLs the page
// already contains.
//
// ⚠️ SIZE. The node's image proxy caps at 2 MB with a plain LimitReader, so an oversize
// image comes back as HTTP 200 with a TRUNCATED, UNDECODABLE body — reproduced against
// the raw CloudFront original (991x3324, 4.7 MB). Measured derivatives:
//     background_image_sm      768x512     49 KB
//     background_image_lg     1200x800    124 KB   <- what we take
//     background_image_xl     2000x1333   301 KB
//     background_image_xl_2x  4000x2666   919 KB   (fine, but pointless in a card)
//     raw CloudFront original  991x3324   4.7 MB   TRUNCATES
//
// ⚠️ THERE IS ONE PIECE OF ART PER EVENT and it depicts the HEADLINER. It is correct on
// the main event and wrong on every other bout. `views/versus.js` uses it only there.

function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

const RENDER_STYLE = 'event_fight_card_upper_body_of_standing_athlete';

export function parseEventPage(htmlText) {
  const s = String(htmlText ?? '');

  // Take the lg derivative specifically; `_2x` and the original are handled above.
  const art = /https?:\/\/[^"'\s]*\/styles\/background_image_lg\/s3\/[^"'\s?]*EVENT-ART[^"'\s?]*\.jpg/i
    .exec(s);

  const renders = {};
  const re = new RegExp(
    `https?://[^"'\\s]*/styles/${RENDER_STYLE}/s3/[^"'\\s?]*?/([A-Z_]+)_([LR])_[0-9-]+\\.png`, 'g');
  let m;
  while ((m = re.exec(s)) !== null) {
    renders[norm(m[1])] = { url: m[0], side: m[2] };
  }

  return {
    art: art ? art[0] : null,
    renders,
  };
}

/**
 * Look up one fighter's render.
 *
 * ⚠️ Both names are required. The measured card carries BOTH Ty Miller and Juliana
 * Miller; a last-name lookup hands two different people the same picture. An ambiguous
 * match returns null so the caller falls back rather than showing the wrong person.
 */
export function renderFor(page, firstName, lastName) {
  const last = norm(lastName);
  const first = norm(firstName);
  if (!last || !first) return null;
  const hits = Object.entries(page?.renders ?? {})
    .filter(([k]) => k.includes(last) && k.includes(first));
  return hits.length === 1 ? hits[0][1].url : null;
}
