// core/app.js — bootstrap, routing, event delegation, scheduler wiring.
//
// This is the ONLY module that touches the DOM outside a view's render, the only place
// with an event listener, and the only caller of scheduler.start(). Views are pure
// render functions plus optional enter/leave hooks.
//
// Views are imported DYNAMICALLY in boot(), not at module scope. Two reasons: the
// router and its helpers stay unit-testable without pulling in every view, and views
// import back from here (for app/applyScoreFlip), which as a static cycle would be
// fragile.
import { handleSDKMessage, getInitContext } from '../../plugin-sdk.js';
import { POLL_LIVE_MS, POLL_IDLE_MS } from './config.js';
import { createScheduler } from './scheduler.js';
import { motion } from './motion.js';
import { store, KEY } from './store.js';
import { stateMsg } from './ui.js';
import { isReplayRequested, replayFixtureName } from './replay.js';

/** Fast cadence if any game is in progress, else idle. The single definition of
 *  "how often should we poll" — views call this rather than re-deriving it. */
export function liveCadence(games) {
  return (games ?? []).some((g) => g.state === 'in') ? POLL_LIVE_MS : POLL_IDLE_MS;
}

/**
 * Swap views into a single mount point. Views implement:
 *   render() -> html string   (required)
 *   enter()                   (optional, once on activation)
 *   leave()                   (optional, once on deactivation)
 */
export function createRouter({ mount, views, nav }) {
  let current = null;

  function paint(name) {
    try {
      mount.innerHTML = views[name].render();
    } catch (err) {
      // A throwing view must not leave an empty pane — that reads as a dead plugin.
      mount.innerHTML = stateMsg('This section could not be displayed.', { retry: true });
      console.error(`[nfl-hub] ${name} render failed:`, err);
    }
  }

  function syncNav(name) {
    for (const b of nav?.querySelectorAll('[data-act="nav"]') ?? []) {
      b.setAttribute('aria-current', String(b.dataset.view === name));
    }
  }

  return {
    get current() { return current; },

    go(name) {
      if (!views[name] || name === current) return;
      if (current) views[current].leave?.();
      current = name;
      syncNav(name);
      paint(name);
      // enter() runs even if paint() failed, so the view can recover on refresh.
      views[name].enter?.();
    },

    /** Re-render in place, without re-running enter(). */
    refresh() {
      if (current) paint(current);
    },
  };
}

/** Flip only the scores that changed, so an unchanged side stays still. */
export function applyScoreFlip(root, next, prev) {
  if (!next || !prev) return;
  for (const el of root?.querySelectorAll?.('[data-score]') ?? []) {
    const side = el.dataset.score;
    if (next[side] !== prev[side]) {
      el.classList.remove('flip');
      // Reading offsetWidth forces a reflow so re-adding the class restarts it.
      void el.offsetWidth;
      el.classList.add('flip');
    }
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
const scheduler = createScheduler({ intervalMs: POLL_IDLE_MS });

export const app = {
  ctx: null,
  season: null,
  seasonType: null,
  week: null,
  gameId: null,
  // Drill-down selections, set by whichever view emitted the click.
  teamAbbr: null,
  athleteId: null,
  router: null,
  scheduler,
  motion,
  replay: null,
  onAction: null,
};

/** Stamp the class from the OS preference alone. Synchronous, so it lands before the
 *  first paint and a reduce-motion user never sees one cinematic frame. */
function applyOsMotionPref() {
  document.body.classList.toggle('reduce-motion', !motion.enabled);
}

/** Reconcile the user's stored override. Deliberately NOT awaited before the first
 *  paint: it is a host round-trip, and blocking the whole hub on it means a slow or
 *  denied storage capability shows a spinner for the full request timeout. The OS
 *  preference already covers the common case. */
async function applyStoredMotionPref() {
  const prefs = await store.getUser(KEY.prefs(), {});
  if (prefs && typeof prefs.reduceMotion === 'boolean') {
    motion.setReduceMotion(prefs.reduceMotion);
    document.body.classList.toggle('reduce-motion', !motion.enabled);
  }
}

async function applySeasonLabel() {
  // ⚠️ Season/week comes from core/nfl-state.js, and it is load-bearing well
  // outside the header: the standings tab refuses to draw a playoff picture when
  // `seasonType === 'pre'`, and the leaders tab labels last season's finals as
  // final. Nothing throws if this stops working — the surfaces just start lying.
  const label = document.getElementById('season-label');
  try {
    const { fetchState } = await import('./nfl-state.js');
    const st = await fetchState();
    if (!st) { if (label) label.textContent = ''; return; }
    app.season = st.season ?? null;
    app.seasonType = st.seasonType ?? null;
    app.week = st.displayWeek ?? st.week ?? null;
    if (label) {
      const kind = st.isPreseason ? 'Preseason' : st.isRegular ? '' : 'Postseason';
      label.textContent = app.season
        ? `${app.season} ${kind} · Week ${app.week}`.replace(/\s+/g, ' ')
        : '';
    }
  } catch {
    // A failed state lookup must not stop the hub — views fall back to the current
    // week. Clear the placeholder rather than leaving "Loading…" up forever, which
    // reads as a hung plugin.
    if (label) label.textContent = '';
  }
}

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;

  const mount = document.getElementById('main');
  const nav = document.getElementById('nav');

  const [
    leagueView, gameView, standingsView, leadersView, newsView, teamView, playerView,
    myLeagueView,
  ] = await Promise.all([
    import('../views/league.js'),
    import('../views/game.js'),
    import('../views/standings.js'),
    import('../views/leaders.js'),
    import('../views/news.js'),
    import('../views/team.js'),
    import('../views/player.js'),
    import('../views/league-section.js'),
  ]);

  app.router = createRouter({
    mount,
    nav,
    views: {
      league: leagueView, game: gameView, standings: standingsView,
      leaders: leadersView, news: newsView, team: teamView, player: playerView,
      // ⚠️ THE ONLY LEAGUE NOW. A `fantasy` view used to sit beside this one,
      // mirroring a league that lived on Sleeper and could only be read. It was
      // removed on 2026-08-12 — never configured on any install, no stored state
      // on any of them — once this native engine shipped and could be played.
      myleague: myLeagueView,
    },
  });

  applyOsMotionPref();

  // Replay first: it is a same-origin fetch of committed fixtures, so it is fast and
  // it decides which view opens. Host round-trips come after the first paint.
  if (isReplayRequested()) {
    try {
      const { loadReplay } = await import('./replay.js');
      app.replay = await loadReplay(replayFixtureName(), { stepMs: 400 });
    } catch (err) {
      console.error('[nfl-hub] replay load failed:', err);
      app.replay = null;
    }
  }

  // One delegated listener for the whole plugin.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'nav') { app.router.go(t.dataset.view); return; }
    if (act === 'retry') { app.router.refresh(); return; }
    // Views claim their own actions via app.onAction, set in their enter().
    app.onAction?.(act, t, e);
  });

  // The replay scrubber is a range input, which reports on input rather than click.
  document.addEventListener('input', (e) => {
    const t = e.target.closest('[data-act]');
    if (t) app.onAction?.(t.dataset.act, t, e);
  });

  app.router.go(app.replay ? 'game' : 'league');
  scheduler.start();

  // Fire-and-forget, after the first paint. Neither changes layout: one toggles a body
  // class, the other fills a label. Awaiting them before painting cost ~20s outside
  // Dissent, and would cost the full request timeout inside it if the host were slow.
  applyStoredMotionPref().catch(() => {});
  applySeasonLabel().catch(() => {});
}

// Guarded so this module can be imported outside a browser — a unit test importing it
// for createRouter must not start a bootstrap or attach listeners as a side effect.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => handleSDKMessage(e, (init) => {
    app.ctx = init.context ?? getInitContext();
    boot();
  }));

  // Outside Dissent (a bare browser open) there is no host handshake, so boot anyway
  // after a beat. That is what makes ?replay= usable for development.
  setTimeout(() => { if (!booted) boot(); }, 3000);
}
