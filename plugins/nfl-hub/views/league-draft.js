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
import { getDraft, makePick, startDraft, setPaused, finalizeDraft, formatClock } from '../core/league-api.js';
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
};

let timer = null;

export function reset() {
  stopPolling();
  Object.assign(state, {
    leagueId: null, league: null, teamId: null, draft: null,
    error: null, busy: false, notice: null, localDeadline: null,
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
  if (!state.draft) return stateMsg('Loading the draft…', { spinner: true });

  const d = state.draft;
  if (d.status === 'pre') return prePane(d);
  if (d.status === 'complete') return completePane(d);
  return livePane(d);
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

function pickForm() {
  return `
    <form data-act="draft-pick-form" class="row">
      <input name="playerId" placeholder="Player id" required>
      <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? 'Picking…' : 'Draft'}
      </button>
    </form>`;
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
        <td>${esc(String(p.playerId))}</td>
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
    // Re-anchor the local countdown to the server's answer on every poll.
    state.localDeadline = d.msRemaining === null || d.msRemaining === undefined
      ? null
      : Date.now() + d.msRemaining;
    if (d.autoPicked?.length) {
      state.notice = `${d.autoPicked.length} pick${d.autoPicked.length === 1 ? '' : 's'} auto-drafted after the clock expired.`;
    }
  } catch (err) {
    state.error = describe(err);
    stopPolling();
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function load(app, { leagueId, league, teamId }) {
  Object.assign(state, { leagueId, league, teamId, error: null, notice: null });
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
