// views/league.js — Around the League: the landing surface.
//
// Pure render plus enter/leave. Data arrives via a module-level state object that
// enter() populates through the shared cache; render() never fetches.
import { chip, panel, badge, stateMsg, esc, errorPane} from '../core/ui.js';
import { fmtClock, ordinalDown } from '../core/format.js';
import { cache, TTL } from '../core/cache.js';
import { fetchScoreboard, urls } from '../core/espn-client.js';
import { parseScoreboard } from '../core/espn-game.js';
import { renderHero } from './game-scorebug.js';

const state = {
  loading: true, error: null, games: [], week: null, season: null, heroId: null,
};

/** Live-first hero priority: red zone → closest live → next scheduled → anything. */
export function pickHeroGame(games) {
  const list = games ?? [];
  if (!list.length) return null;

  const live = list.filter((g) => g.state === 'in');
  if (live.length) {
    const rz = live.filter((g) => g.redZone);
    const pool = rz.length ? rz : live;
    return pool.reduce((best, g) => {
      const margin = Math.abs((g.home?.score ?? 0) - (g.away?.score ?? 0));
      const bestMargin = Math.abs((best.home?.score ?? 0) - (best.away?.score ?? 0));
      return margin < bestMargin ? g : best;
    });
  }

  const upcoming = list
    .filter((g) => g.state === 'pre')
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  return upcoming[0] ?? list[0];
}

/** '' before kickoff — dimming a 0-0 game would imply someone is losing. */
function scoreCls(side, other, gameState) {
  if (gameState === 'pre') return '';
  return (side?.score ?? 0) >= (other?.score ?? 0) ? 'lead' : 'trail';
}

function statusText(g) {
  if (g.state === 'in') return fmtClock(g.period, g.clock);
  if (g.state === 'post') return 'Final';
  try {
    return new Date(g.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function gameRow(g) {
  const live = g.state === 'in';
  // No sparkline here: a trend needs per-game win-probability history, which is one
  // extra fetch per card and would blow the proxy budget on a 16-game slate. The trend
  // lives in Game Center, where exactly one game is open.
  return `<button class="game-card${live ? ' live' : ''}" data-act="game" data-game="${esc(g.id)}">`
    + '<div class="sb-row">'
      + chip(g.away, { showRecord: false })
      + `<span class="sc num ${scoreCls(g.away, g.home, g.state)}">${esc(g.away?.score ?? '')}</span>`
      + `<span class="sb-meta">${esc(statusText(g))}</span>`
    + '</div>'
    + '<div class="sb-row">'
      + chip(g.home, { showRecord: false })
      + `<span class="sc num ${scoreCls(g.home, g.away, g.state)}">${esc(g.home?.score ?? '')}</span>`
      + `<span class="sb-meta">${esc(live && g.down ? ordinalDown(g.down, g.distance) : '')}</span>`
    + '</div>'
    + `<div style="display:flex;gap:6px;margin-top:6px">${badge(g.state)}`
      + (g.redZone ? '<span class="badge redzone">Red zone</span>' : '')
    + '</div>'
    + '</button>';
}

function groupByTimeslot(games) {
  const out = new Map();
  for (const g of games) {
    const k = g.timeslot ?? 'Other';
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(g);
  }
  return out;
}

export function renderLeague(s = state) {
  if (s.loading) return stateMsg('Loading scoreboard…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load the scoreboard.');
  if (!s.games?.length) return stateMsg('No games scheduled for this week.');

  const hero = s.games.find((g) => g.id === s.heroId) ?? pickHeroGame(s.games);
  const groups = groupByTimeslot(s.games);

  let html = hero ? renderHero(hero, { siblings: s.games }) : '';
  for (const [slot, list] of groups) {
    html += panel({
      title: slot,
      right: `<span class="kicker">${list.length} game${list.length === 1 ? '' : 's'}</span>`,
      flush: true,
      body: `<div class="game-grid">${list.map(gameRow).join('')}</div>`,
    });
  }
  return html;
}

export function render() { return renderLeague(state); }

async function load({ force = false } = {}) {
  const anyLive = state.games.some((g) => g.state === 'in');
  const ttl = anyLive ? TTL.SCOREBOARD_LIVE : TTL.SCOREBOARD_IDLE;
  const key = urls.scoreboard({});
  if (force) cache.invalidate(key);
  try {
    const raw = await cache.get(key, () => fetchScoreboard({}), ttl, { staleOnError: true });
    const parsed = parseScoreboard(raw);
    state.games = parsed.games;
    state.week = parsed.week;
    state.season = parsed.season;
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  } finally {
    state.loading = false;
  }
}

let unregister = null;

export async function enter() {
  const { app, liveCadence } = await import('../core/app.js');

  app.onAction = (act, el) => {
    if (act === 'game') { app.gameId = el.dataset.game; app.router.go('game'); }
    if (act === 'hero-dot') { state.heroId = el.dataset.game; app.router.refresh(); }
  };

  unregister = app.scheduler.add(() => {
    load().then(() => {
      app.scheduler.setInterval(liveCadence(state.games));
      app.router.refresh();
    });
  });

  await load();
  // liveCadence is the single definition of "how often should we poll" — don't
  // re-derive it here, or the two drift.
  app.scheduler.setInterval(liveCadence(state.games));
  app.router.refresh();
}

export function leave() {
  unregister?.();
  unregister = null;
}
