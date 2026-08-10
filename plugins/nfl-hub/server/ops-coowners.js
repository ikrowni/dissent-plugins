// server/ops-coowners.js — sharing a team with somebody else.
//
// ⚠️ IT IS A HANDSHAKE, NOT AN INVITE. The obvious design — the owner names a
// user id and that user becomes a co-owner — cannot work here, for two separate
// reasons that both point the same way:
//
//   1. The module has NO USER DIRECTORY. It has `caller()` and storage, and
//      nothing else. A user id arriving in a payload cannot be checked against
//      anything, so an owner could attach a typo, a stranger, or a person who
//      never agreed, and the module would store it as fact.
//   2. Identity that matters must come from `caller()`. A pasted id is the
//      caller's browser talking; a verified session is the node talking.
//
// So the prospective co-owner asks first — which records THEIR verified id — and
// the owner approves from that list. Both halves are consented and both ids are
// real. It also means the UI needs no member picker, which is just as well,
// because the plugin SDK cannot enumerate a server's members either.

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

function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  return lg;
}
