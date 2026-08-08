// core/app.js — bootstrap, routing, the single event listener, and all data loading.
//
// The ONLY module that touches the DOM outside a view's render, and the only place with an
// event listener. Views are pure render functions and are imported DYNAMICALLY so the
// state helpers here stay unit-testable without pulling in every view.
import { handleSDKMessage, getInitContext } from '../../plugin-sdk.js';
import { cache, TTL } from './cache.js';
import { getJson } from './http.js';
import { store } from './store.js';
import { stateMsg } from './ui.js';
import { motion } from './motion.js';
import { urls, monthKey, parseMonthIndex } from './ufc-espn.js';
import { nearestEvent } from './event-index.js';
import { CF_URL, resolveCfId } from './ufc-cf-client.js';
import { parseEvent } from './ufc-cloudfront.js';
import { parseTracking } from './fight-timeline.js';

export const state = {
  view: 'card',
  index: [],
  selected: null,
  event: null,
  error: null,
  loading: true,
};

/**
 * The fight the play-by-play should show.
 *
 * During a live card that is whatever `LiveFightId` points at; otherwise the main event,
 * which is FightOrder 1.
 */
export function focusFight(event) {
  const fights = event?.fights ?? [];
  if (!fights.length) return null;
  return fights.find((f) => f.fightId === event.liveFightId)
    ?? fights.find((f) => f.order === 1)
    ?? fights[0];
}

/** Fighter id -> name, across the whole card, for the timeline's labels. */
export function fighterNames(event) {
  const names = {};
  for (const f of event?.fights ?? []) {
    for (const x of f.fighters ?? []) if (x.fighterId != null) names[x.fighterId] = x.name;
  }
  return names;
}

/** The view model every render receives. */
export function viewModel(st = state) {
  const fight = focusFight(st.event);
  return {
    event: st.event,
    events: fight ? parseTracking(fight.tracking) : [],
    fighterNames: fighterNames(st.event),
  };
}

/** A live card polls hard; a finished one is immutable. */
export function ttlFor(event) {
  if (event?.state === 'in') return TTL.EVENT_LIVE;
  if (event?.state === 'post') return TTL.EVENT_FINAL;
  return TTL.EVENT_UPCOMING;
}

async function loadIndex() {
  const key = monthKey(new Date());
  const raw = await cache.get(urls.month(key), () => getJson(urls.month(key)),
    TTL.MONTH_INDEX, { staleOnError: true }).catch(() => null);
  state.index = raw ? parseMonthIndex(raw) : [];
  state.selected = nearestEvent(state.index) ?? null;
}

async function loadEvent() {
  if (!state.selected) { state.event = null; return; }
  const cfId = await resolveCfId(state.selected, { store }).catch(() => null);
  if (!cfId) { state.event = null; return; }
  // TTL is read from the PREVIOUS state so a card that has gone live starts polling
  // without waiting a full idle interval for the next load to notice.
  const raw = await cache.get(CF_URL(cfId), () => getJson(CF_URL(cfId)),
    ttlFor(state.event), { staleOnError: true }).catch(() => null);
  state.event = raw ? parseEvent(raw) : null;
}

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;

  const mount = document.getElementById('main');
  const nav = document.getElementById('nav');
  const [cardView, timelineView] = await Promise.all([
    import('../views/card.js'),
    import('../views/timeline.js'),
  ]);
  const views = { card: cardView, timeline: timelineView };

  const paint = () => {
    try {
      mount.innerHTML = views[state.view].renderPanel(viewModel());
    } catch (err) {
      // A throwing view must never leave an empty pane — that reads as a dead plugin.
      mount.innerHTML = stateMsg('This section could not be displayed.', { retry: true });
      console.error(`[ufc-hub] ${state.view} render failed:`, err);
    }
    for (const b of nav?.querySelectorAll('[data-act="nav"]') ?? []) {
      b.setAttribute('aria-current', String(b.dataset.view === state.view));
    }
    const label = document.getElementById('event-label');
    if (label) label.textContent = state.event?.name ?? '';
  };

  // One delegated listener for the whole plugin.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'nav') { state.view = t.dataset.view; paint(); return; }
    if (t.dataset.act === 'retry') { paint(); }
  });

  if (motion.bodyClass) document.body.classList.add(motion.bodyClass);

  paint();
  try {
    await loadIndex();
    await loadEvent();
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  }
  state.loading = false;
  paint();
}

window.addEventListener('message', (e) => {
  handleSDKMessage(e);
  if (getInitContext()) boot();
});
boot();
