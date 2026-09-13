// core/app.js — bootstrap: data, art, the section router, the saves-changed bus, the credits footer.

import { connect } from './host.js';
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
};

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

async function boot() {
  const index = await fetch('art/index.json').then((r) => r.json());
  ctx.art = createPackReader({ index });

  const meta = await ctx.data.meta();
  clear(credits).append(
    'Data: ', h('a', { href: meta.source, target: '_blank', rel: 'noopener' }, 'Spire Codex'),
    ' · ', h('a', { href: meta.game, target: '_blank', rel: 'noopener' }, meta.copyright),
    ` · game build ${meta.gameVersion}`,
  );

  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-section]');
    if (b && SECTIONS[b.dataset.section]) show(b.dataset.section);
  });
  await show('wiki');
}

connect({
  onInit(msg) {
    ctx.placement = msg.context?.placement ?? 'page';
    ctx.contextType = msg.context?.contextType ?? null;
  },
  onEvent(ev) {
    if (ev.event === 'game.saves.changed' && ev.data?.game === 'slay-the-spire-2') {
      for (const fn of [...savesListeners]) fn(ev.data);
    }
  },
});

boot().catch((e) => {
  console.error('[sts2-companion] boot failed', e);
  clear(view).append(h('p', { class: 'empty' }, 'STS2 Companion could not load its data.'));
});
