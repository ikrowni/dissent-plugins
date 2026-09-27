// views/league-coowners.js — sharing a team, and asking to share one.
//
// ⚠️ BOTH DIRECTIONS ARE A HANDSHAKE (see server/ops-coowners.js), so the UI has
// four faces: the owner (approve requests, send invites), the co-owner already
// in, the member holding an invite, and the member with no team who can ask.
// An owner picks an invitee from the server's members, but that only makes an
// OFFER — the person accepts from their own session before anything changes.
// There is still no free-text id field anywhere in here.
//
// ⚠️ A NAME BESIDE AN ID IS A LABEL, NOT AN IDENTITY. The plugin host cannot
// resolve another user's id to a display name, so the label is whatever the
// requester's own client supplied. It is always rendered WITH the id, never
// instead of it — otherwise "Commissioner" as a display name would be a free
// impersonation.

import { esc, panel } from '../core/ui.js';
import {
  requestCoOwnership, withdrawCoOwnershipRequest, respondToCoOwnerRequest, removeCoOwner,
  inviteCoOwner, withdrawCoOwnerInvite, answerCoOwnerInvite,
} from '../core/league-api.js';
import { describe } from './league-home.js';
import { getIdentity, request } from '../../plugin-sdk.js';

const state = {
  busy: null,     // the userId or teamId currently being acted on
  error: null,
  notice: null,
  askTeam: '',    // the team selected in the ask form
  inviteUser: '', // the member selected in the owner's invite form
  members: null,  // the server's members (members:list), or null until loaded
};

export function reset() {
  Object.assign(state, { busy: null, error: null, notice: null, askTeam: '', inviteUser: '' });
}

/**
 * Load the server's members once, for the owner's invite picker. Best effort: without
 * them the owner can still approve requests, and the picker says it is unavailable.
 */
export async function loadMembers(app) {
  try {
    const res = await request('members:list', {});
    state.members = Array.isArray(res?.members) ? res.members : [];
  } catch {
    state.members = [];
  }
  app?.router?.refresh();
}

/** Teams that have invited me, if any. */
export function invitedTeams(league) {
  return Object.values(league?.teams ?? {})
    .filter((t) => (t.coOwnerInvites ?? []).some((i) => i.userId === league?.me));
}

/**
 * Who the owner may usefully invite: members holding no team in this league, not
 * already invited to this one, and not the owner. The module re-checks every one of
 * these — this only keeps impossible choices out of the picker.
 */
export function inviteCandidates(league, team, members = state.members) {
  const busy = new Set();
  for (const t of Object.values(league?.teams ?? {})) {
    busy.add(t.ownerId);
    for (const u of t.coOwners ?? []) busy.add(u);
  }
  const invited = new Set((team?.coOwnerInvites ?? []).map((i) => i.userId));
  return (members ?? []).filter((m) => m?.id && !busy.has(m.id) && !invited.has(m.id));
}

const memberName = (m) => String(m?.display_name || m?.username || m?.id || '');

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
      ${!owned && !co ? inviteeFace(league) + askFace(league) : ''}`,
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

  const invites = team.coOwnerInvites ?? [];
  const sent = invites.length === 0 ? '' : `
    <h4>Invites waiting for an answer</h4>
    <table class="tbl"><tbody>${invites.map((i) => `
        <tr>
          <td>${person(i.userId, i.label)}</td>
          <td class="num">
            <button class="btn" data-act="co-uninvite" data-team="${esc(team.id)}" data-user="${esc(i.userId)}"
                    ${state.busy === i.userId ? 'disabled' : ''}>Withdraw</button>
          </td>
        </tr>`).join('')}</tbody></table>`;

  const asks = pending.length === 0
    ? '<p class="muted">Nobody has asked yet. When somebody does, Approve and Decline appear here.</p>'
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

  // ⚠️ THIS SECTION LEADS, AND IT EXISTS BECAUSE THE OWNER COULD NOT FIND ANY OF
  // THIS. The panel used to open with two empty tables and not one button, and the
  // word "add" appeared nowhere. Now it opens with the invite control itself.
  //
  // ⚠️ A DROPDOWN, NOT A LIST. Listing the server's members was tried and the owner
  // asked for it gone — a wall of names is not an instruction.
  return `
    <h4>Add a co-manager</h4>
    <p class="muted">Invite someone from this server — they accept before anything changes.
       Or they can ask from <strong>Fantasy → League</strong>, and it appears below for you
       to approve.</p>
    ${invitePicker(league, team)}
    ${sent}
    <h4>Co-managers of ${esc(team.name)}</h4>
    ${current}
    <h4>Requests to approve</h4>
    ${asks}
    <p class="tiny">A co-manager can set your lineup, make claims and propose trades.
       They cannot add or remove other co-managers, and you can remove them at any
       time from the list above.</p>`;
}

/** The owner's invite control: one member picker and one button. */
function invitePicker(league, team) {
  if ((team.coOwners ?? []).length >= 3) {
    return '<p class="muted">This team already has the most co-managers it can.</p>';
  }
  if (state.members === null) return '<p class="muted">Loading this server’s members…</p>';
  const choices = inviteCandidates(league, team);
  if (choices.length === 0) {
    return '<p class="muted">Everyone on this server already has a team or an invite.</p>';
  }
  return `
    <div class="row-actions">
      <select data-act="co-pick-member">
        <option value="">Choose someone…</option>
        ${choices.map((m) => `<option value="${esc(m.id)}" ${state.inviteUser === m.id ? 'selected' : ''}>
          ${esc(memberName(m))}</option>`).join('')}
      </select>
      <button class="btn primary" data-act="co-invite" data-team="${esc(team.id)}"
              ${!state.inviteUser || state.busy ? 'disabled' : ''}>
        ${state.busy === state.inviteUser && state.inviteUser ? 'Inviting…' : 'Invite'}
      </button>
    </div>`;
}

/** Offers waiting for ME: who invited me, to which team, Accept or Decline. */
function inviteeFace(league) {
  return invitedTeams(league).map((t) => {
    const offer = (t.coOwnerInvites ?? []).find((i) => i.userId === league.me);
    const by = offer?.by ?? t.ownerId;
    const byName = memberName((state.members ?? []).find((m) => m.id === by));
    return `
      <p>You have been invited to co-manage <strong>${esc(t.name)}</strong>
         by ${person(by, byName === by ? '' : byName)}.</p>
      <div class="row-actions">
        <button class="btn primary" data-act="co-accept" data-team="${esc(t.id)}" ${state.busy ? 'disabled' : ''}>Accept</button>
        <button class="btn" data-act="co-refuse" data-team="${esc(t.id)}" ${state.busy ? 'disabled' : ''}>Decline</button>
      </div>`;
  }).join('');
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

/** Remember which member the invite form has selected. */
export function pickMember(app, userId) {
  state.inviteUser = String(userId ?? '');
  app?.router?.refresh();
}

export const invite = (app, ctx, teamId) => {
  const userId = state.inviteUser;
  // The label is the picked member's display name — cosmetic, shown beside the id.
  const label = memberName((state.members ?? []).find((m) => m.id === userId));
  return run(app, ctx, userId, () => inviteCoOwner(ctx.leagueId, teamId, userId, label),
    'Invited. They have to accept before anything changes.');
};

export const uninvite = (app, ctx, teamId, userId) =>
  run(app, ctx, userId, () => withdrawCoOwnerInvite(ctx.leagueId, teamId, userId), 'Invite withdrawn.');

export const acceptInvite = (app, ctx, teamId) =>
  run(app, ctx, teamId, () => answerCoOwnerInvite(ctx.leagueId, teamId, true), 'You now co-manage that team.');

export const refuseInvite = (app, ctx, teamId) =>
  run(app, ctx, teamId, () => answerCoOwnerInvite(ctx.leagueId, teamId, false), 'Invite declined.');

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
    state.inviteUser = '';
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
