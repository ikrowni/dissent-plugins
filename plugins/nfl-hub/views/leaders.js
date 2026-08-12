// views/leaders.js — league leaders board.
//
// Fed by apis/site/v3 at limit=3 (see espn-client.js for why 3 and not more), so this is
// a top-3 board across every category ESPN publishes.
import { panel, stateMsg, esc, errorPane} from '../core/ui.js';
import { avatar, positionColor, positionPill, teamMark } from '../core/player-visuals.js';
import { cache, TTL } from '../core/cache.js';
import { urls, fetchLeaders } from '../core/espn-client.js';
import { parseLeaders, leadersSeason} from '../core/espn-league.js';
import { logoPath } from '../core/config.js';

const state = { loading: true, error: null, cats: [], season: null };

/** Categories a football fan looks for first. Everything else follows in ESPN's order. */
export const FEATURED = [
  'passingYards', 'rushingYards', 'receivingYards',
  'passingTouchdowns', 'sacks', 'interceptions',
];

/**
 * Each leader's number as a share of the category leader's, 0-100 — or `null`
 * when the category cannot honestly be measured.
 *
 * ⚠️ NOTHING ELSE ON THIS BOARD ANSWERS "how big is the gap". Sixteen stacks of
 * three numbers leave a reader to do the arithmetic sixteen times, so a runaway
 * (46 · 34 · 31 passing touchdowns) and a dead heat (19 · 19 · 18 passes
 * defended) read exactly alike. This is the standings differential bar's rule —
 * the gap is the story — applied to a category.
 *
 * ⚠️ SCALED TO THE LARGEST NUMBER, not to the first row. ESPN ranks these, so the
 * two are normally the same value; trusting the order anyway is what produces a
 * bar wider than the rail it sits in the day the ordering changes.
 *
 * ⚠️ ALL OR NOTHING PER CATEGORY. One missing or negative number and the whole
 * category goes without bars, because a chart with a hole in it reads as "that
 * player scored zero" — a claim the payload never made.
 */
export function leaderBars(leaders) {
  // ⚠️ `Number(null)` IS ZERO, NOT NaN — and `parseLeaders` emits exactly
  // `amount: null` for a figure the payload did not carry. Reaching for
  // Number.isFinite alone let the one shape that actually occurs through as a
  // zero-width bar, which is the "he scored nothing" lie this guard exists to
  // stop. Missing is checked before it is converted.
  const amounts = (leaders ?? []).map((l) => (
    l?.amount === null || l?.amount === undefined || l.amount === '' ? NaN : Number(l.amount)
  ));
  if (!amounts.length) return null;
  if (amounts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const top = Math.max(...amounts);
  if (!(top > 0)) return null;
  return amounts.map((n) => Math.round((n / top) * 100));
}

/**
 * One leader.
 *
 * ⚠️ THE BAR IS TINTED BY POSITION, which is the point of tinting it at all. The
 * hub owns a categorical position scale and this board had none of it, so there
 * was no way to see that the third-best rusher for touchdowns is a QUARTERBACK
 * without reading his name and knowing who he is.
 *
 * ⚠️ NO GAP FIGURE IS PRINTED, deliberately. `value` is ESPN's own display string
 * and it is lossy — 16.5 sacks prints as "16" — so a deficit computed from the
 * real numbers would read "−6.5" beside a printed 23 and 16, and look like a bug.
 * The bar carries the comparison; the figures stay ESPN's.
 */
function leaderRow(l, rank, { bar = null, portrait = 0, hero = false } = {}) {
  const player = { n: l.name, p: l.position, t: l.teamAbbr, e: l.athleteId };
  return `<button class="ld-row${portrait ? '' : ' dense'}${hero ? ' ld-hero' : ''}"
      data-act="player" data-player="${esc(l.athleteId)}"
      style="--pc:${esc(positionColor(l.position))}">
    <span class="ld-rank">${rank}</span>
    ${portrait ? avatar(player, { size: portrait }) : ''}
    <span class="ld-id">
      <span class="ld-name">${esc(l.name)}</span>
      <span class="ld-meta">${positionPill(l.position)}${teamMark(l.teamAbbr)}</span>
    </span>
    <span class="ld-val">${esc(l.value)}</span>
    ${bar === null ? '' : `<span class="ld-bar"><i class="m-grow" style="width:${bar}%"></i></span>`}
  </button>`;
}

/**
 * One category.
 *
 * ⚠️ `featured` IS THE WHOLE HIERARCHY. Sixteen categories rendered identically
 * is no answer to "who is leading the league" — a fan looks for passing yards,
 * not punt yards, and the board gave both the same size, the same weight and the
 * same claim on the reading order. Portraits and the larger type go to the six a
 * fan looks for first; the rest keep every number in a denser tier below. Same
 * rule as the standings pass: everything consulted second is weighted like it.
 */
function categoryPanel(c, { featured = false } = {}) {
  const bars = leaderBars(c.leaders);
  const rows = c.leaders.map((l, i) => leaderRow(l, i + 1, {
    bar: bars ? bars[i] : null,
    portrait: featured ? (i === 0 ? 40 : 28) : 0,
    hero: featured && i === 0,
  })).join('');
  const top = c.leaders[0];
  // ⚠️ THE CARD'S ACCENT IS THE LEADER'S POSITION, so the top edge and the bars
  // below it carry the same encoding. `--cat` is separate from the per-row `--pc`
  // on purpose: a row must always win for its own bar, and sharing one name would
  // make that depend on cascade order.
  const cat = top ? ` style="--cat:${esc(positionColor(top.position))}"` : '';
  // ⚠️ SET DRESSING, NOT INFORMATION. The club is already named in the leader's
  // row; at 6% this is the surface behind him. Featured only — in the dense tier
  // it would compete with the numbers for the same pixels.
  // ⚠️ IT REMOVES ITSELF IF IT 404s. A broken <img> renders the browser's torn-page
  // icon, and at 6% opacity in a card corner that is a grey smudge nobody can
  // explain. `avatar()` has carried the same one-liner since it shipped, for the
  // same reason. An abbreviation with no asset — a relocated club, a new code —
  // must cost the card its dressing, not put a defect on it.
  const wm = featured && top?.teamAbbr
    ? `<img class="pod-wm" src="${esc(logoPath(top.teamAbbr))}" alt="" loading="lazy"`
      + ' onerror="this.remove()">'
    : '';
  return `<div class="mod ld-cat${featured ? ' ld-feat pod-card' : ''}"${cat}>`
    + (featured ? '<span class="m-sheen"></span>' : '')
    + wm
    + `<div class="mod-head"><span class="t">${esc(c.label)}</span></div>`
    + `<div class="mod-body ld-body">${rows}</div>`
    + '</div>';
}


/**
 * "2025 regular season · final · " when the numbers are not from the current
 * season, and nothing at all when they are — a live race needs no disclaimer.
 */
export function seasonLabel(season) {
  if (!season?.year) return '';
  const name = String(season.name ?? '').toLowerCase();
  if (season.isCurrent) return `${season.year} · `;
  return `${season.year} ${name || 'season'} · final · `;
}

export function renderLeaders(s = state) {
  if (s.loading) return stateMsg('Loading leaders…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load leaders.');
  if (!s.cats?.length) return stateMsg('League leaders are not available yet.');

  // ⚠️ TWO TIERS, NOT ONE SORTED LIST. Ordering the featured six first was
  // already true and changed nothing a reader could see: sixteen identical
  // modules in a flat grid reflow into whatever the width allows, so "first" is
  // not a position anybody perceives. The difference has to be in the weight.
  const featured = FEATURED
    .map((key) => s.cats.find((c) => c.key === key))
    .filter(Boolean);
  const rest = s.cats.filter((c) => !FEATURED.includes(c.key));

  return panel({
    title: 'League leaders',
    // ⚠️ THE SEASON IS PART OF THE HEADLINE, not a footnote. Between February and
    // September this endpoint answers with LAST season's finals (measured
    // 2026-08-11: current 2026 Preseason, requested 2025 Regular Season), and
    // without the year a reader cannot tell those totals from a live race.
    right: `<span class="kicker">${seasonLabel(s.season)}${s.cats.length} categories</span>`,
    // ⚠️ THE STAGE HOLDS THE FEATURED SIX AND NOTHING ELSE. Lighting all sixteen
    // would light nothing — the surface is the hierarchy, the same way the draft
    // board's stage is what separates the board from the panels around it.
    body: `<div class="pod-stage">
      <div class="pod-head"><h3>Leading the league</h3>
        <span class="pod-sub">Top 3</span></div>
      <div class="ld-grid m-stagger">${
  featured.map((c) => categoryPanel(c, { featured: true })).join('')}</div>
    </div>`
      + (rest.length
        ? `<div class="kicker ld-more-h">More categories</div>
           <div class="ld-grid ld-grid-more m-stagger">${
  rest.map((c) => categoryPanel(c)).join('')}</div>`
        : ''),
  });
}

export function render() { return renderLeaders(state); }

export async function enter() {
  const { app } = await import('../core/app.js');
  app.onAction = (act, el) => {
    if (act === 'player') { app.athleteId = el.dataset.player; app.router.go('player'); }
    if (act === 'team') { app.teamAbbr = el.dataset.team; app.router.go('team'); }
  };
  if (!state.loading && state.cats.length) return;
  try {
    const raw = await cache.get(urls.leaders(), () => fetchLeaders(), TTL.LEADERS,
      { staleOnError: true });
    state.cats = parseLeaders(raw);
    state.season = leadersSeason(raw);
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  } finally {
    state.loading = false;
  }
  app.router.refresh();
}
