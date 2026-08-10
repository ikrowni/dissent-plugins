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

import { esc, panel, stateMsg } from '../core/ui.js';
import {
  submitClaim, cancelClaim, listClaims, addPlayer, dropPlayer,
  proposeTrade, respondToTrade, listTrades,
} from '../core/league-api.js';
import { loadIndex, searchPlayers, playerLabel } from '../core/player-index.js';
import { describe } from './league-home.js';

const state = {
  leagueId: null,
  league: null,
  teamId: null,
  week: null,
  claims: null,      // { claims, budgets, pendingCount }
  trades: [],
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
  if (!state.teamId) {
    return panel({ title: 'Moves', body: '<p class="muted">You do not have a team in this league.</p>' });
  }

  return `${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
    ${freeAgentPane()}
    ${claimsPane()}
    ${tradePane()}
    ${tradeListPane()}`;
}

// ── Free agents and waiver claims ────────────────────────────────────────────

function freeAgentPane() {
  const faab = state.league?.settings?.waiverType === 'faab';
  const budget = state.claims?.budgets?.[state.teamId];
  const myRoster = state.league?.assets?.rosters?.[state.teamId]?.players ?? [];

  const rows = state.results.map((p) => `
    <div class="row-btn fa">
      <span class="row-main">${esc(p.name)}</span>
      <span class="muted">${esc(p.position)}${p.team ? ` · ${esc(p.team)}` : ''}</span>
      <button class="btn tiny" data-act="moves-claim" data-player="${esc(p.id)}" ${state.busy ? 'disabled' : ''}>
        ${faab ? 'Bid' : 'Claim'}
      </button>
    </div>`).join('');

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
