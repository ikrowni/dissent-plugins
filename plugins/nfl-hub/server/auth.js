// server/auth.js — who may do what.
//
// ⚠️ IDENTITY COMES FROM `caller()`, NEVER FROM THE PAYLOAD. The payload is the
// caller's browser talking; a user id taken from there can be anything they
// like, and every member of the server could act as every other. `caller()` is
// the node's verified session.
//
// ⚠️ A SCHEDULED RUN HAS NO USER, and that is not a special case to smooth over.
// A timer must not inherit the authority of whoever happened to invoke last, so
// user-scoped operations refuse outright when there is no caller, and the
// operations a timer IS allowed to perform are named explicitly.

/** Nobody: a scheduled run's authority. */
export const SCHEDULED = Object.freeze({ userId: null, scheduled: true });

/** Resolve the acting principal from the host. */
export function principal(callerFn) {
  const c = callerFn();
  return {
    userId: c?.user_id ?? null,
    scheduled: (c?.trigger ?? "invoke") === "schedule",
  };
}

/** Every team this user controls — owner or co-owner. */
export function teamsOf(teams, userId) {
  if (!userId) return [];
  return Object.entries(teams ?? {})
    .filter(([, t]) => t.ownerId === userId || (t.coOwners ?? []).includes(userId))
    .map(([id]) => id);
}

/** Does this user control this team? Co-owners count; that is what co-owning is. */
export function controlsTeam(teams, userId, teamId) {
  if (!userId) return false;
  const t = teams?.[String(teamId)];
  if (!t) return false;
  return t.ownerId === userId || (t.coOwners ?? []).includes(userId);
}

/** Is this user a commissioner of the league? */
export function isCommissioner(meta, userId) {
  if (!userId) return false;
  return (meta?.commissioners ?? []).includes(userId);
}

/**
 * Guard a user-scoped operation.
 *
 * Returns null when allowed, or an error string. Errors rather than throws
 * because a refusal is an ordinary outcome the caller reports back as data.
 */
export function requireUser(p) {
  if (p.scheduled) return "this operation cannot run on a schedule";
  if (!p.userId) return "not authenticated";
  return null;
}

/** Guard an operation on a specific team. */
export function requireTeamControl(p, teams, meta, teamId) {
  const err = requireUser(p);
  if (err) return err;
  // A commissioner may act for any team — that is the point of the role — but
  // the ACTION is still audited against them, not the team's owner.
  if (isCommissioner(meta, p.userId)) return null;
  if (!controlsTeam(teams, p.userId, teamId)) return `you do not manage team ${teamId}`;
  return null;
}

/**
 * Guard an operation only a team's OWNER (or a commissioner) may perform.
 *
 * ⚠️ NOT `requireTeamControl`. That one admits co-owners, which is right for
 * playing the team — setting a lineup, making a claim — and wrong for changing
 * who else may play it. A co-owner who could approve co-owners could add an
 * accomplice, then be removed by the owner and still control the team through
 * them. Granting authority is the owner's alone.
 */
export function requireTeamOwner(p, teams, meta, teamId) {
  const err = requireUser(p);
  if (err) return err;
  if (isCommissioner(meta, p.userId)) return null;
  const t = teams?.[String(teamId)];
  if (!t) return `no such team: ${teamId}`;
  if (t.ownerId !== p.userId) return `only the owner of team ${teamId} can do that`;
  return null;
}

/** Guard a commissioner-only operation. */
export function requireCommissioner(p, meta) {
  const err = requireUser(p);
  if (err) return err;
  if (!isCommissioner(meta, p.userId)) return "commissioner only";
  return null;
}

/**
 * Guard an operation only the scheduler may perform.
 *
 * ⚠️ Waiver processing, lineup locks and scoring runs are NOT user operations.
 * Letting a user trigger them would let the first manager awake on Wednesday
 * decide when waivers clear.
 */
export function requireScheduled(p) {
  return p.scheduled ? null : "this operation runs on a schedule, not on request";
}
