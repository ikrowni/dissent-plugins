// views/deck.js — the Deck section: the run in progress (desktop), and the archetype Builder.

import { h, clear } from '../core/dom.js';
import { saves } from '../core/host.js';
import { humanizeId } from '../core/data.js';
import { resolveCards, groupDeck, keywordCoverage, defaultPlayer } from '../core/deck.js';
import { deckGrid, curvePanel, coveragePanel, relicRow, loadArt } from './deck-parts.js';
import { statusBlock } from './status.js';
import { mountBuilder } from './builder.js';
import { mountCoop } from './coop.js';

const TABS = [['current', 'Current run'], ['builder', 'Builder']];

function playerSwitch(run, shown, onPlayer) {
  if (!onPlayer || (run.players?.length ?? 0) < 2) return null;
  return h('div', { class: 'wiki-tabs players', role: 'group', 'aria-label': 'Player' },
    run.players.map((p) => h('button', {
      type: 'button', class: 'tab', dataset: { player: String(p.player) }, 'aria-pressed': String(p.player === shown),
      onclick: () => onPlayer(p.player),
    }, `${humanizeId(p.character)}${p.player === run.you ? ' (you)' : ''}`)));
}

export async function renderCurrentRun(run, ctx, { openBuilder, compact = false, player = null, onPlayer = null } = {}) {
  if (run?.status !== 'ok') {
    const extra = run?.status === 'desktop_only' && openBuilder
      ? h('button', { type: 'button', class: 'chip', dataset: { act: 'open-builder' }, onclick: openBuilder }, 'Plan a deck in the Builder')
      : null;
    return statusBlock(run, extra);
  }
  const shown = run.players.some((x) => x.player === player) ? player : defaultPlayer(run);
  const p = run.players.find((x) => x.player === shown) ?? run.players[0];
  const entries = await resolveCards(ctx.data, p.deck);
  const saved = Number.isFinite(run.saved_at)
    ? new Date(run.saved_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  return h('div', { class: 'run-now' },
    playerSwitch(run, shown, onPlayer),
    h('header', { class: 'run-head' },
      h('h2', {}, `${humanizeId(p.character)} · Act ${run.act.index + 1} · ${humanizeId(run.act.id)}`),
      h('p', { class: 'sub' }, [`${p.hp}/${p.max_hp} HP`, `${p.gold} gold`, `${p.max_energy} energy`, `${entries.length} cards`,
        run.ascension ? `Ascension ${run.ascension}` : null, run.players.length > 1 ? `Co-op · ${run.players.length} players` : null].filter(Boolean).join(' · ')),
      // ⚠️ The game writes its save on entering and leaving a room — never mid-fight.
      h('p', { class: 'sub asof' }, `As of entering this room${saved ? ` (saved ${saved})` : ''}. The game saves when you change rooms, not during a fight.`),
      run.shared ? h('p', { class: 'sub', dataset: { part: 'shared' } },
        `Sent by ${run.shared.peer || 'your co-op host'} at ${new Date(run.shared.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
        + (run.you ? '' : ' Pick which player you are above.')) : null),
    h('section', { class: 'panel' }, h('h3', {}, 'Relics'), await relicRow(ctx, p.relics)),
    h('div', { class: 'panels' }, curvePanel(entries), compact ? null : coveragePanel(keywordCoverage(entries))),
    deckGrid(groupDeck(entries)));
}

export async function mountDeck(root, ctx) {
  let tab = 'current';
  let child = null;
  let pull = 0;
  let player = null; // co-op: the player being looked at; null until the user picks one
  let lastRun = null;
  // Overlay (spec §5): the run in progress and its curve. The Builder stays in the app.
  const compact = ctx.placement === 'overlay';
  // Invites and Accept live here too, so a guest sees an invite in the overlay panel mid-game.
  // "Invite a friend" shows while THIS computer's run is co-op: the host is the one with something to share.
  const coop = mountCoop(ctx, { compact, showInvite: () => lastRun?.status === 'ok' && lastRun.players?.length > 1 && !lastRun.shared });

  const tabs = h('div', { class: 'wiki-tabs', role: 'tablist' }, TABS.map(([key, label]) =>
    h('button', { type: 'button', class: 'tab', role: 'tab', dataset: { tab: key }, 'aria-selected': String(key === tab), onclick: () => show(key) }, label)));
  const body = h('div', { class: 'section-body' });
  const bar = compact ? null : h('div', { class: 'wiki-bar' }, tabs);
  clear(root).append(h('div', { class: 'section' }, ...(bar ? [bar] : []), body));

  async function paintCurrent() {
    const mine = ++pull;
    const run = await saves('currentRun');
    if (mine !== pull || tab !== 'current') return; // a newer pull, or the Builder, won
    lastRun = run;
    coop.refresh();
    const el = await renderCurrentRun(run, ctx, {
      openBuilder: () => show('builder'), compact, player,
      onPlayer: (n) => { player = n; paintCurrent(); },
    });
    if (mine !== pull || tab !== 'current') return;
    clear(body).append(coop.el, el);
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
    /** Overlay: the panel was opened — re-read the save (overlay frames get no save cue). */
    refresh() { if (tab === 'current') paintCurrent(); },
    destroy() {
      pull += 1;
      off?.();
      coop.destroy();
      child?.destroy?.();
      ctx.art.releaseAll();
    },
  };
}
