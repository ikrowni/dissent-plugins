// views/wiki-detail.js — one entity's page: art, text with linked terms, upgrade toggle,
// enemy move patterns, the user's own card stats (desktop), bookmarks.

import { h, clear } from '../core/dom.js';
import { renderGameText } from '../core/markup.js';
import { saveIdToDataId } from '../core/data.js';
import { store, saves } from '../core/host.js';

// Keyed by the data instance (stable for a plugin session), not a module global: a global
// would pin the first answer — e.g. "desktop_only" — for every later caller, tests included.
const statsCache = new WeakMap();
/** profileStats once per data instance; null off desktop or on any non-ok status. */
function cardStats(ctx) {
  if (!statsCache.has(ctx.data)) {
    statsCache.set(ctx.data, saves('profileStats').then((r) => {
      if (r?.status !== 'ok') return null;
      const m = new Map();
      for (const c of r.cards ?? []) m.set(saveIdToDataId(c.id).id, c);
      return m;
    }).catch(() => null));
  }
  return statsCache.get(ctx.data);
}

async function toggleBookmark(key, button) {
  const list = (await store.get('bookmarks')) ?? [];
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  await store.set('bookmarks', next);
  button.setAttribute('aria-pressed', String(next.includes(key)));
  button.textContent = next.includes(key) ? '★ Bookmarked' : '☆ Bookmark';
}

/** Wire every linked term in `el` to open its page, and show a small tip on hover. */
function linkTerms(el, ctx) {
  let tip = null;
  const resolve = async (name) => {
    const power = await ctx.data.powerByName(name);
    if (power) return { kind: 'power', id: power.id, item: power };
    const kw = await ctx.data.keywordByName(name);
    return kw ? { kind: 'keyword', id: kw.id, item: kw } : null;
  };
  for (const term of el.querySelectorAll('[data-term]')) {
    term.addEventListener('click', async () => {
      const r = await resolve(term.dataset.term);
      if (r) ctx.open({ kind: r.kind, id: r.id });
    });
    term.addEventListener('mouseenter', async () => {
      const r = await resolve(term.dataset.term);
      if (!r || !term.isConnected) return;
      tip?.remove();
      const box = term.getBoundingClientRect();
      tip = h('div', { class: 'tip', style: `left:${Math.round(box.left)}px;top:${Math.round(box.bottom + 6)}px` },
        h('strong', {}, r.item.name), renderGameText(r.item.description));
      document.body.appendChild(tip);
    });
    term.addEventListener('mouseleave', () => { tip?.remove(); tip = null; });
  }
}

async function artImg(ctx, artId, alt) {
  const url = await ctx.art.url(artId);
  return url ? h('img', { src: url, alt }) : h('span', { class: 'ph' });
}

export async function renderDetail(ref, ctx) {
  const item = await ctx.data.get(ref.kind, ref.id);
  const key = `${ref.kind}:${ref.id}`;
  const bookmarks = (await store.get('bookmarks')) ?? [];
  const marked = bookmarks.includes(key);
  const bookmark = h('button', { type: 'button', class: 'chip', dataset: { act: 'bookmark' }, 'aria-pressed': String(marked) },
    marked ? '★ Bookmarked' : '☆ Bookmark');
  bookmark.addEventListener('click', () => toggleBookmark(key, bookmark));

  if (item.unknown) {
    return h('div', { class: 'detail' }, h('div', {}), h('div', {},
      h('h1', {}, item.id), h('p', { class: 'sub' }, 'Not in this data build — the game may have changed since it was made.')));
  }

  const text = h('div', { class: 'row card-text' });
  const setText = (s) => { clear(text).append(renderGameText(s)); linkTerms(text, ctx); };
  setText(item.description);

  const side = h('div', {});
  const main = h('div', {}, h('h1', {}, item.name), bookmark);

  if (ref.kind === 'card') {
    const img = await artImg(ctx, `card:${item.id}`, item.name);
    side.append(img);
    main.append(h('p', { class: 'sub' }, [item.rarity, item.type, item.xCost ? 'X cost' : `${item.cost} energy`, item.color].filter(Boolean).join(' · ')));
    main.append(text);
    if (item.upgradeDescription) {
      let upgraded = false;
      const toggle = h('button', { type: 'button', class: 'chip', dataset: { act: 'upgrade' }, 'aria-pressed': 'false' }, 'Upgraded');
      toggle.addEventListener('click', async () => {
        upgraded = !upgraded;
        toggle.setAttribute('aria-pressed', String(upgraded));
        setText(upgraded ? item.upgradeDescription : item.description);
        const url = await ctx.art.url(`${upgraded ? 'card-upg' : 'card'}:${item.id}`);
        if (url && side.firstChild?.tagName === 'IMG') side.firstChild.src = url;
      });
      main.append(h('div', { class: 'row' }, toggle));
    }
    if (item.keywords?.length) main.append(h('p', { class: 'row sub' }, `Keywords: ${item.keywords.join(', ')}`));
    const stats = (await cardStats(ctx))?.get(item.id);
    if (stats) {
      main.append(h('p', { class: 'row your-stats' },
        `Your runs: picked ${stats.picked} · skipped ${stats.skipped} · ${stats.won} won · ${stats.lost} lost`));
    }
  } else if (ref.kind === 'monster') {
    side.append(await artImg(ctx, `monster:${item.id}`, item.name));
    const hp = item.hp.max && item.hp.max !== item.hp.min ? `${item.hp.min}–${item.hp.max}` : `${item.hp.min}`;
    main.append(h('p', { class: 'sub' }, `${item.type} · ${hp} HP`));
    const moves = new Map(item.moves.map((m) => [m.id, m]));
    if (item.pattern?.description) main.append(h('p', { class: 'row' }, item.pattern.description));
    const states = (item.pattern?.states ?? []).filter((s) => s.move_id && moves.has(s.move_id));
    const list = states.length ? states.map((s) => moves.get(s.move_id)) : item.moves;
    main.append(h('ul', { class: 'pattern' }, list.map((m) => h('li', {},
      h('strong', {}, m.name), m.intent ? ` — ${m.intent}` : '',
      m.damage ? ` · ${m.damage.normal}${m.damage.hit_count ? `×${m.damage.hit_count}` : ''} damage` : '',
      m.block ? ` · ${m.block} block` : ''))));
  } else if (ref.kind === 'event') {
    main.append(text, h('ul', { class: 'pattern' }, (item.options ?? []).map((o) => h('li', {}, h('strong', {}, o.title), ' ', renderGameText(o.description)))));
    linkTerms(main, ctx);
  } else {
    const art = { relic: 'relic', potion: 'potion', power: 'power' }[ref.kind];
    if (art) side.append(await artImg(ctx, `${art}:${item.id}`, item.name));
    if (item.rarity) main.append(h('p', { class: 'sub' }, item.rarity));
    main.append(text);
    if (item.flavor) main.append(h('p', { class: 'row sub' }, renderGameText(item.flavor)));
  }

  return h('div', { class: 'detail' }, side, main);
}
