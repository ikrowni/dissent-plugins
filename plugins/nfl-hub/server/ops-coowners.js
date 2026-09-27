// server/ops-coowners.js — sharing a team with somebody else.
//
// ⚠️ BOTH DIRECTIONS ARE A HANDSHAKE — never a grant. A user id arriving in a
// payload is the caller's browser talking: the module cannot check it against
// anything, and identity that matters must come from `caller()`.
//
//   member-initiated:  request  → owner approves   (the asker's id is verified)
//   owner-initiated:   invite   → member accepts   (the invitee's id is verified)
//
// An owner may pick somebody from the server's member list (`members:list`, which
// nfl-hub declares — an earlier version of this comment said the SDK could not
// enumerate members; it can). That id still reaches the module through a
// browser, so an invite is only an OFFER: a bogus id makes an invite nobody can
// ever accept, rather than a co-owner who is not a member of the server. Nobody's
// name goes on somebody else's team without their own verified say-so.

import { KEY, read, mutate, loadLeague } from "./store.js";
import { requireUser, requireTeamOwner, teamsOf, isCommissioner } from "./auth.js";

const refuse = (msg) => { throw new Error(msg); };

// ⚠️ A LABEL IS COSMETIC AND SELF-DECLARED. The plugin host cannot resolve
// another user's id to a display name — `profile:read` and `identity:get` both
// return only the caller — so a request carries whatever name the requester's
// own client supplied. It is NEVER authority: every check in this file is on the
// verified id from `caller()`, the label is only ever rendered beside that id,
// and it is escaped and length-capped so "Commissioner" fools nobody.
const MAX_LABEL = 40;
const cleanLabel = (v) => String(v ?? "").trim().slice(0, MAX_LABEL);

const pendingOf = (team) => (team?.coOwnerRequests ?? []).map(normalizeRequest);
const invitesOf = (team) => team?.coOwnerInvites ?? [];

/** Tolerate the bare-id shape a pre-0.9.0 record could hold. */
function normalizeRequest(r) {
  return typeof r === "string" ? { userId: r, label: "", at: 0 } : r;
}

// ⚠️ BOTH CAPS EXIST TO BOUND A SHARED SERVER, not to express a rule about
// fantasy football. Without the pending cap any member can append to any team's
// record for free, which is a griefing vector and an unbounded write.
const MAX_CO_OWNERS = 3;
const MAX_PENDING = 5;

/**
 * Ask to co-own a team, or withdraw a standing request.
 *
 * ⚠️ EVERY CHECK IS INSIDE THE SWAP. Reading the team, deciding it is eligible,
 * then writing would let two concurrent requests both pass the cap — the same
 * lost-update shape `joinLeague` guards against, and the reason `mutate` exists.
 */
export function requestCoOwnership({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse(err);
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const withdraw = payload?.withdraw === true;
  let outcome = null;

  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const team = teams[teamId];
    if (!team) refuse(`no such team: ${teamId}`);

    const pending = pendingOf(team);

    if (withdraw) {
      if (!pending.some((r) => r.userId === p.userId)) { outcome = "not-pending"; return teams; }
      outcome = "withdrawn";
      return {
        ...teams,
        [teamId]: { ...team, coOwnerRequests: pending.filter((r) => r.userId !== p.userId) },
      };
    }

    if (team.ownerId === p.userId) refuse("you already own this team");
    if ((team.coOwners ?? []).includes(p.userId)) { outcome = "already-co-owner"; return teams; }

    // ⚠️ ONE TEAM PER PERSON, and this is the check that keeps it true. A user
    // co-owning a second team could trade with themselves, vote on their own
    // veto, and start two lineups off one waiver budget — and `myTeam()` in the
    // client silently returns whichever came first.
    const mine = teamsOf(teams, p.userId);
    if (mine.length > 0) refuse(`you already manage team ${mine[0]} in this league`);

    if (pending.some((r) => r.userId === p.userId)) { outcome = "already-pending"; return teams; }
    if (pending.length >= MAX_PENDING) refuse("this team has too many pending requests");

    outcome = "requested";
    return {
      ...teams,
      [teamId]: {
        ...team,
        coOwnerRequests: [
          ...pending,
          { userId: p.userId, label: cleanLabel(payload?.label), at: Date.now() },
        ],
      },
    };
  }, {});

  return { leagueId: lg, teamId, outcome };
}

/**
 * Owner or commissioner: approve or decline a standing request.
 *
 * ⚠️ THE ELIGIBILITY CHECK IS REPEATED HERE, not inherited from the request.
 * Between asking and being approved the requester may have joined the league
 * with a team of their own — approving then would hand one person two teams,
 * which is the one thing the request path exists to prevent.
 */
export function respondToCoOwnerRequest({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams: snapshot } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamOwner(p, snapshot, meta, teamId);
  if (err) refuse(err);

  const userId = String(payload?.userId ?? "");
  if (!userId) refuse("userId required");
  const approve = payload?.approve !== false;
  let outcome = null;

  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const team = teams[teamId];
    if (!team) refuse(`no such team: ${teamId}`);

    const pending = pendingOf(team);
    const asked = pending.find((r) => r.userId === userId);
    if (!asked) refuse(`${userId} has no pending request for team ${teamId}`);
    const remaining = pending.filter((r) => r.userId !== userId);

    if (!approve) {
      outcome = "declined";
      return { ...teams, [teamId]: { ...team, coOwnerRequests: remaining } };
    }

    const mine = teamsOf(teams, userId);
    if (mine.length > 0) refuse(`${userId} now manages team ${mine[0]} and cannot co-own another`);

    const coOwners = team.coOwners ?? [];
    if (coOwners.length >= MAX_CO_OWNERS) refuse(`a team may have at most ${MAX_CO_OWNERS} co-owners`);

    outcome = "approved";
    return {
      ...teams,
      [teamId]: {
        ...team,
        coOwners: [...coOwners, userId],
        coOwnerRequests: remaining,
        // Carried across so the UI can name a co-owner it otherwise cannot
        // resolve. Cosmetic — see the note on MAX_LABEL.
        coOwnerLabels: { ...(team.coOwnerLabels ?? {}), [userId]: asked.label },
      },
    };
  }, {});

  return { leagueId: lg, teamId, userId, outcome };
}

/**
 * Remove a co-owner.
 *
 * The owner and a commissioner may remove anyone; a co-owner may remove only
 * themselves. Leaving a team you co-own should never need somebody else's
 * permission — otherwise the way out of a league is to ask the person you are
 * trying to leave.
 */
export function removeCoOwner({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse(err);
  const lg = requireLeagueId(payload);
  const { meta, teams: snapshot } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const userId = String(payload?.userId ?? p.userId);
  const team = snapshot?.[teamId];
  if (!team) refuse(`no such team: ${teamId}`);

  const self = userId === p.userId;
  if (!self && team.ownerId !== p.userId && !isCommissioner(meta, p.userId)) {
    refuse(`only the owner of team ${teamId} can remove its co-owners`);
  }

  // ⚠️ The OWNER is not a co-owner and cannot be removed this way. Dropping them
  // would leave a team nobody owns, which nothing else in the module expects.
  if (team.ownerId === userId) refuse("the owner cannot be removed — transfer the team instead");

  let outcome = null;
  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const current = teams[teamId];
    if (!current) refuse(`no such team: ${teamId}`);
    const coOwners = current.coOwners ?? [];
    if (!coOwners.includes(userId)) { outcome = "not-a-co-owner"; return teams; }
    outcome = "removed";
    const labels = { ...(current.coOwnerLabels ?? {}) };
    delete labels[userId];
    return {
      ...teams,
      [teamId]: { ...current, coOwners: coOwners.filter((u) => u !== userId), coOwnerLabels: labels },
    };
  }, {});

  return { leagueId: lg, teamId, userId, outcome };
}

/**
 * Owner: offer co-ownership to a member, or withdraw an offer.
 *
 * ⚠️ `requireTeamOwner`, the same guard as `respond`: a co-owner must not be able
 * to invite an accomplice.
 * ⚠️ The same refusals as a request, checked INSIDE the swap: nobody who already
 * manages a team, no duplicate, the pending and co-owner caps.
 */
export function inviteCoOwner({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams: snapshot } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamOwner(p, snapshot, meta, teamId);
  if (err) refuse(err);

  const userId = String(payload?.userId ?? "");
  if (!userId) refuse("userId required");
  const withdraw = payload?.withdraw === true;
  let outcome = null;

  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const team = teams[teamId];
    if (!team) refuse(`no such team: ${teamId}`);
    const invites = invitesOf(team);

    if (withdraw) {
      if (!invites.some((i) => i.userId === userId)) { outcome = "not-invited"; return teams; }
      outcome = "withdrawn";
      return { ...teams, [teamId]: { ...team, coOwnerInvites: invites.filter((i) => i.userId !== userId) } };
    }

    if (team.ownerId === userId) refuse("you already own this team");
    if ((team.coOwners ?? []).includes(userId)) { outcome = "already-co-owner"; return teams; }
    const theirs = teamsOf(teams, userId);
    if (theirs.length > 0) refuse(`${userId} already manages team ${theirs[0]} in this league`);
    if (invites.some((i) => i.userId === userId)) { outcome = "already-invited"; return teams; }
    if (invites.length >= MAX_PENDING) refuse("this team has too many pending invites");
    if ((team.coOwners ?? []).length >= MAX_CO_OWNERS) refuse(`a team may have at most ${MAX_CO_OWNERS} co-owners`);

    outcome = "invited";
    return {
      ...teams,
      [teamId]: {
        ...team,
        coOwnerInvites: [...invites, { userId, label: cleanLabel(payload?.label), at: Date.now(), by: p.userId }],
      },
    };
  }, {});

  return { leagueId: lg, teamId, userId, outcome };
}

/**
 * The invitee: accept or decline an offer.
 *
 * ⚠️ `requireUser`, NOT `requireTeamOwner` — the acting principal is the INVITEE,
 * and the subject is `p.userId`, never a payload id. An owner accepting on
 * somebody's behalf is the one thing this handshake exists to prevent.
 * ⚠️ Eligibility is re-checked here, as `respond` does: the invitee may have
 * joined with a team of their own since the offer was made.
 */
export function acceptCoOwnerInvite({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse(err);
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const accept = payload?.accept !== false;
  let outcome = null;

  mutate(KEY.teams(lg), (t) => {
    const teams = t ?? {};
    const team = teams[teamId];
    if (!team) refuse(`no such team: ${teamId}`);
    const invites = invitesOf(team);
    const offer = invites.find((i) => i.userId === p.userId);
    if (!offer) refuse(`you have no invite to team ${teamId}`);
    const remaining = invites.filter((i) => i.userId !== p.userId);

    if (!accept) {
      outcome = "declined";
      return { ...teams, [teamId]: { ...team, coOwnerInvites: remaining } };
    }

    const mine = teamsOf(teams, p.userId);
    if (mine.length > 0) refuse(`you already manage team ${mine[0]} in this league`);
    const coOwners = team.coOwners ?? [];
    if (coOwners.length >= MAX_CO_OWNERS) refuse(`a team may have at most ${MAX_CO_OWNERS} co-owners`);

    outcome = "accepted";
    return {
      ...teams,
      [teamId]: {
        ...team,
        coOwners: [...coOwners, p.userId],
        coOwnerInvites: remaining,
        // A standing request from the same person is answered by this.
        coOwnerRequests: pendingOf(team).filter((r) => r.userId !== p.userId),
        coOwnerLabels: { ...(team.coOwnerLabels ?? {}), [p.userId]: offer.label },
      },
    };
  }, {});

  return { leagueId: lg, teamId, outcome };
}

function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  return lg;
}
