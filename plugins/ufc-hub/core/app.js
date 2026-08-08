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
import { athletesForEvent, joinAthletes } from './espn-athletes.js';

export const state = {
  view: 'card',
  index: [],
  selected: null,
  event: null,
  month: null,         // raw ESPN month payload, kept for the athlete join
  athletes: new Map(), // CloudFront fighterId -> { espnId, flag, country }
  openFight: null,     // fightId of the expanded row, or null
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
    athletes: st.athletes,
    openFight: st.openFight,
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
  state.month = raw ?? null;
  state.index = raw ? parseMonthIndex(raw) : [];
  state.selected = nearestEvent(state.index) ?? null;
}

async function loadEvent() {
  if (!state.selected) { state.event = null; state.athletes = new Map(); return; }
  const cfId = await resolveCfId(state.selected, { store }).catch(() => null);
  if (!cfId) { state.event = null; state.athletes = new Map(); return; }
  // TTL is read from the PREVIOUS state so a card that has gone live starts polling
  // without waiting a full idle interval for the next load to notice.
  const raw = await cache.get(CF_URL(cfId), () => getJson(CF_URL(cfId)),
    ttlFor(state.event), { staleOnError: true }).catch(() => null);
  state.event = raw ? parseEvent(raw) : null;
  // Costs no request: the month payload is already in hand.
  state.athletes = state.event
    ? joinAthletes(state.event.fights, athletesForEvent(state.month, state.selected.id))
    : new Map();
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

  // Accordion: opening one closes the other, so the panel never becomes a wall of
  // twelve open versus screens.
  const toggleFight = (el) => {
    const id = Number(el.dataset.fight);
    state.openFight = state.openFight === id ? null : id;
    paint();
  };

  // One delegated listener for the whole plugin.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'nav') { state.view = t.dataset.view; paint(); return; }
    if (t.dataset.act === 'retry') { paint(); return; }
    if (t.dataset.act === 'fight') { toggleFight(t); return; }
    // The fighter button is NESTED inside the row, so closest() finds it first and the
    // row never sees the click. Fighter pages are wave 2; until they exist, falling
    // through to the row is the difference between "expands" and "does nothing at all".
    if (t.dataset.act === 'fighter') {
      const row = t.closest('[data-act="fight"]');
      if (row) toggleFight(row);
    }
  });

  // A row is role="button", so it has to answer the keyboard like one.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('[data-act="fight"]');
    if (!t) return;
    e.preventDefault();
    toggleFight(t);
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
