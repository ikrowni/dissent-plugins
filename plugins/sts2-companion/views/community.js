// views/community.js — sharing your runs with STS2 community stats, and what everyone's shared runs say.
//
// 🔴 Sharing is OFF until the user turns it on here, and the exact JSON sent is one click away. Stats need
// no sharing: anyone can read them.

import { h, clear } from '../core/dom.js';
import { saves, rawSaves, store, local, net } from '../core/host.js';
import { sharedCurrent, importedRuns } from '../core/party.js';
import { mountCoop } from './coop.js';
import { humanizeId } from '../core/data.js';
import { readSettings, optIn, optOut, setBackfill, syncRuns, deleteSharedData, previewContribution, sharingState, BACKFILL_CAP } from '../core/sharing.js';
import { loadStats, pickCell, communityRates } from '../core/stats.js';
import { listRunSummaries } from '../core/runList.js';
import { BANDS, bandOf } from '../core/builds.js';
import { barChart } from '../core/chart.js';
import { statusText } from './status.js';
import { CHARACTERS, rateText } from './insights.js';

const TOP = 12;

export const SYNC_TEXT = {
  off: 'Sharing is off.',
  backoff: 'Could not reach the stats service. It will try again shortly.',
  offline: 'Could not reach the stats service. Your runs will be sent when it is reachable.',
  unavailable: 'Sending needs Dissent desktop and your approval for sts2-stats.plugins.dissent.chat (My plugins → Review permissions). Your runs wait until then.',
};

const rateCell = (r) => h('td', {}, rateText(r.rate == null ? { rate: null, n: r.n } : r));

async function snapshot() {
  const r = await fetch('data/community-snapshot.json');
  return r.ok ? r.json() : null;
}

export async function mountCommunity(root, ctx) {
  const state = { settings: await readSettings(store), sync: null, sent: null, confirmDelete: false, deleted: null, preview: undefined,
    stats: null, filter: { character: CHARACTERS[0], band: '0', mode: 'solo', build: null } };
  let alive = true;
  let paints = 0;

  const body = h('div', { class: 'section-body community' });
  clear(root).append(h('div', { class: 'section' }, body));

  // The user's newest run picks the group shown first.
  const list = await listRunSummaries(saves);
  const newest = list.status === 'ok' ? list.runs[0] : null;
  if (newest) {
    Object.assign(state.filter, {
      character: newest.characters?.[0] ?? state.filter.character,
      band: bandOf(newest.ascension ?? 0),
      mode: (newest.players ?? 1) > 1 ? 'coop' : 'solo',
      build: newest.build ?? null,
    });
  }

  // Co-op with friends: one self-updating block, moved into each paint (views/coop.js).
  const coop = mountCoop(ctx, { showInvite: true, manage: true });
  state.partyInfo = null;

  async function partyInfo() {
    const shared = await sharedCurrent(local);
    return { received: shared?.sentAt ?? null, imported: (await importedRuns(local)).length };
  }

  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function partyPanel() {
    const info = state.partyInfo;
    return h('section', { class: 'panel', dataset: { part: 'party' } },
      h('h3', {}, 'Co-op with friends'),
      h('p', {}, 'Slay the Spire 2 keeps a co-op run only on the host\'s computer, so a guest\'s Companion has nothing to read. '
        + 'When you play co-op with Dissent friends who have STS2 Companion, whoever hosts sends the run to them automatically — both decks, relics, potions, HP, gold and the map while you play, and the finished run afterwards. '
        + 'Friends are recognised by the Steam accounts connected to Dissent, and only receive runs they were in. '
        + 'For a friend without Steam connected, send an invite instead. Runs are sealed so the stats service passing them along cannot read them, and forgotten there within hours (finished runs within 7 days). Solo runs are never sent.'),
      coop.el,
      info && (info.received || info.imported) ? h('p', { class: 'sub', dataset: { part: 'party-status' } }, [
        info.received ? `Last run update from a friend: ${clock(info.received)}` : null,
        info.imported ? `${info.imported} finished co-op run${info.imported === 1 ? '' : 's'} received` : null,
      ].filter(Boolean).join(' · ')) : null);
  }

  async function sync() {
    state.sync = await syncRuns({ saves: rawSaves, store, local, net });
    state.sent = await sharingState(local);
    await paint();
  }

  const toggle = (label, checked, onchange, { disabled = false, act } = {}) => h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked, disabled, dataset: { act }, onchange: (e) => onchange(e.target.checked) }), ' ', label);

  function syncLine() {
    const s = state.sync;
    if (!state.settings.enabled) return null;
    if (!s) return h('p', { class: 'sub', dataset: { part: 'sync' } }, 'Checking for runs to send…');
    let text;
    if (s.status === 'ok') {
      text = `${state.sent?.sent ?? 0} runs shared from this computer`
        + (s.waiting ? ` · ${s.waiting} waiting` : '')
        + (state.sent?.refused ? ` · ${state.sent.refused} not accepted` : '');
    } else if (s.status === 'error') {
      text = `The stats service refused the request: ${s.error}`;
    } else {
      text = SYNC_TEXT[s.status] ?? statusText(s.status);
    }
    return h('p', { class: 'sub', dataset: { part: 'sync', status: s.status } }, text);
  }

  function sharingPanel() {
    const s = state.settings;
    const del = s.contributorId ? h('button', { type: 'button', class: 'chip', dataset: { act: 'delete' },
      onclick: async () => {
        if (!state.confirmDelete) { state.confirmDelete = true; await paint(); return; }
        const r = await deleteSharedData({ store, local, net });
        state.confirmDelete = false;
        state.deleted = r;
        state.settings = await readSettings(store);
        state.sync = null;
        state.sent = null;
        await paint();
      } }, state.confirmDelete ? 'Really delete everything I shared?' : 'Delete my shared data') : null;

    const deleted = state.deleted && h('p', { class: 'sub', dataset: { part: 'deleted', status: state.deleted.status } },
      state.deleted.status === 'ok'
        ? `Deleted ${state.deleted.deleted} shared runs. Your contributor id is forgotten.`
        : state.deleted.status === 'unavailable'
          ? 'Deleting needs Dissent desktop and your approval for sts2-stats.plugins.dissent.chat — nothing was deleted yet.'
          : 'Could not reach the stats service — nothing was deleted. Try again when online.');

    const previewBox = h('details', { dataset: { part: 'preview' },
      ontoggle: async (e) => {
        if (!e.target.open || state.preview !== undefined) return;
        state.preview = await previewContribution(rawSaves);
        await paint();
        root.querySelector('[data-part="preview"]')?.setAttribute('open', '');
      } },
    h('summary', {}, 'Show exactly what is sent for your latest run'),
    state.preview === undefined ? null
      : state.preview === null ? h('p', { class: 'empty' }, 'No finished run to show yet.')
        : h('pre', { class: 'json' }, JSON.stringify(state.preview, null, 2)));

    return h('section', { class: 'panel', dataset: { part: 'sharing' } },
      h('h3', {}, 'Share your runs'),
      h('p', {}, 'When sharing is on, each finished run is sent without your name, account, run id or the time you played: the deck, relics, choices and floor-by-floor health — nothing else. Community stats are built only from runs people chose to share, and you can delete yours at any time.'),
      toggle('Share future runs', s.enabled, async (on) => {
        state.settings = on ? await optIn(store) : (await optOut(store), await readSettings(store));
        state.deleted = null;
        await paint();
        if (on) await sync();
      }, { act: 'share' }),
      toggle(`Also share my past runs (the ${BACKFILL_CAP} newest)`, s.backfill, async (on) => {
        await setBackfill(store, on);
        state.settings = await readSettings(store);
        await paint();
        if (on && state.settings.enabled) await sync();
      }, { disabled: !s.enabled, act: 'backfill' }),
      syncLine(), previewBox, del, deleted);
  }

  const group = (label, values, key, name = (v) => v) => h('div', { class: 'wiki-tabs', role: 'group', 'aria-label': label },
    values.map((v) => h('button', { type: 'button', class: 'tab', dataset: { [key]: v }, 'aria-pressed': String(state.filter[key] === v),
      onclick: () => { state.filter[key] = v; paint(); } }, name(v))));

  async function statsPanel() {
    const filters = h('div', { class: 'wiki-bar' },
      group('Character', CHARACTERS, 'character', humanizeId),
      group('Ascension', BANDS, 'band', (b) => `A${b}`),
      group('Mode', ['solo', 'coop'], 'mode', (m) => (m === 'solo' ? 'Solo' : 'Co-op')));

    const loaded = state.stats;
    if (!loaded) return h('section', { class: 'panel', dataset: { part: 'stats' } }, h('h3', {}, 'Community stats'), h('p', { class: 'empty' }, 'Loading…'));
    const picked = pickCell(loaded.stats, state.filter);
    const source = {
      network: `Updated ${loaded.stats?.generatedAt}.`,
      cache: `From ${loaded.stats?.generatedAt}${loaded.stale ? ' — could not check for newer figures' : ''}.`,
      snapshot: `Bundled with this plugin (${loaded.stats?.generatedAt}) — Dissent desktop fetches newer figures.`,
      none: 'No community figures are available offline yet.',
    }[loaded.source];

    let content;
    if (!picked) {
      content = h('p', { class: 'empty', dataset: { part: 'no-cell' } },
        `Not enough shared runs for this group yet. Figures appear once ${loaded.stats?.minRuns ?? 50} runs are shared for a character, ascension band and mode.`);
    } else {
      const r = communityRates(picked.cell);
      const encounters = await Promise.all(r.encounters.filter((e) => e.deaths > 0).slice(0, TOP).map(async (e) => h('tr', { dataset: { encounter: e.id } },
        h('th', { scope: 'row' }, (await ctx.data.label(e.id)).name), h('td', {}, String(e.fought)), h('td', {}, String(e.deaths)), rateCell(e.rate))));
      const cards = await Promise.all(r.cards.filter((c) => c.impact != null).slice(0, TOP).map(async (c) => h('tr', { dataset: { card: c.id } },
        h('th', { scope: 'row' }, (await ctx.data.label(c.id)).name), h('td', {}, String(c.offered)), rateCell(c.pickRate),
        rateCell(c.pickedRate), rateCell(c.skippedRate), h('td', {}, `${c.impact >= 0 ? '+' : '−'}${Math.round(Math.abs(c.impact) * 100)} pts`))));
      const table = (heads, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'stats' },
        h('thead', {}, h('tr', {}, heads.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, rows)));
      content = h('div', {},
        h('p', { class: 'sub', dataset: { part: 'cell' } },
          `${r.runs} shared runs · win rate ${rateText(r.winRate)}`
          + (picked.sameBuild ? ` · game build ${picked.build}` : ` · from game build ${picked.build} (none yet for ${state.filter.build})`)),
        h('h4', {}, 'Where runs end'), barChart(r.floorBuckets, { label: 'Floor reached' }),
        encounters.length ? table(['Encounter', 'Fought', 'Ended runs', 'Death rate'], encounters) : null,
        h('h4', {}, 'Build types'),
        r.buildTypes.length
          ? table(['Build', 'Runs', 'Wins', 'Win rate', 'Median floor'], r.buildTypes.map((b) => h('tr', { dataset: { build: b.label } },
            h('th', { scope: 'row' }, b.label), h('td', {}, String(b.runs)), h('td', {}, String(b.wins)), rateCell(b.rate), h('td', {}, b.medianFloor == null ? '—' : String(b.medianFloor)))))
          : h('p', { class: 'empty' }, 'No build type has enough runs yet.'),
        h('h4', {}, 'Card impact'),
        h('p', { class: 'sub' }, 'Wins when picked against wins when skipped. It shows what went together, not what caused what.'),
        cards.length ? table(['Card', 'Offered', 'Pick rate', 'Win rate picked', 'Win rate skipped', 'Difference'], cards)
          : h('p', { class: 'empty' }, 'No card has enough picks and skips yet.'));
    }
    return h('section', { class: 'panel', dataset: { part: 'stats' } },
      h('h3', {}, 'Community stats'), filters, h('p', { class: 'sub', dataset: { part: 'source', source: loaded.source } }, source), content);
  }

  async function paint() {
    const mine = ++paints;
    const el = h('div', {}, partyPanel(), sharingPanel(), await statsPanel());
    if (!alive || mine !== paints) return;
    clear(body).append(el);
  }

  await paint();
  state.stats = await loadStats({ local, net, snapshot });
  await paint();
  if (state.settings.enabled) sync();

  state.partyInfo = await partyInfo();
  await paint();

  const off = ctx.onSavesChanged(async (ev) => {
    if (ev?.coop) return; // views/coop.js refreshes itself
    if (ev?.party) { state.partyInfo = await partyInfo(); await paint(); return; }
    if (state.settings.enabled) sync();
  });
  return { destroy() { alive = false; off(); coop.destroy(); } };
}
