// views/deck.js — the Deck section: the run in progress (desktop), and the archetype Builder.

import { h, clear } from '../core/dom.js';
import { saves } from '../core/host.js';
import { humanizeId } from '../core/data.js';
import { resolveCards, groupDeck, keywordCoverage } from '../core/deck.js';
import { deckGrid, curvePanel, coveragePanel, relicRow, loadArt } from './deck-parts.js';
import { statusBlock } from './status.js';
import { mountBuilder } from './builder.js';

const TABS = [['current', 'Current run'], ['builder', 'Builder']];

export async function renderCurrentRun(run, ctx, { openBuilder } = {}) {
  if (run?.status !== 'ok') {
    const extra = run?.status === 'desktop_only' && openBuilder
      ? h('button', { type: 'button', class: 'chip', dataset: { act: 'open-builder' }, onclick: openBuilder }, 'Plan a deck in the Builder')
      : null;
    return statusBlock(run, extra);
  }
  const p = run.players[0];
  const entries = await resolveCards(ctx.data, p.deck);
  const saved = Number.isFinite(run.saved_at)
    ? new Date(run.saved_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  return h('div', { class: 'run-now' },
    h('header', { class: 'run-head' },
      h('h2', {}, `${humanizeId(p.character)} · Act ${run.act.index + 1} · ${humanizeId(run.act.id)}`),
      h('p', { class: 'sub' }, [`${p.hp}/${p.max_hp} HP`, `${p.gold} gold`, `${p.max_energy} energy`, `${entries.length} cards`,
        run.ascension ? `Ascension ${run.ascension}` : null].filter(Boolean).join(' · ')),
      // ⚠️ The game writes its save on entering and leaving a room — never mid-fight.
      h('p', { class: 'sub asof' }, `As of entering this room${saved ? ` (saved ${saved})` : ''}. The game saves when you change rooms, not during a fight.`)),
    h('section', { class: 'panel' }, h('h3', {}, 'Relics'), await relicRow(ctx, p.relics)),
    h('div', { class: 'panels' }, curvePanel(entries), coveragePanel(keywordCoverage(entries))),
    deckGrid(groupDeck(entries)));
}

export async function mountDeck(root, ctx) {
  let tab = 'current';
  let child = null;
  let pull = 0;

  const tabs = h('div', { class: 'wiki-tabs', role: 'tablist' }, TABS.map(([key, label]) =>
    h('button', { type: 'button', class: 'tab', role: 'tab', dataset: { tab: key }, 'aria-selected': String(key === tab), onclick: () => show(key) }, label)));
  const body = h('div', { class: 'section-body' });
  clear(root).append(h('div', { class: 'section' }, h('div', { class: 'wiki-bar' }, tabs), body));

  async function paintCurrent() {
    const mine = ++pull;
    const run = await saves('currentRun');
    if (mine !== pull || tab !== 'current') return; // a newer pull, or the Builder, won
    const el = await renderCurrentRun(run, ctx, { openBuilder: () => show('builder') });
    if (mine !== pull || tab !== 'current') return;
    clear(body).append(el);
    loadArt(body, ctx);
  }

  async function show(key) {
    tab = key;
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === key));
    child?.destroy?.();
    child = null;
    if (key === 'builder') child = await mountBuilder(body, ctx);
    else await paintCurrent();
  }

  // game.saves.changed is a cue, not data: pull again (a room change wrote the save).
  const off = ctx.onSavesChanged?.(() => { if (tab === 'current') paintCurrent(); });
  await show('current');

  return {
    destroy() {
      pull += 1;
      off?.();
      child?.destroy?.();
      ctx.art.releaseAll();
    },
  };
}
