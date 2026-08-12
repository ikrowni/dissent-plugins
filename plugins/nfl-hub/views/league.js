// views/league.js — Around the League: the landing surface.
//
// Pure render plus enter/leave. Data arrives via a module-level state object that
// enter() populates through the shared cache; render() never fetches.
import { chip, badge, stateMsg, esc, errorPane} from '../core/ui.js';
import { teamColor } from '../core/player-visuals.js';
import { fmtClock, ordinalDown } from '../core/format.js';
import { cache, TTL } from '../core/cache.js';
import { fetchScoreboard, urls } from '../core/espn-client.js';
import { parseScoreboard } from '../core/espn-game.js';
import { renderHero } from './game-scorebug.js';

const state = {
  loading: true, error: null, games: [], week: null, season: null, seasonType: null,
  heroId: null,
  // ⚠️ This tab shares its hero with Game Center AND polls on the same cadence, so
  // it needs the same first-paint gate. Without it the two team crests spring-scale
  // in on every tick — measured live before the gate existed. See views/game.js.
  settled: false,
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

/**
 * One game on the slate.
 *
 * ⚠️ EACH SIDE CARRIES ITS OWN CLUB COLOUR, which this card had none of while the
 * hero directly above it is built almost entirely out of it. On a full Sunday
 * slate of sixteen cards, the abbreviation is a three-letter word you have to
 * READ; the colour is the thing that lets you find your team without reading.
 * `teamColor()` lifts near-black primaries, which is why it is used rather than
 * the raw value — four clubs would otherwise get an invisible rail.
 */
export function gameRow(g) {
  const live = g.state === 'in';
  const side = (t, other, meta) => `<div class="sb-row gm-side" style="--tc:${esc(teamColor(t?.abbr))}">`
    + chip(t, { showRecord: false })
    + `<span class="sc num ${scoreCls(t, other, g.state)}">${esc(t?.score ?? '')}</span>`
    + `<span class="sb-meta">${esc(meta)}</span>`
    + '</div>';
  // No sparkline here: a trend needs per-game win-probability history, which is one
  // extra fetch per card and would blow the proxy budget on a 16-game slate. The trend
  // lives in Game Center, where exactly one game is open.
  return `<button class="game-card${live ? ' live' : ''}" data-act="game" data-game="${esc(g.id)}">`
    + side(g.away, g.home, statusText(g))
    + side(g.home, g.away, live && g.down ? ordinalDown(g.down, g.distance) : '')
    + `<div class="gm-foot">${badge(g.state)}`
      + (g.redZone ? '<span class="badge redzone">Red zone</span>' : '')
    + '</div>'
    + '</button>';
}

/**
 * "Week 1 · preseason", or just the week when the type is unremarkable.
 *
 * ⚠️ TWO DIFFERENT SEASON-TYPE CONVENTIONS EXIST IN THIS PLUGIN AND THEY DO NOT
 * COMPARE. ESPN's scoreboard says `season.type` as a NUMBER — 1 preseason,
 * 2 regular, 3 post — while `app.seasonType`, which comes from
 * core/nfl-state.js, is a STRING: 'pre' / 'regular' / 'post'. views/standings.js
 * gates on the string; this view has the number, from the same payload as the
 * games. Comparing one against the other silently matches nothing, which is a
 * gate that never fires rather than an error anybody sees — so this accepts both.
 */
export function slotLabel(s) {
  const week = s?.week ?? null;
  const t = s?.seasonType;
  const pre = t === 1 || t === 'pre';
  const post = t === 3 || t === 'post';
  const kind = pre ? 'preseason' : post ? 'postseason' : '';
  if (!week) return kind || 'this week';
  return kind ? `Week ${week} · ${kind}` : `Week ${week}`;
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

  const first = !s.settled;
  // ⚠️ THE SLATE GOES ON THE STAGE, under the hero it belongs to. This tab had the
  // best surface in the plugin and then dropped straight to flat panels — the same
  // cliff Game Center had, on the tab people land on first. One stage holds every
  // timeslot so the day reads as one card wall rather than three stacked boxes.
  let html = hero ? renderHero(hero, { siblings: s.games, entrance: first }) : '';
  const slate = [...groups].map(([slot, list]) => `
    <div class="gm-slot">
      <div class="gm-slot-head"><h4>${esc(slot)}</h4>
        <span class="kicker">${list.length} game${list.length === 1 ? '' : 's'}</span></div>
      <div class="game-grid${first ? ' m-stagger' : ''}">${list.map(gameRow).join('')}</div>
    </div>`).join('');
  html += `<div class="stage gm-stage${first ? ' is-first' : ''}">
    <div class="stage-head"><h3>${esc(s.games.length)} game${s.games.length === 1 ? '' : 's'}</h3>
      <span class="stage-sub">${esc(slotLabel(s))}</span></div>
    ${slate}
  </div>`;
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
    // ⚠️ In August "Week 1" alone is ambiguous — it reads as the opener when it is
    // preseason, the exact class of lie two earlier sessions removed from
    // standings and leaders. The scoreboard already carries the answer, so this
    // costs no extra fetch.
    state.seasonType = parsed.seasonType;
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
  // ⚠️ AFTER the paint. That render is the arrival; every poll after it is not.
  state.settled = true;
}

export function leave() {
  unregister?.();
  unregister = null;
  state.settled = false;
}
