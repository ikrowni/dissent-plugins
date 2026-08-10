// views/league-coowners.js — sharing a team, and asking to share one.
//
// ⚠️ THIS IS A HANDSHAKE, so the UI has three faces rather than one: the owner
// approving, the co-owner already in, and the member with no team who has to ask
// first. The module cannot be handed a user id to trust (see server/ops-coowners.js),
// so there is deliberately no "add someone" control anywhere in here.
//
// ⚠️ A NAME BESIDE AN ID IS A LABEL, NOT AN IDENTITY. The plugin host cannot
// resolve another user's id to a display name, so the label is whatever the
// requester's own client supplied. It is always rendered WITH the id, never
// instead of it — otherwise "Commissioner" as a display name would be a free
// impersonation.

import { esc, panel } from '../core/ui.js';
import {
  requestCoOwnership, withdrawCoOwnershipRequest, respondToCoOwnerRequest, removeCoOwner,
} from '../core/league-api.js';
import { describe } from './league-home.js';
import { getIdentity } from '../../plugin-sdk.js';

const state = {
  busy: null,     // the userId or teamId currently being acted on
  error: null,
  notice: null,
  askTeam: '',    // the team selected in the ask form
};

export function reset() {
  Object.assign(state, { busy: null, error: null, notice: null, askTeam: '' });
}

/** Who am I to this team? */
export function roleOf(league, teamId) {
  const team = league?.teams?.[String(teamId)];
  if (!team || !league?.me) return null;
  if (team.ownerId === league.me) return 'owner';
  if ((team.coOwners ?? []).includes(league.me)) return 'co-owner';
  return null;
}

/** The team this user owns outright, if any. */
export function ownedTeam(league) {
  return Object.values(league?.teams ?? {}).find((t) => t.ownerId === league?.me) ?? null;
}

/** The team this user co-owns, if any. */
export function coOwnedTeam(league) {
  return Object.values(league?.teams ?? {})
    .find((t) => (t.coOwners ?? []).includes(league?.me)) ?? null;
}

/** The team this user has a standing request against, if any. */
export function pendingTeam(league) {
  return Object.values(league?.teams ?? {})
    .find((t) => (t.coOwnerRequests ?? []).some((r) => r.userId === league?.me)) ?? null;
}

export function render(league) {
  // ⚠️ `me` arrives only from module 0.9.0 onward. Against an older module every
  // role check would silently answer "nobody", so the section hides itself
  // rather than rendering a panel where no button can ever be right.
  if (!league?.me) return '';

  const owned = ownedTeam(league);
  const co = coOwnedTeam(league);

  return panel({
    title: 'Co-managers',
    body: `
      ${state.error ? `<p class="muted">${esc(state.error)}</p>` : ''}
      ${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
      ${owned ? ownerFace(league, owned) : ''}
      ${co ? coOwnerFace(co) : ''}
      ${!owned && !co ? askFace(league) : ''}`,
  });
}

/** The owner's view: who shares the team, and who has asked to. */
function ownerFace(league, team) {
  const coOwners = team.coOwners ?? [];
  const pending = team.coOwnerRequests ?? [];

  const current = coOwners.length === 0
    ? '<p class="muted">Nobody co-manages this team yet.</p>'
    : `<table class="tbl"><tbody>${coOwners.map((uid) => `
        <tr>
          <td>${person(uid, team.coOwnerLabels?.[uid])}</td>
          <td class="num">
            <button class="btn" data-act="co-remove" data-team="${esc(team.id)}" data-user="${esc(uid)}"
                    ${state.busy === uid ? 'disabled' : ''}>
              ${state.busy === uid ? 'Removing…' : 'Remove'}
            </button>
          </td>
        </tr>`).join('')}</tbody></table>`;

  const asks = pending.length === 0
    ? `<p class="muted">No pending requests. Another member of ${esc(league.settings?.name ?? 'the league')}
       can ask from their own League tab.</p>`
    : `<table class="tbl"><tbody>${pending.map((r) => `
        <tr>
          <td>${person(r.userId, r.label)}</td>
          <td class="num">
            <button class="btn primary" data-act="co-approve" data-team="${esc(team.id)}" data-user="${esc(r.userId)}"
                    ${state.busy === r.userId ? 'disabled' : ''}>Approve</button>
            <button class="btn" data-act="co-decline" data-team="${esc(team.id)}" data-user="${esc(r.userId)}"
                    ${state.busy === r.userId ? 'disabled' : ''}>Decline</button>
          </td>
        </tr>`).join('')}</tbody></table>`;

  return `
    <p class="muted">A co-manager can set your lineup, make claims and propose trades.
       They cannot add or remove other co-managers.</p>
    <h4>Co-managers of ${esc(team.name)}</h4>
    ${current}
    <h4>Requests</h4>
    ${asks}`;
}

/** Somebody else's team, which I help run. */
function coOwnerFace(team) {
  return `
    <p>You co-manage <strong>${esc(team.name)}</strong>.</p>
    <p class="muted">You can set the lineup and make moves. Only the owner can change who else co-manages it.</p>
    <button class="btn" data-act="co-leave" data-team="${esc(team.id)}" ${state.busy ? 'disabled' : ''}>
      ${state.busy ? 'Leaving…' : 'Stop co-managing'}
    </button>`;
}

/** No team of my own: ask to share one. */
function askFace(league) {
  const waiting = pendingTeam(league);
  if (waiting) {
    return `
      <p>You have asked to co-manage <strong>${esc(waiting.name)}</strong>.</p>
      <p class="muted">Its owner has to approve before anything changes.</p>
      <button class="btn" data-act="co-withdraw" data-team="${esc(waiting.id)}" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? 'Withdrawing…' : 'Withdraw request'}
      </button>`;
  }

  const teams = Object.values(league.teams ?? {});
  if (teams.length === 0) return '<p class="muted">There are no teams to co-manage yet.</p>';

  return `
    <p class="muted">You have no team in this league. You can ask to co-manage somebody else’s —
       they have to agree before anything changes.</p>
    <div class="row-actions">
      <select data-act="co-pick-team">
        <option value="">Choose a team…</option>
        ${teams.map((t) => `<option value="${esc(t.id)}" ${state.askTeam === t.id ? 'selected' : ''}>
          ${esc(t.name)}</option>`).join('')}
      </select>
      <button class="btn primary" data-act="co-ask" ${!state.askTeam || state.busy ? 'disabled' : ''}>
        ${state.busy ? 'Asking…' : 'Ask to co-manage'}
      </button>
    </div>`;
}

/**
 * ⚠️ ALWAYS BOTH. The label is self-declared and unverifiable; the id is the
 * only thing the module acted on. Showing the label alone would let anyone
 * choose how they appear in an approval prompt.
 */
function person(userId, label) {
  const name = String(label ?? '').trim();
  return name
    ? `${esc(name)} <span class="muted">${esc(userId)}</span>`
    : `<span class="mono">${esc(userId)}</span>`;
}

// ── Actions ──────────────────────────────────────────────────────────────────
//
// Each one runs the call, then asks the caller to reload the league, because the
// module's copy of `teams` is the only authority on who manages what — patching
// the local object would show an approval that the module may have refused.

/** Remember which team the ask form has selected. */
export function pickTeam(app, teamId) {
  state.askTeam = String(teamId ?? '');
  app?.router?.refresh();
}

export const ask = (app, ctx) => {
  const teamId = state.askTeam;
  return run(app, ctx, teamId, async () => {
    // Best effort only: a request with no label is perfectly valid, and the
    // owner then sees the bare id. Failing the whole ask because a display name
    // could not be read would be the wrong trade.
    const label = await getIdentity().then((i) => i?.displayName ?? '').catch(() => '');
    return requestCoOwnership(ctx.leagueId, teamId, label);
  }, 'Asked. The owner has to approve it.');
};

export const withdraw = (app, ctx, teamId) =>
  run(app, ctx, teamId, () => withdrawCoOwnershipRequest(ctx.leagueId, teamId), 'Request withdrawn.');

export const approve = (app, ctx, teamId, userId) =>
  run(app, ctx, userId, () => respondToCoOwnerRequest(ctx.leagueId, teamId, userId, true),
    'They can now co-manage the team.');

export const decline = (app, ctx, teamId, userId) =>
  run(app, ctx, userId, () => respondToCoOwnerRequest(ctx.leagueId, teamId, userId, false),
    'Request declined.');

export const remove = (app, ctx, teamId, userId) =>
  run(app, ctx, userId, () => removeCoOwner(ctx.leagueId, teamId, userId), 'Co-manager removed.');

/** Leave a team you co-manage. The module takes the caller as the subject. */
export const leave = (app, ctx, teamId) =>
  run(app, ctx, teamId, () => removeCoOwner(ctx.leagueId, teamId, null), 'You no longer co-manage that team.');

async function run(app, ctx, busyKey, call, notice) {
  state.busy = busyKey ?? true;
  state.error = null;
  state.notice = null;
  app?.router?.refresh();
  try {
    await call();
    state.notice = notice;
    state.askTeam = '';
    await ctx.reload();
  } catch (err) {
    // ⚠️ The module's own message, not a generic one. Its refusals name the
    // reason — "you already manage team t2", "a team may have at most 3
    // co-owners" — and that is the whole explanation the user gets.
    state.error = describe(err);
  } finally {
    state.busy = null;
    app?.router?.refresh();
  }
}

export { state as _state };
