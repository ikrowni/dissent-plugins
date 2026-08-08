// core/app.js — bootstrap, routing, the single event listener, and all data loading.
//
// The ONLY module that touches the DOM outside a view's render, and the only place with an
// event listener. Views are pure render functions and are imported DYNAMICALLY so the
// state helpers here stay unit-testable without pulling in every view.
import { handleSDKMessage, getInitContext } from '../../plugin-sdk.js';
import { cache, TTL } from './cache.js';
import { getJson, getText } from './http.js';
import { store } from './store.js';
import { stateMsg } from './ui.js';
import { motion } from './motion.js';
import { urls, monthKey, parseMonthIndex } from './ufc-espn.js';
import { shiftMonth, monthOf } from './schedule.js';
import { nearestEvent } from './event-index.js';
import { CF_URL, resolveCfId } from './ufc-cf-client.js';
import { parseEvent } from './ufc-cloudfront.js';
import { athletesForEvent, joinAthletes } from './espn-athletes.js';
import { cardUrl, joinMarkets } from './polymarket.js';
import { athleteUrl, eventPageUrl } from './ufc-links.js';
import { parseEventPage } from './ufc-event-page.js';
import { parseAthlete } from './ufc-athlete.js';
import {
  parseNews, relevantTo, cardAthleteIds, cardAthleteNames,
} from './ufc-news.js';
import { placeBet } from '../../polymarket.js';

export const state = {
  view: 'card',        // 'card' | 'schedule'
  monthKey: null,      // the month the PAGER is showing
  months: new Map(),   // monthKey -> raw ESPN payload, for the athlete join
  index: [],
  selected: null,
  event: null,
  month: null,         // raw ESPN month payload, kept for the athlete join
  athletes: new Map(), // CloudFront fighterId -> { espnId, flag, country }
  odds: new Map(),     // CloudFront fightId  -> parsed Polymarket markets
  artwork: null,       // { art, renders } from the ufc.com event page
  fighter: null,       // the open fighter profile, or null
  fighterLoading: false,
  news: [],
  newsLoading: false,
  config: null,      // per-install config; drives the betting mode
  betNotice: null,
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
    odds: st.odds,
    artwork: st.artwork,
    config: st.config,
    view: st.view,
    monthKey: st.monthKey,
    monthEvents: st.index,
    selectedId: st.selected?.id ?? null,
    openFight: st.openFight,
    fighter: st.fighter,
    fighterLoading: st.fighterLoading,
  };
}

/** A live card polls hard; a finished one is immutable. */
export function ttlFor(event) {
  if (event?.state === 'in') return TTL.EVENT_LIVE;
  if (event?.state === 'post') return TTL.EVENT_FINAL;
  return TTL.EVENT_UPCOMING;
}

/**
 * Load ONE month.
 *
 * ⚠️ One month at a time, always: `?dates=YYYY` is 2,035,461 bytes, over the 1 MB
 * fetch:external cap, and fails silently through the proxy. See core/ufc-espn.js.
 *
 * The raw payload is kept per month because the ESPN athlete join reads it, and a
 * viewer browsing March while a card from August is open needs AUGUST's payload — not
 * whichever month the pager happens to be showing.
 */
async function loadMonth(key) {
  if (state.months.has(key)) return parseMonthIndex(state.months.get(key));
  const url = urls.month(key);
  const raw = await cache.get(url, () => getJson(url),
    TTL.MONTH_INDEX, { staleOnError: true }).catch(() => null);
  if (raw) state.months.set(key, raw);
  return raw ? parseMonthIndex(raw) : [];
}

async function loadIndex() {
  const key = monthKey(new Date());
  state.monthKey = key;
  state.index = await loadMonth(key);
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
  // Costs no request: the month payload is already in hand. Keyed by the SELECTED
  // event's own month, not the pager's — those differ as soon as anyone browses.
  const mk = monthOf(state.selected.startTime) ?? state.monthKey;
  const payload = state.months.get(mk) ?? null;
  state.athletes = state.event && payload
    ? joinAthletes(state.event.fights, athletesForEvent(payload, state.selected.id))
    : new Map();
}

/**
 * Odds are a SEPARATE, NON-BLOCKING load.
 *
 * The card must render without them: Polymarket does not price every fight (Johns vs
 * Vazquez had no market on the measured card), the query is a third-party host that can
 * be slow, and a failure here must never cost the viewer the fight card itself.
 */
async function loadOdds() {
  const start = state.event?.startTime ?? state.selected?.startTime;
  const url = start ? cardUrl(start) : null;
  if (!url || !state.event) { state.odds = new Map(); return; }
  const raw = await cache.get(url, () => getJson(url),
    ttlFor(state.event), { staleOnError: true }).catch(() => null);
  state.odds = Array.isArray(raw) ? joinMarkets(state.event.fights, raw) : new Map();
}

/**
 * ufc.com artwork. Non-blocking, exactly like the odds: this is a scraped HTML page on
 * a third-party host, and a failure must never cost the viewer the fight card.
 *
 * ⚠️ getText, not getJson — this is HTML and getJson throws on the first byte.
 */
async function loadArtwork() {
  const url = state.event ? eventPageUrl(state.event.name, state.event.startTime) : null;
  if (!url) { state.artwork = null; return; }
  const raw = await cache.get(url, () => getText(url),
    TTL.UFC_PAGE, { staleOnError: true }).catch(() => null);
  state.artwork = raw ? parseEventPage(raw) : null;
}

/**
 * News. Loaded on demand, not at boot: it is the only view nobody has asked for until
 * they click it, and the card must not wait on it.
 */
async function loadNews() {
  if (state.news.length) return;
  const url = urls.news(20);
  state.newsLoading = true;
  const raw = await cache.get(url, () => getJson(url),
    TTL.NEWS, { staleOnError: true }).catch(() => null);
  state.news = raw ? parseNews(raw) : [];
  state.newsLoading = false;
}

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;

  const mount = document.getElementById('main');
  const [cardView, fighterView, scheduleView, newsView] = await Promise.all([
    import('../views/card.js'),
    import('../views/fighter.js'),
    import('../views/schedule.js'),
    import('../views/news.js'),
  ]);

  const paint = () => {
    try {
      if (state.fighter) {
        mount.innerHTML = fighterView.renderFighter(state.fighter, state.athletes,
          { loading: state.fighterLoading });
      } else if (state.view === 'schedule') {
        mount.innerHTML = scheduleView.renderPanel({
          monthKey: state.monthKey,
          events: state.index,
          selectedId: state.selected?.id ?? null,
          loading: state.indexLoading,
        });
      } else if (state.view === 'news') {
        mount.innerHTML = newsView.renderPanel({
          articles: state.news,
          cardArticles: relevantTo(state.news, cardAthleteIds(state.athletes)),
          names: cardAthleteNames(state.event?.fights, state.athletes),
          eventName: state.event?.name ?? null,
          loading: state.newsLoading,
        });
      } else {
        mount.innerHTML = cardView.renderPanel(viewModel());
      }
      for (const b of document.querySelectorAll('#nav [data-act="nav"]')) {
        b.setAttribute('aria-current', String(b.dataset.view === state.view));
      }
    } catch (err) {
      // A throwing view must never leave an empty pane — that reads as a dead plugin.
      mount.innerHTML = stateMsg('This section could not be displayed.', { retry: true });
      console.error('[ufc-hub] card render failed:', err);
    }
    const label = document.getElementById('event-label');
    if (label) label.textContent = state.event?.name ?? '';
  };

  /** Open a fighter profile. The page is fetched once and cached for six hours. */
  const openFighter = async (fighterId) => {
    const f = (state.event?.fights ?? [])
      .flatMap((x) => x.fighters ?? [])
      .find((x) => x.fighterId === fighterId);
    if (!f) return;
    state.fighter = { fighterId, base: f, stats: null };
    state.fighterLoading = true;
    paint();

    const url = athleteUrl(f.ufcLink);
    const raw = url
      ? await cache.get(url, () => getText(url), TTL.UFC_PAGE, { staleOnError: true })
          .catch(() => null)
      : null;
    // A viewer can open a second fighter while the first is still in flight; without
    // this the slower response overwrites whichever profile is on screen.
    if (state.fighter?.fighterId !== fighterId) return;
    state.fighter.stats = raw ? parseAthlete(raw) : null;
    state.fighterLoading = false;
    paint();
  };

  /** Page the schedule. Each month is fetched once and then served from the map. */
  const goMonth = async (delta) => {
    const key = shiftMonth(state.monthKey, Number(delta));
    if (!key) return;
    state.monthKey = key;
    state.indexLoading = true;
    paint();
    state.index = await loadMonth(key).catch(() => []);
    state.indexLoading = false;
    paint();
  };

  /**
   * Choose an event off the schedule.
   *
   * Everything downstream keys off state.selected, so this reloads the card, the
   * athletes, the odds and the artwork for the new event — and drops the previous
   * event's, which would otherwise be shown against the wrong card.
   */
  const pickEvent = async (id) => {
    const ev = state.index.find((e) => String(e.id) === String(id));
    if (!ev) return;
    state.selected = ev;
    state.view = 'card';
    state.openFight = null;
    state.event = null;
    state.odds = new Map();
    state.artwork = null;
    state.athletes = new Map();
    paint();
    await loadEvent().catch(() => { state.event = null; });
    paint();
    await loadOdds().catch(() => { state.odds = new Map(); });
    paint();
    await loadArtwork().catch(() => { state.artwork = null; });
    paint();
  };

  /**
   * Place a bet.
   *
   * ⚠️ This does NOT decide whether betting is allowed — `placeBet` does, and refuses
   * unless the install is explicitly in trade mode. The check is deliberately not
   * duplicated here: one choke point, one thing to audit.
   */
  const onBet = async (el) => {
    const fightId = Number(el.dataset.fight);
    const outcomeIndex = Number(el.dataset.outcome);
    const label = el.dataset.label ?? '';
    const m = state.odds.get(fightId);
    if (!m) return;

    // The amount is the user's, so it is asked for rather than assumed. A prompt is
    // crude, but a real order must never take a silent default stake.
    const raw = window.prompt(`Stake on ${label} (USDC.e):`, '');
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount <= 0) return;

    el.disabled = true;
    try {
      const market = {
        question: m.title,
        outcomePrices: m.names.map((n) => m.prob[n]),
        tokens: (m.clobTokenIds ?? []).map((id) => ({ token_id: id })),
      };
      const res = await placeBet({
        market, outcomeIndex, outcomeLabel: label, amount, config: state.config,
      });
      state.betNotice = { ok: true, text: `Order placed (${res.orderId}).` };
    } catch (err) {
      // NOT_GRANTED means the node refused the host, not the exchange — the capability
      // layer doing its job. Say so plainly rather than reporting an exchange failure.
      state.betNotice = {
        ok: false,
        text: err?.code === 'NOT_GRANTED'
          ? 'In-app betting is not enabled on this server.'
          : err?.code === 'MODE_LINK'
            ? 'This server sends you to Polymarket instead.'
            : `Order failed: ${err?.message ?? err}`,
      };
    } finally {
      el.disabled = false;
      paint();
    }
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
    if (t.dataset.act === 'nav') {
      state.view = t.dataset.view;
      state.fighter = null;
      paint();
      if (state.view === 'news') loadNews().then(paint).catch(() => { state.newsLoading = false; });
      return;
    }
    if (t.dataset.act === 'month') { goMonth(t.dataset.delta); return; }
    if (t.dataset.act === 'bet') { onBet(t); return; }
    if (t.dataset.act === 'pick-event') { pickEvent(t.dataset.event); return; }
    if (t.dataset.act === 'fight') { toggleFight(t); return; }
    // The fighter button is NESTED inside the row, so closest() finds it first and the
    // row never sees the click — which is what makes this route possible at all.
    if (t.dataset.act === 'fighter') {
      const id = Number(t.dataset.fighter);
      if (Number.isFinite(id)) openFighter(id);
      return;
    }
    if (t.dataset.act === 'close-fighter') { state.fighter = null; paint(); }
  });

  // A row is role="button", so it has to answer the keyboard like one.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('[data-act="fight"]');
    if (!t) return;
    e.preventDefault();
    toggleFight(t);
  });

  // The host delivers the server owner's per-install config at init. It decides whether
  // this install links out or places orders — see plugins/polymarket.js.
  state.config = getInitContext()?.pluginConfig ?? null;

  if (motion.bodyClass) document.body.classList.add(motion.bodyClass);

  paint();
  try {
    await loadIndex();
    await loadEvent();
    state.error = null;
    paint();                      // the card, before waiting on a third party
    await loadOdds().catch(() => { state.odds = new Map(); });
    paint();
    await loadArtwork().catch(() => { state.artwork = null; });
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
