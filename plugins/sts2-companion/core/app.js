// core/app.js — bootstrap: data, art, the section router, the saves-changed bus, the credits footer.

import { connect, overlayContext, rawSaves, store, local, net, friends } from './host.js';
import { syncRuns } from './sharing.js';
import { refreshLinks, channelsFrom, pushParty, pullParty } from './party.js';
import { layoutFor, onPanelShown } from './placement.js';
import { createData } from './data.js';
import { createPackReader } from './pack.js';
import { h, clear } from './dom.js';

const view = document.getElementById('view');
const credits = document.getElementById('credits');
const nav = document.getElementById('sections');

const savesListeners = new Set();

export const ctx = {
  data: createData(),
  art: null,
  placement: 'page',
  contextType: null,
  /** game.saves.changed — a cue to pull again, not data. Returns an unsubscribe. */
  onSavesChanged(fn) { savesListeners.add(fn); return () => savesListeners.delete(fn); },
};

const SECTIONS = {
  wiki: () => import('../views/wiki.js').then((m) => m.mountWiki),
  deck: () => import('../views/deck.js').then((m) => m.mountDeck),
  history: () => import('../views/history.js').then((m) => m.mountHistory),
  insights: () => import('../views/insights.js').then((m) => m.mountInsights),
  community: () => import('../views/community.js').then((m) => m.mountCommunity),
};

// Shared runs are sent whenever the plugin is open — its page or a panel — not only on the Community
// section: a personal plugin runs only while open, and a run usually ends with the game in front
// (community stats spec §4). syncRuns does nothing unless the user opted in, and never runs twice at once.
// Debounced because the game writes its save several times as a run ends.
let syncTimer = null;
function syncSoon(ms) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncRuns({ saves: rawSaves, store, local, net }).catch(() => {}); }, ms);
}

let current = null;
let showing = 0;

async function show(name) {
  const mine = ++showing;
  for (const b of nav.querySelectorAll('[data-section]')) b.setAttribute('aria-current', String(b.dataset.section === name));
  current?.destroy?.();
  current = null;
  const mount = await SECTIONS[name]();
  if (mine !== showing) return;
  const mounted = await mount(view, ctx);
  // A quicker click mounted another section meanwhile; this one must not linger listening.
  if (mine !== showing) { mounted?.destroy?.(); return; }
  current = mounted;
}

// Resolved by the first dissent:init. The overlay posts init on the frame's load event, and every
// panel loads the same page, so nothing is mounted until the page knows which panel it is.
let resolveInit;
const initReceived = new Promise((r) => { resolveInit = r; });
const INIT_WAIT_MS = 3000;

async function boot() {
  const [index, meta, context] = await Promise.all([
    fetch('art/index.json').then((r) => r.json()),
    ctx.data.meta(),
    Promise.race([initReceived, new Promise((r) => setTimeout(() => r({}), INIT_WAIT_MS))]),
  ]);
  ctx.art = createPackReader({ index });

  clear(credits).append(
    'Data: ', h('a', { href: meta.source, target: '_blank', rel: 'noopener' }, 'Spire Codex'),
    ' · ', h('a', { href: meta.game, target: '_blank', rel: 'noopener' }, meta.copyright),
    ` · game build ${meta.gameVersion}`,
  );

  const layout = layoutFor(context);
  document.body.classList.toggle('compact', layout.compact);
  nav.hidden = layout.compact; // a panel is one section; the host's chrome names it

  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-section]');
    if (b && SECTIONS[b.dataset.section]) show(b.dataset.section);
  });
  await show(layout.section);
  syncSoon(5_000);
  partyLoop();
}

// Co-op with friends (core/party.js). Polled, not cued: overlay panels get no save cue, and a guest's game
// writes nothing to be cued by. Every PARTY_POLL_MS: read friends:link links (an invite shows up in an
// overlay panel this way), then — when any link is accepted — send the run in progress if this computer has
// one and it changed, receive friends' runs, and tell the views to pull again through the same bus as a
// save change. Finished runs are listed less often: that reads the history folder.
const PARTY_POLL_MS = 10_000;
const PARTY_FINISHED_EVERY = 6;
let partyTick = 0;
let lastLinks = '';
const tell = (extra) => { for (const fn of [...savesListeners]) fn({ game: 'slay-the-spire-2', ...extra }); };
async function partyLoop() {
  try {
    const links = await refreshLinks({ friends, local });
    const seen = JSON.stringify(links);
    if (seen !== lastLinks) { lastLinks = seen; tell({ coop: true }); }
    const channels = channelsFrom(links);
    const withFinished = partyTick % PARTY_FINISHED_EVERY === 0;
    const saves = withFinished ? rawSaves : async (action, params) => (action === 'runs' ? { status: 'skipped' } : rawSaves(action, params));
    // Always: a co-op run on this computer is how friends get matched and linked in the first place.
    const sent = await pushParty({ saves, store, local, net, friends, channels });
    if (sent.current === 'sent') tell({ coop: true });
    if (channels.length) {
      const got = await pullParty({ store, local, net, channels });
      if (got.current || got.imported) tell({ party: true });
    }
    partyTick += 1;
  } catch (e) {
    console.warn('[sts2-companion] co-op sync failed', e);
  }
  setTimeout(partyLoop, PARTY_POLL_MS);
}

connect({
  onInit(msg) {
    ctx.placement = msg.context?.placement ?? 'page';
    ctx.contextType = msg.context?.contextType ?? null;
    resolveInit(msg.context ?? {});
  },
  async onEvent(ev) {
    if (ev.event === 'game.saves.changed' && ev.data?.game === 'slay-the-spire-2') {
      for (const fn of [...savesListeners]) fn(ev.data);
      syncSoon(10_000);
    }
    if (ev.event === 'overlay.context.changed') {
      onPanelShown(current, await overlayContext());
    }
  },
});

boot().catch((e) => {
  console.error('[sts2-companion] boot failed', e);
  clear(view).append(h('p', { class: 'empty' }, 'STS2 Companion could not load its data.'));
});
