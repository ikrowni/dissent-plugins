// views/leaders.js — league leaders board.
//
// Fed by apis/site/v3 at limit=3 (see espn-client.js for why 3 and not more), so this is
// a top-3 board across every category ESPN publishes.
import { panel, stateMsg, esc, errorPane} from '../core/ui.js';
import { cache, TTL } from '../core/cache.js';
import { urls, fetchLeaders } from '../core/espn-client.js';
import { parseLeaders } from '../core/espn-league.js';
import { imageUrl } from '../../plugin-sdk.js';
import { logoPath } from '../core/config.js';

const state = { loading: true, error: null, cats: [] };

/** Categories a football fan looks for first. Everything else follows in ESPN's order. */
export const FEATURED = [
  'passingYards', 'rushingYards', 'receivingYards',
  'passingTouchdowns', 'sacks', 'interceptions',
];

function leaderRow(l, rank) {
  const shot = l.headshot
    ? `<img src="${esc(imageUrl(l.headshot))}" alt="" loading="lazy"`
      + ' style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex:0 0 auto">'
    : '';
  return `<button class="sb-row" data-act="player" data-player="${esc(l.athleteId)}"`
    + ' style="width:100%;background:none;border:0;color:inherit;font:inherit;'
    + 'cursor:pointer;text-align:left">'
    + `<span class="sb-meta" style="width:20px;text-align:left;margin-left:0">${rank}</span>`
    + shot
    + '<span style="font-family:var(--f-display);font-weight:700;font-size:14px">'
      + `${esc(l.name)}</span>`
    + (l.teamAbbr
      ? `<img src="${esc(logoPath(l.teamAbbr))}" alt="" style="width:16px;height:16px">`
      : '')
    + `<span class="sb-meta num">${esc(l.value)}</span>`
    + '</button>';
}

function categoryPanel(c) {
  return '<div class="mod">'
    + `<div class="mod-head"><span class="t">${esc(c.label)}</span></div>`
    + `<div class="mod-body">${c.leaders.map((l, i) => leaderRow(l, i + 1)).join('')}</div>`
    + '</div>';
}

export function renderLeaders(s = state) {
  if (s.loading) return stateMsg('Loading leaders…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load leaders.');
  if (!s.cats?.length) return stateMsg('League leaders are not available yet.');

  const rank = (c) => {
    const i = FEATURED.indexOf(c.key);
    return i === -1 ? FEATURED.length + 1 : i;
  };
  const ordered = [...s.cats].sort((a, b) => rank(a) - rank(b));

  return panel({
    title: 'League leaders',
    right: `<span class="kicker">${ordered.length} categories</span>`,
    body: '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">'
      + ordered.map(categoryPanel).join('')
      + '</div>',
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
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  } finally {
    state.loading = false;
  }
  app.router.refresh();
}
