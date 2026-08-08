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
import { athletesForEvent, joinAthletes } from './espn-athletes.js';

export const state = {
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
 * The view model every render receives.
 *
 * There is no longer a separate play-by-play TAB: each fight carries its own feed
 * inside its versus screen, which is where a reader is already looking when they want
 * it. The tab showed only one fight's feed — whichever `LiveFightId` pointed at, else
 * the main event — so on a card of twelve it was eleven-twelfths useless.
 */
export function viewModel(st = state) {
  return {
    event: st.event,
    athletes: st.athletes,
    openFight: st.openFight,
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
  const cardView = await import('../views/card.js');

  const paint = () => {
    try {
      mount.innerHTML = cardView.renderPanel(viewModel());
    } catch (err) {
      // A throwing view must never leave an empty pane — that reads as a dead plugin.
      mount.innerHTML = stateMsg('This section could not be displayed.', { retry: true });
      console.error('[ufc-hub] card render failed:', err);
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
