// views/league-draft.js — the draft board and its clock.
//
// ⚠️ THE CLOCK IS THE SERVER'S, NOT THE BROWSER'S. `msRemaining` comes from the
// module on every poll and is counted down locally only between polls, purely so
// the digits move. A purely local timer would drift, and worse, would let two
// managers see different times for the same pick.
//
// ⚠️ POLLING IS WHAT ADVANCES THE CLOCK. Every `draft:get` resolves lapsed picks
// server-side, which is the whole deadline-on-read design: the node's scheduler
// floor is five minutes and cannot drive a 90-second timer, so the board being
// open is what keeps a live draft moving.

import { esc, panel, stateMsg } from '../core/ui.js';
import {
  getDraft, makePick, startDraft, setPaused, finalizeDraft, formatClock, createDraft,
} from '../core/league-api.js';
import { loadIndex, searchPlayers, playerLabel } from '../core/player-index.js';
import { describe } from './league-home.js';

const POLL_MS = 3000;

const state = {
  leagueId: null,
  league: null,
  teamId: null,
  draft: null,
  error: null,
  busy: false,
  notice: null,
  localDeadline: null, // epoch ms, refreshed from the server on every poll
  query: '',
  results: [],
  // ⚠️ "No draft yet" is a STATE, not an error. The module refuses `draft:get`
  // for a league that has never created one, and rendering that refusal as an
  // error pane left a commissioner staring at "Try again" — a button that could
  // never work, on the one screen that needed a "Create draft" instead.
  noDraft: false,
};

let timer = null;

export function reset() {
  stopPolling();
  Object.assign(state, {
    leagueId: null, league: null, teamId: null, draft: null,
    error: null, busy: false, notice: null, localDeadline: null, query: '', results: [],
    noDraft: false,
  });
}

export function render() {
  if (state.error) {
    return panel({
      title: 'Draft',
      body: `<p class="muted">${esc(state.error)}</p>
             <button class="btn" data-act="draft-retry">Try again</button>`,
    });
  }
  if (state.noDraft) return noDraftPane();
  if (!state.draft) return stateMsg('Loading the draft…', { spinner: true });

  const d = state.draft;
  if (d.status === 'pre') return prePane(d);
  if (d.status === 'complete') return completePane(d);
  return livePane(d);
}

/**
 * No draft exists yet — the state every new league starts in.
 *
 * ⚠️ A COMMISSIONER GETS THE BUTTON THAT FIXES IT. This used to render as an
 * error with "Try again", which is the least useful thing to show somebody who
 * is the only person able to act.
 */
function noDraftPane() {
  const teams = Object.keys(state.league?.teams ?? {}).length;
  return panel({
    title: 'Draft',
    body: `
      <p class="muted">No draft has been set up for this league yet.</p>
      ${teams < 2
    ? `<p class="muted">A draft needs at least two teams — this league has ${teams}.
         Invite people to the server and have them join from the League tab.</p>`
    : ''}
      ${state.league?.isCommissioner
    ? `<button class="btn primary" data-act="draft-create" ${state.busy || teams < 2 ? 'disabled' : ''}>
         ${state.busy ? 'Creating…' : 'Create draft'}
       </button>`
    : '<p class="muted">A commissioner needs to create it.</p>'}`,
  });
}

function prePane(d) {
  return panel({
    title: 'Draft',
    body: `
      <p class="muted">${d.order.length} picks over ${d.rounds} round${d.rounds === 1 ? '' : 's'},
      ${esc(d.type)} order. Pick clock ${d.pickTimerSeconds}s.</p>
      ${d.isCommissioner
    ? `<button class="btn primary" data-act="draft-start" ${state.busy ? 'disabled' : ''}>Start draft</button>`
    : '<p class="muted">Waiting for the commissioner to start.</p>'}`,
  });
}

function completePane(d) {
  return panel({
    title: 'Draft complete',
    body: `
      ${picksTable(d)}
      ${d.isCommissioner
    ? `<button class="btn primary" data-act="draft-finalize" ${state.busy ? 'disabled' : ''}>
         Move picks onto rosters
       </button>`
    : ''}`,
  });
}

function livePane(d) {
  const onClock = d.onClock;
  const mine = onClock && String(onClock.teamId) === String(state.teamId);
  const remaining = state.localDeadline === null ? null : state.localDeadline - Date.now();

  return panel({
    title: 'Draft',
    right: `<span class="clock ${remaining !== null && remaining < 15000 ? 'urgent' : ''}">${formatClock(remaining)}</span>`,
    body: `
      ${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
      <p>
        ${onClock
    ? `Round ${onClock.round}, pick ${onClock.overall} — <strong>${esc(teamName(onClock.teamId))}</strong>
           ${mine ? '<span class="you">it is your pick</span>' : ''}`
    : 'Waiting…'}
      </p>
      ${mine ? pickForm() : ''}
      ${d.isCommissioner ? `
        <div class="row-actions">
          <button class="btn tiny" data-act="draft-pause" data-paused="${d.status === 'paused'}">
            ${d.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </div>` : ''}
      ${picksTable(d)}`,
  });
}

/**
 * Search-and-pick.
 *
 * ⚠️ THE LIST EXCLUDES PLAYERS ALREADY DRAFTED. Offering one produces a refusal
 * on every click, and the manager cannot tell whether they mistyped or somebody
 * beat them to him — which, on a live clock, is the worst possible ambiguity.
 */
function pickForm() {
  const rows = state.results.map((p) => `
    <button class="row-btn pick" data-act="draft-pick-player" data-player="${esc(p.id)}"
            ${state.busy ? 'disabled' : ''}>
      <span class="row-main">${esc(p.name)}</span>
      <span class="muted">${esc(p.position)}${p.team ? ` · ${esc(p.team)}` : ''}</span>
    </button>`).join('');

  return `
    <div class="pick-box">
      <input type="search" data-act="draft-search" placeholder="Search players…"
             value="${esc(state.query)}" autocomplete="off" ${state.busy ? 'disabled' : ''}>
      ${state.query.trim().length < 2
    ? '<p class="muted">Type at least two letters.</p>'
    : (rows || '<p class="muted">No available player matches that.</p>')}
    </div>`;
}

function picksTable(d) {
  const made = Object.entries(d.picks ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  if (made.length === 0) return '<p class="muted">No picks yet.</p>';
  return `<table class="tbl">
    <thead><tr><th>#</th><th>Team</th><th>Player</th><th></th></tr></thead>
    <tbody>${made.map(([overall, p]) => `
      <tr>
        <td class="num">${esc(overall)}</td>
        <td>${esc(teamName(p.teamId))}</td>
        <td>${esc(playerLabel(p.playerId))}</td>
        <td class="muted">${p.auto ? 'auto' : ''}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

function teamName(teamId) {
  return state.league?.teams?.[String(teamId)]?.name ?? String(teamId);
}

// ── Polling ──────────────────────────────────────────────────────────────────

function startPolling(app) {
  stopPolling();
  timer = setInterval(() => {
    // Only poll while a draft is actually running. A finished or unstarted draft
    // does not change on its own, and polling it burns the install's daily
    // invocation allowance for nothing.
    if (state.draft && (state.draft.status === 'active')) {
      poll(app);
    } else if (state.draft && state.draft.status !== 'pre') {
      stopPolling();
    }
    app?.router?.refresh();
  }, POLL_MS);
}

export function stopPolling() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function poll(app) {
  try {
    const d = await getDraft(state.leagueId);
    state.draft = d;
    state.noDraft = false;
    // Re-anchor the local countdown to the server's answer on every poll.
    state.localDeadline = d.msRemaining === null || d.msRemaining === undefined
      ? null
      : Date.now() + d.msRemaining;
    if (d.autoPicked?.length) {
      state.notice = `${d.autoPicked.length} pick${d.autoPicked.length === 1 ? '' : 's'} auto-drafted after the clock expired.`;
    }
  } catch (err) {
    // ⚠️ A league with no draft is not a failure, and polling it forever is
    // pointless — the answer cannot change until somebody creates one.
    if (/no draft/i.test(String(err?.message ?? err))) {
      state.noDraft = true;
      state.draft = null;
      state.error = null;
    } else {
      state.error = describe(err);
    }
    stopPolling();
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function load(app, { leagueId, league, teamId }) {
  Object.assign(state, { leagueId, league, teamId, error: null, notice: null, query: '', results: [] });
  // Names and search both need the index; a draft board showing raw ids is
  // unusable even though it is technically correct.
  await loadIndex();
  await poll(app);
  startPolling(app);
  app?.router?.refresh();
}

/** Every id already drafted — the set the search must exclude. */
export function takenIds() {
  return new Set(Object.values(state.draft?.picks ?? {}).map((p) => String(p.playerId)));
}

/**
 * Filter as the manager types.
 *
 * ⚠️ THE HUB RE-RENDERS THE WHOLE VIEW, which destroys the input element. Without
 * restoring focus and the caret, the box loses focus after EVERY keystroke and is
 * unusable while appearing to work perfectly in a screenshot. Restoring is done
 * synchronously after the refresh, before the browser paints.
 */
export function search(app, query, caret = null) {
  state.query = String(query ?? '');
  state.results = searchPlayers(state.query, { taken: takenIds(), limit: 10 });
  app?.router?.refresh();
  restoreSearchFocus(caret);
}

/** Put focus and the caret back after a re-render. */
export function restoreSearchFocus(caret = null) {
  if (typeof document === 'undefined') return;
  const el = document.querySelector('[data-act="draft-search"]');
  if (!el) return;
  el.focus();
  const pos = caret === null ? el.value.length : caret;
  try { el.setSelectionRange(pos, pos); } catch { /* not all inputs support it */ }
}

/** Commissioner: create the draft this league has never had. */
export async function create(app) {
  await act(app, async () => {
    await createDraft(state.leagueId);
    state.noDraft = false;
  }, 'Draft created.');
  // Polling stopped when the draft turned out not to exist; restart it now that
  // one does, or the board never updates.
  await poll(app);
  startPolling(app);
  app?.router?.refresh();
}

export async function start(app) { await act(app, () => startDraft(state.leagueId)); }
export async function pause(app, paused) { await act(app, () => setPaused(state.leagueId, paused)); }
export async function finalize(app) {
  await act(app, () => finalizeDraft(state.leagueId), 'Rosters updated from the draft.');
}

export async function pick(app, playerId) {
  await act(app, () => makePick(state.leagueId, state.teamId, playerId), 'Pick made.');
  // Re-filter against the new picks, so the player just taken leaves the list
  // rather than sitting there inviting a second click.
  if (state.query) state.results = searchPlayers(state.query, { taken: takenIds(), limit: 10 });
  app?.router?.refresh();
}

async function act(app, fn, notice = null) {
  state.busy = true;
  state.error = null;
  app?.router?.refresh();
  try {
    await fn();
    state.notice = notice;
    await poll(app);
    if (state.draft?.status === 'active') startPolling(app);
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

export { state as _state };
