// core/ufc-athlete.js — a ufc.com athlete page -> career statistics.
//
// ⚠️ THESE ARE CAREER STATISTICS FOR A FIGHTER, AND THAT DISTINCTION IS THE WHOLE
// POINT. No source gives PER-FIGHT strike data, so the counts derived from
// FightNightTracking in core/fight-timeline.js remain "tracked actions" and the guard
// in views/versus.test.js stays exactly as it is. A fighter's page may say
// "significant strikes"; a fight's page may not.
//
// This corrects a long-standing project claim. "No strike data exists in any source we
// can reach" is true of ufcstats.com (JS proof-of-work bot wall) and of ESPN (athlete
// endpoints answer 403/404, measured 2026-08-08). It is NOT true of ufc.com.
//
// This is HTML scraping, so it is expected to break when ufc.com restyles. Every
// extractor below returns null rather than throwing, and views must render without it.

const clean = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const one = (re, s) => {
  const m = re.exec(s);
  return m ? clean(m[1]) : null;
};

/** Strip wrapping quotes, straight or curly, after entities have been decoded. */
const unquote = (s) => (s == null ? null : s.replace(/^["'“‘]+|["'”’]+$/g, '').trim());

/** `c-stat-3bar` legends: Standing / Clinch / Ground, and KO/TKO / DEC / SUB. */
function bars(s) {
  const out = [];
  const re = /c-stat-3bar__label">\s*([^<]+?)\s*<\/div>\s*<div class="c-stat-3bar__value">\s*([^<]+?)\s*</g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ label: clean(m[1]), value: clean(m[2]) });
  return out;
}

export function parseAthlete(htmlText) {
  const s = String(htmlText ?? '');
  const out = {
    name: one(/<h1 class="hero-profile__name">\s*([^<]+?)\s*</, s),
    // ⚠️ The quotes are `&quot;` in the markup, so they only become `"` AFTER clean()
    // decodes entities. Stripping them in the regex silently leaves them in place.
    nickname: unquote(one(/<p class="hero-profile__nickname">\s*([^<]+?)\s*</, s)),
    record: null,
    stats: {},
    accuracy: { striking: null, takedown: null },
    position: [],
    finishes: [],
  };

  const rec = one(/hero-profile__division-body">\s*([^<]+?)\s*</, s);
  // The page writes "26-4-0 (W-L-D)"; the parenthetical is a legend, not data.
  if (rec) out.record = clean(rec.replace(/\(.*\)/, ''));

  // Pair within the group rather than zipping two flat arrays. On both measured pages
  // the flat arrays happen to align, so this is defensive rather than a fix for an
  // observed bug — but a group is what the markup actually means, and a page with one
  // more number than label would silently shift every stat by one.
  //
  // ⚠️ THE PERCENT DIV IS NESTED INSIDE THE NUMBER DIV, not a sibling of it:
  //     <div class="__number">60 <div class="__percent">%</div></div>
  //     <div class="__label">Sig. Str. Defense</div>
  // A `([^<]*?)\s*</div>` match therefore cannot reach the closing tag and DROPS both
  // percentage stats — Sig. Str. Defense and Takedown Defense — leaving 6 of 8. The
  // optional group below is what admits them.
  const group = /c-stat-compare__group[^"]*"[^>]*>\s*<div class="c-stat-compare__number">\s*([^<]*?)\s*(<div class="c-stat-compare__percent">%<\/div>)?\s*<\/div>\s*<div class="c-stat-compare__label">\s*([^<]*?)\s*<\/div>/g;
  let m;
  while ((m = group.exec(s)) !== null) {
    const label = clean(m[3]);
    // The percent sign lives in that nested div, so a stat whose group carried one is
    // a percentage and renders as "60%", not a bare "60".
    const value = clean(m[1]) + (m[2] ? '%' : '');
    if (label && clean(m[1])) out.stats[label] = value;
  }

  // The accuracy donuts carry their value in the SVG <title>, which is far more stable
  // than the surrounding chart markup.
  const donut = /<title>\s*([A-Za-z. ]*?accuracy)\s*(\d+)%\s*<\/title>/gi;
  while ((m = donut.exec(s)) !== null) {
    const key = /takedown/i.test(m[1]) ? 'takedown' : 'striking';
    out.accuracy[key] = Number(m[2]);
  }

  const all = bars(s);
  const isFinish = (b) => /^(KO\/TKO|DEC|SUB)$/i.test(b.label);
  out.finishes = all.filter(isFinish);
  out.position = all.filter((b) => !isFinish(b));

  return out;
}

/** Did we get enough to be worth rendering? */
export function hasAthleteStats(a) {
  return Boolean(a && (Object.keys(a.stats ?? {}).length || a.accuracy?.striking != null));
}
