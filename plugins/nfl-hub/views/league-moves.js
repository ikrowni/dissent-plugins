// views/league-moves.js — waivers, free agents and trades.
//
// ⚠️ WAIVERS ARE BLIND. `waiver:list` returns only the caller's own claims (or
// everything, to a commissioner), and this view must never imply otherwise —
// showing a "pending claims" count that included other managers' bids would leak
// the shape of a blind auction even without the numbers.
//
// ⚠️ A FREE AGENT IS SOMEONE NO TEAM HOLDS. The search excludes every rostered
// player in the league, not just the caller's own — offering a rostered player
// produces a refusal on submit and the manager cannot tell why.

import { esc, panel, stateMsg, noLeaguePane} from '../core/ui.js';
import {
  submitClaim, cancelClaim, listClaims, addPlayer, dropPlayer,
  proposeTrade, respondToTrade, listTrades, setTradeBlock, getTradeBlock, getWaiverWire,
} from '../core/league-api.js';
import { loadIndex, searchPlayers, playerLabel, getIndex } from '../core/player-index.js';
import { playerChip, managerColor } from '../core/player-visuals.js';
import { loadTrending, formatCount } from '../core/trending.js';
import { getJson } from '../core/http.js';
import { describe } from './league-home.js';

const state = {
  trending: null,   // { adds, drops } — null until loaded, never fatal
  leagueId: null,
  league: null,
  teamId: null,
  week: null,
  claims: null,      // { claims, budgets, pendingCount }
  trades: [],
  block: {},        // { [teamId]: { players, picks } }
  interest: {},     // { [teamId]: playerId[] }
  counts: {},       // { [playerId]: how many teams want him }
  wire: [],         // [{ playerId, clearsAt, droppedBy }] soonest first
  query: '',
  results: [],
  bid: 0,
  dropId: '',
  tradeWith: '',     // the other team in a proposal
  tradeMine: [],     // my player ids going out
  tradeTheirs: [],   // their player ids coming in
  loaded: false,
  error: null,
  busy: false,
  notice: null,
};

export function reset() {
  Object.assign(state, {
    leagueId: null, league: null, teamId: null, week: null, claims: null, trades: [],
    block: {}, interest: {}, counts: {}, wire: [],
    query: '', results: [], bid: 0, dropId: '', tradeWith: '', tradeMine: [], tradeTheirs: [],
    loaded: false, error: null, busy: false, notice: null,
  });
}

/** Every player any team holds — the set a free agent is NOT in. */
export function rosteredIds(league) {
  const out = new Set();
  for (const r of Object.values(league?.assets?.rosters ?? {})) {
    for (const id of [...(r.players ?? []), ...(r.ir ?? []), ...(r.taxi ?? [])]) out.add(String(id));
  }
  return out;
}

export function render() {
  if (state.error) {
    return panel({
      title: 'Moves',
      body: `<p class="muted">${esc(state.error)}</p>
             <button class="btn" data-act="moves-retry">Try again</button>`,
    });
  }
  if (!state.loaded) return stateMsg('Loading moves…', { spinner: true });
  if (!state.leagueId) return noLeaguePane('Moves');
  if (!state.teamId) {
    return panel({ title: 'Moves', body: '<p class="muted">You do not have a team in this league.</p>' });
  }

  return `${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
    ${freeAgentPane()}
    ${claimsPane()}
    ${waiverWirePane()}
    ${tradeBlockPane()}
    ${tradePane()}
    ${tradeListPane()}
    ${trendingPanel()}`;
}

// ── Free agents and waiver claims ────────────────────────────────────────────

function freeAgentPane() {
  const faab = state.league?.settings?.waiverType === 'faab';
  const budget = state.claims?.budgets?.[state.teamId];
  const myRoster = state.league?.assets?.rosters?.[state.teamId]?.players ?? [];

  // The search result already carries name/position/team; the index record adds
  // the portrait and the team mark, and falls back cleanly when it has neither.
  const rows = state.results.map((p) => {
    const rec = getIndex()?.[String(p.id)] ?? { n: p.name, p: p.position, t: p.team };
    return `<div class="fa">
      ${playerChip(rec, { size: 34, compact: true })}
      <button class="btn" data-act="moves-claim" data-player="${esc(p.id)}" ${state.busy ? 'disabled' : ''}>
        ${faab ? 'Bid' : 'Claim'}
      </button>
    </div>`;
  }).join('');

  return panel({
    title: 'Free agents',
    right: faab && budget !== undefined ? `<span class="muted">$${budget} left</span>` : '',
    body: `
      <input type="search" data-act="moves-search" placeholder="Search free agents…"
             value="${esc(state.query)}" autocomplete="off" ${state.busy ? 'disabled' : ''}>
      <div class="row">
        ${faab ? `<label>Bid <input type="number" min="0" data-act="moves-bid" value="${state.bid}"></label>` : ''}
        <label>Drop
          <select data-act="moves-drop">
            <option value="">— nobody —</option>
            ${myRoster.map((id) => `<option value="${esc(id)}"${state.dropId === String(id) ? ' selected' : ''}>${esc(playerLabel(id))}</option>`).join('')}
          </select>
        </label>
      </div>
      ${state.query.trim().length < 2
    ? '<p class="muted">Type at least two letters.</p>'
    : (rows || '<p class="muted">No free agent matches that.</p>')}`,
  });
}

function claimsPane() {
  const mine = state.claims?.claims ?? [];
  if (mine.length === 0) {
    return panel({ title: 'My claims', body: '<p class="muted">No pending claims.</p>' });
  }
  return panel({
    title: 'My claims',
    body: `<table class="tbl"><tbody>${mine.map((c) => `
      <tr>
        <td>${esc(playerLabel(c.playerId))}</td>
        <td class="num">${c.bid ? `$${c.bid}` : '—'}</td>
        <td>${c.dropPlayerId ? `drop ${esc(playerLabel(c.dropPlayerId))}` : ''}</td>
        <td class="num"><button class="btn tiny danger" data-act="moves-cancel-claim"
              data-player="${esc(c.playerId)}" ${state.busy ? 'disabled' : ''}>Cancel</button></td>
      </tr>`).join('')}</tbody></table>
      <p class="muted">Claims are blind and clear on the league's waiver run.</p>`,
  });
}

// ── Trades ───────────────────────────────────────────────────────────────────

/**
 * Who is offering what, and who wants mine.
 *
 * ⚠️ THIS IS THE LEAGUE ENGINE'S BLOCK, not the Fantasy tab's. Here a blocked
 * player leads somewhere — the propose form below is ours. On a read-only mirror
 * it could only ever be a noticeboard, because Sleeper cannot be written to.
 */
/**
 * Who is sitting on waivers, and until when.
 *
 * ⚠️ A CLAIM IS THE ONLY WAY TO GET THESE PLAYERS — the add path refuses them
 * outright. A manager who cannot see the wire, or the deadline on it, has no way
 * to know why an add failed or when to bid.
 */
function waiverWirePane() {
  const rows = (state.wire ?? []).map((w) => {
    const when = Number(w.clearsAt);
    const label = Number.isFinite(when)
      ? new Date(when).toLocaleString()
      : 'soon';
    return `<div class="ww-row">
      <span class="ww-name">${esc(playerLabel(w.playerId))}</span>
      <span class="ww-when">clears ${esc(label)}</span>
      ${w.droppedBy ? `<span class="ww-by">dropped by ${esc(teamName(w.droppedBy))}</span>` : ''}
    </div>`;
  }).join('');

  return panel({
    title: 'On waivers',
    body: rows
      ? `<p class="tiny">These players cannot be added directly — submit a claim.</p>${rows}`
      : '<p class="muted">Nobody is on waivers right now.</p>',
  });
}

function tradeBlockPane() {
  const teams = state.league?.teams ?? {};
  const rosters = state.league?.assets?.rosters ?? {};
  const mine = (rosters[state.teamId]?.players ?? []).map(String);
  const myBlock = (state.block?.[state.teamId]?.players ?? []).map(String);
  const myInterest = (state.interest?.[state.teamId] ?? []).map(String);

  const othersBlocking = Object.entries(state.block ?? {})
    .filter(([t]) => String(t) !== String(state.teamId))
    .filter(([, e]) => (e?.players?.length ?? 0) > 0);

  // ⚠️ ACCENTED, because this block IS that team's own card. Inline mentions of a
  // team inside another row ("dropped by X", the trade legs) deliberately are not
  // — §8b scopes the accent to a team's own rows and cards, and a left border on a
  // mid-sentence span reads as damage.
  const theirRows = othersBlocking.map(([t, e]) => `
    <div class="tb-team team-accent" style="--mgr:${esc(managerColor(t))}">
      <h5>${esc(teams[t]?.name ?? t)}</h5>
      ${e.players.map((id) => `<label class="check">
        <input type="checkbox" data-act="moves-interest-toggle" data-player="${esc(String(id))}"
               ${myInterest.includes(String(id)) ? 'checked' : ''}>
        ${esc(playerLabel(id))}
      </label>`).join('')}
    </div>`).join('');

  // ⚠️ The count is shown on MY players, because that is the question a manager
  // actually has — not "who is popular", but "would anyone take him?".
  const myRows = mine.map((id) => {
    const n = state.counts?.[String(id)] ?? 0;
    return `<label class="check">
      <input type="checkbox" data-act="moves-block-toggle" data-player="${esc(id)}"
             ${myBlock.includes(id) ? 'checked' : ''}>
      ${esc(playerLabel(id))}
      ${n > 0 ? `<span class="tb-count" title="${n} team${n === 1 ? '' : 's'} interested">♥ ${n}</span>` : ''}
    </label>`;
  }).join('');

  return panel({
    title: 'Trade block',
    body: `
      <div class="trade-cols">
        <div>
          <h4>Your players</h4>
          <p class="tiny">Tick to offer. ♥ shows how many teams want him.</p>
          ${myRows || '<p class="muted">No players.</p>'}
        </div>
        <div>
          <h4>On the block</h4>
          ${theirRows || '<p class="muted">Nobody else is offering anyone yet.</p>'}
        </div>
      </div>`,
  });
}

function tradePane() {
  const others = Object.values(state.league?.teams ?? {}).filter((t) => t.id !== state.teamId);
  if (others.length === 0) return '';

  const mine = state.league?.assets?.rosters?.[state.teamId]?.players ?? [];
  const theirs = state.tradeWith
    ? (state.league?.assets?.rosters?.[state.tradeWith]?.players ?? [])
    : [];

  const picker = (ids, selected, act) => (ids.length === 0
    ? '<p class="muted">No players.</p>'
    : ids.map((id) => `<label class="check">
        <input type="checkbox" data-act="${act}" data-player="${esc(id)}"
               ${selected.includes(String(id)) ? 'checked' : ''}>
        ${esc(playerLabel(id))}
      </label>`).join(''));

  return panel({
    title: 'Propose a trade',
    body: `
      <label>With
        <select data-act="moves-trade-with">
          <option value="">— choose a team —</option>
          ${others.map((t) => `<option value="${esc(t.id)}"${state.tradeWith === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
      </label>
      ${state.tradeWith ? `
        <div class="trade-cols">
          <div><h4>You send</h4>${picker(mine, state.tradeMine, 'moves-trade-mine')}</div>
          <div><h4>You get</h4>${picker(theirs, state.tradeTheirs, 'moves-trade-theirs')}</div>
        </div>
        <button class="btn primary" data-act="moves-propose"
                ${state.busy || (state.tradeMine.length === 0 && state.tradeTheirs.length === 0) ? 'disabled' : ''}>
          ${state.busy ? 'Proposing…' : 'Propose trade'}
        </button>` : ''}`,
  });
}

function tradeListPane() {
  if (state.trades.length === 0) {
    return panel({ title: 'Trades', body: '<p class="muted">No trades yet.</p>' });
  }
  return panel({
    title: 'Trades',
    body: state.trades.map((t) => tradeRow(t)).join(''),
  });
}

/**
 * ⚠️ THE ACTIONS OFFERED DEPEND ON STATE AND ON WHO YOU ARE. A party may accept
 * or reject while it is proposed; the proposer may cancel; ONLY A NON-PARTY may
 * veto, and only during review. Offering a veto to a party would invite a
 * refusal the module already enforces — and imply the rule is different.
 */
export function actionsFor(trade, teamId) {
  const isParty = (trade.parties ?? []).includes(String(teamId));
  const isProposer = String(trade.proposedBy) === String(teamId);
  const accepted = (trade.acceptances ?? {})[String(teamId)] !== undefined;

  if (trade.status === 'proposed') {
    if (isProposer) return ['cancel'];
    if (isParty && !accepted) return ['accept', 'reject'];
    return [];
  }
  if (trade.status === 'review' && !isParty) return ['veto'];
  return [];
}

/**
 * Offer (or withdraw) one of my players, saving immediately.
 *
 * ⚠️ SENDS THE WHOLE LIST, because `setBlock` REPLACES rather than merges —
 * that is what makes un-blocking possible without a second verb. Sending only
 * the changed id would wipe everything else the team was offering.
 */
export async function toggleBlock(app, playerId) {
  const id = String(playerId ?? '');
  if (!id || !state.teamId) return;
  const current = (state.block?.[state.teamId]?.players ?? []).map(String);
  const players = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  await saveTradeBlock(app, { players });
}

/** Express (or withdraw) interest in someone else's player. */
export async function toggleInterest(app, playerId) {
  const id = String(playerId ?? '');
  if (!id || !state.teamId) return;
  const current = (state.interest?.[state.teamId] ?? []).map(String);
  const interest = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  await saveTradeBlock(app, { interest });
}

/**
 * Persist a block/interest patch and fold the answer back in.
 *
 * ⚠️ RE-READS RATHER THAN GUESSING. The record is contended, so another team's
 * write may have landed between render and save; the op returns the settled
 * counts and this trusts those over anything computed locally.
 */
async function saveTradeBlock(app, patch) {
  state.error = null;
  state.busy = true;
  app?.router?.refresh();
  try {
    await setTradeBlock(state.leagueId, state.teamId, patch);
    const tb = await getTradeBlock(state.leagueId);
    state.block = tb?.block ?? {};
    state.interest = tb?.interest ?? {};
    state.counts = tb?.counts ?? {};
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

function tradeRow(t) {
  const legs = (t.legs ?? []).map((l) =>
    `${esc(teamName(l.from))} → ${esc(teamName(l.to))}: ${esc(playerLabel(l.playerId))}`).join('<br>');
  const acts = actionsFor(t, state.teamId);
  return `<div class="trade">
    <div class="trade-head">
      <strong>${esc(t.status)}</strong>
      ${t.reviewEndsAt ? `<span class="muted">review ends ${new Date(t.reviewEndsAt).toLocaleString()}</span>` : ''}
    </div>
    <div class="trade-legs">${legs || '<span class="muted">picks / FAAB only</span>'}</div>
    ${acts.length ? `<div class="row-actions">${acts.map((a) => `
      <button class="btn tiny ${a === 'veto' || a === 'reject' ? 'danger' : ''}"
              data-act="moves-trade-act" data-trade="${esc(t.id)}" data-action="${a}"
              ${state.busy ? 'disabled' : ''}>${a}</button>`).join('')}</div>` : ''}
  </div>`;
}

function teamName(teamId) {
  return state.league?.teams?.[String(teamId)]?.name ?? String(teamId);
}

/**
 * What the rest of fantasy is doing right now.
 *
 * ⚠️ THE WAIVER WIRE'S MISSING HALF. A free-agent list sorted by name says
 * nothing about which of those names just became relevant — an injury, a
 * promotion, a breakout. Every other fantasy platform leads with this, and it
 * costs under a kilobyte.
 *
 * ⚠️ Renders NOTHING until it has loaded, and nothing if it failed. It is
 * supplementary; an error box here would be louder than the feature is
 * important, and the tab works perfectly without it.
 */
function trendingPanel() {
  const t = state.trending;
  if (!t || (t.adds.length === 0 && t.drops.length === 0)) return '';

  const column = (rows, label, kind) => `
    <div class="trend-col">
      <h4 class="trend-head ${kind}">${esc(label)}</h4>
      ${rows.length === 0 ? '<p class="tiny">Nothing yet.</p>' : `<div class="m-stagger">${rows.map((r) => `
        <div class="trend-row m-lift">
          ${playerChip(r.player, { size: 30, compact: true })}
          <span class="trend-count ${kind}">${esc(formatCount(r.count))}</span>
        </div>`).join('')}</div>`}
    </div>`;

  return panel({
    title: 'Trending now',
    right: '<span class="tiny">last 24 hours, across Sleeper</span>',
    body: `<div class="trend-cols">
      ${column(t.adds, 'Most added', 'up')}
      ${column(t.drops, 'Most dropped', 'down')}
    </div>`,
  });
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function load(app, { leagueId, league, teamId, week }) {
  Object.assign(state, {
    leagueId, league, teamId, week, loaded: false, error: null, notice: null,
    query: '', results: [],
  });
  app?.router?.refresh();
  try {
    await loadIndex();
    // Both are optional: a league with no waiver week and no trades is normal.
    state.claims = week ? await listClaims(leagueId, week).catch(() => null) : null;
    state.trades = await listTrades(leagueId).catch(() => []);
    // ⚠️ One read for the whole league. The block is a single contended record,
    // so this is one request no matter how many teams are offering.
    state.wire = (await getWaiverWire(leagueId).catch(() => null))?.wire ?? [];
    const tb = await getTradeBlock(leagueId).catch(() => null);
    state.block = tb?.block ?? {};
    state.interest = tb?.interest ?? {};
    state.counts = tb?.counts ?? {};
    // ⚠️ Deliberately NOT awaited into the critical path. The waiver wire is
    // fully usable without it, so a slow or dead upstream must not hold up the
    // whole tab — it fills in when it arrives.
    loadTrending((url) => getJson(url), getIndex() ?? {}, { limit: 8 })
      .then((t) => { state.trending = t; app?.router?.refresh(); })
      .catch(() => { state.trending = { adds: [], drops: [] }; });
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.loaded = true;
    app?.router?.refresh();
  }
}

/**
 * ⚠️ Restores focus after the refresh, exactly as the draft search does — the
 * hub re-renders the whole view, which destroys the input.
 */
export function search(app, query, caret = null) {
  state.query = String(query ?? '');
  state.results = searchPlayers(state.query, { taken: rosteredIds(state.league), limit: 10 });
  app?.router?.refresh();
  if (typeof document !== 'undefined') {
    const el = document.querySelector('[data-act="moves-search"]');
    if (el) {
      el.focus();
      const pos = caret === null ? el.value.length : caret;
      try { el.setSelectionRange(pos, pos); } catch { /* not all inputs support it */ }
    }
  }
}

export function setBid(v) { state.bid = Math.max(0, Number(v) || 0); }
export function setDrop(v) { state.dropId = String(v ?? ''); }

export function setTradeWith(app, teamId) {
  state.tradeWith = String(teamId ?? '');
  // Their side is meaningless once the team changes.
  state.tradeTheirs = [];
  app?.router?.refresh();
}

export function toggleTradePlayer(side, playerId, on) {
  const list = side === 'mine' ? state.tradeMine : state.tradeTheirs;
  const id = String(playerId);
  const next = on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
  if (side === 'mine') state.tradeMine = next; else state.tradeTheirs = next;
}

export async function claim(app, playerId) {
  await act(app, async () => {
    // A league without waivers adds immediately; one with them queues a claim.
    if (!state.week) {
      await addPlayer(state.leagueId, state.teamId, playerId, state.dropId || null);
      return 'Player added.';
    }
    await submitClaim(state.leagueId, state.teamId, state.week, playerId, state.bid, state.dropId || null);
    return 'Claim submitted.';
  });
}

export async function cancel(app, playerId) {
  await act(app, async () => {
    await cancelClaim(state.leagueId, state.teamId, state.week, playerId);
    return 'Claim cancelled.';
  });
}

export async function drop(app, playerId) {
  await act(app, async () => {
    await dropPlayer(state.leagueId, state.teamId, playerId);
    return 'Player dropped.';
  });
}

export async function propose(app) {
  await act(app, async () => {
    const legs = [
      ...state.tradeMine.map((p) => ({ from: state.teamId, to: state.tradeWith, playerId: p })),
      ...state.tradeTheirs.map((p) => ({ from: state.tradeWith, to: state.teamId, playerId: p })),
    ];
    await proposeTrade(state.leagueId, state.teamId, legs, { week: state.week ?? 1 });
    state.tradeMine = [];
    state.tradeTheirs = [];
    return 'Trade proposed.';
  });
}

export async function respond(app, tradeId, action) {
  await act(app, async () => {
    await respondToTrade(state.leagueId, tradeId, state.teamId, action);
    return `Trade ${action}ed.`;
  });
}

async function act(app, fn) {
  state.busy = true;
  state.error = null;
  state.notice = null;
  app?.router?.refresh();
  try {
    state.notice = await fn();
    // Re-read rather than patching local state: the module is authoritative and
    // a claim can legitimately have been resolved between render and click.
    state.claims = state.week ? await listClaims(state.leagueId, state.week).catch(() => null) : null;
    state.trades = await listTrades(state.leagueId).catch(() => []);
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

export { state as _state };
