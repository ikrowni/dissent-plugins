// server/ops-identity.js — what a team and a league LOOK like, and who may say so.
//
// Three ops, kept apart from ops-league.js because they answer a different
// question. That file is about playing the league — rosters, lineups, schedules;
// this one is about identity, which has its own authorisation rule (see
// `requireTeamOwner` below) and its own storage rule (see below).
//
// ⚠️ THE RULES THEMSELVES ARE IN `core/league/team-identity.js`, pure and shared
// with the browser, for the reason every other core/league module is: the client
// must be able to check a name without asking, and two definitions of "legal
// name" is how the two halves start disagreeing. This file is the guards, the
// atomicity and the refusals.
//
// ⚠️ AN IMAGE IS A FILE ID, NEVER A URL, AND NEVER BYTES. Three separate reasons,
// all of which have to hold:
//
//   1. Bytes are out because `store.js` values are capped by the host and
//      encrypted at rest. An avatar is not league state.
//   2. A URL is out because a team record is rendered into every other manager's
//      DOM. An arbitrary URL there is a tracking pixel that fires for the whole
//      league every time the standings paint, and a module cannot tell a node URL
//      from a lookalike by string inspection.
//   3. ⚠️ "Just pin it to the upload's host" DOES NOT WORK, and this was checked
//      rather than assumed. `files:upload` returns `storage.Global.PutStream`'s
//      public URL — a STORAGE-origin URL. That origin is operator-configurable
//      (BYO-S3), is absent from the plugin iframe's CSP `img-src`, and on this
//      node the bucket is private so the URL 403s. dissent-core says so itself in
//      `GetPluginFileURL`: "a presigned STORAGE-origin URL cannot survive the
//      plugin CSP … hand out a signed node URL that streams instead."
//
// So the record holds the node's own opaque file id and the CLIENT redeems it for
// a short-lived signed node URL at render time (`files:getUrl`). The node
// re-checks server membership on that exchange — an authorisation this module
// could not perform. It is the pattern dnd-hub already proved: store the
// `fileId`, resolve it per render.

import { KEY, read, mutate } from "./store.js";
import { requireTeamOwner, requireCommissioner } from "./auth.js";
import { checkTeamName, checkFileId, nameTaken } from "../core/league/team-identity.js";

const refuse = (msg) => { throw new Error(msg); };

/** Apply a pure check, or turn its refusal into the op's error. */
function must(result) {
  if (!result.ok) refuse(result.error);
  return result;
}

/**
 * Rename a team.
 *
 * ⚠️ `requireTeamOwner`, NOT `requireTeamControl`. A co-owner sets lineups and
 * makes claims — playing the team — and renaming the franchise is not playing it.
 * The same reasoning auth.js already applies to granting co-ownership: the
 * identity of a team belongs to whoever owns it. A commissioner still passes,
 * which is what the role is for.
 *
 * ⚠️ CONTENDED KEY. `KEY.teams(lg)` is ONE record holding every team and every
 * join writes it, so the whole read-check-write goes through `mutate` (it is in
 * `CONTENDED` in store.js). A plain `set` here loses a concurrent join silently —
 * no error, no trace, one manager simply not in the league any more.
 *
 * ⚠️ THE DUPLICATE CHECK IS INSIDE THE SWAP for the same reason: outside it, two
 * teams renaming to the same thing at the same moment would both pass, which is
 * precisely the case the rule exists to stop.
 */
export function renameTeam({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const teams = read(KEY.teams(lg), {});

  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamOwner(p, teams, meta, teamId);
  if (err) refuse(err);

  const { name } = must(checkTeamName(payload?.name));

  mutate(KEY.teams(lg), (cur) => {
    const current = cur ?? {};
    const team = current[teamId];
    if (!team) refuse(`no such team: ${teamId}`);
    const clash = nameTaken(current, name, teamId);
    // ⚠️ NAMES THE CLASHING TEAM, and prints THEIR spelling — the clash is
    // case-insensitive, so "that name is taken" would send somebody hunting
    // through the standings for a name that does not appear there verbatim.
    if (clash) refuse(`"${name}" clashes with team ${clash} ("${current[clash].name}")`);
    return { ...current, [teamId]: { ...team, name } };
  }, {});

  return { leagueId: lg, teamId, name };
}

/**
 * Set (or clear) a team's avatar and banner.
 *
 * ⚠️ ABSENT AND EMPTY MEAN DIFFERENT THINGS. A field the payload omits is left
 * alone; a field set to "" is CLEARED. Without that distinction there is no way
 * to remove an avatar without also removing the banner, and no way to set one
 * without re-sending the other — which a stale render would then get wrong.
 */
export function setTeamIdentity({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const teams = read(KEY.teams(lg), {});

  const teamId = String(payload?.teamId ?? "");
  // Identity, so the same owner-only rule as the name above.
  const err = requireTeamOwner(p, teams, meta, teamId);
  if (err) refuse(err);

  const patch = {};
  for (const [field, label] of [["avatarFileId", "avatar"], ["bannerFileId", "banner"]]) {
    if (payload?.[field] === undefined) continue;
    patch[field] = must(checkFileId(payload[field], label)).fileId;
  }
  if (Object.keys(patch).length === 0) refuse("nothing to set: pass avatarFileId or bannerFileId");

  mutate(KEY.teams(lg), (cur) => {
    const current = cur ?? {};
    const team = current[teamId];
    if (!team) refuse(`no such team: ${teamId}`);
    return { ...current, [teamId]: { ...team, ...patch } };
  }, {});

  // ⚠️ Reported from the SETTLED record, never from what the callback decided —
  // `mutate` may run more than once on a CAS conflict, so the last value the
  // callback produced is not necessarily the one that was stored.
  const settled = read(KEY.teams(lg), {})[teamId] ?? {};
  return {
    leagueId: lg,
    teamId,
    avatarFileId: settled.avatarFileId ?? "",
    bannerFileId: settled.bannerFileId ?? "",
  };
}

/**
 * Set (or clear) the league's banner.
 *
 * ⚠️ ON `meta`, BESIDE `settings`, NEVER INSIDE IT. `settings` is normalised and
 * validated as a rules object by `normalizeSettings`/`validateSettings` — it
 * decides scoring, waivers and playoff shape. A banner is not a rule, and putting
 * it there would make every settings save carry it and every validation pass have
 * an opinion about it.
 */
export function setLeagueIdentity({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  if (payload?.bannerFileId === undefined) refuse("nothing to set: pass bannerFileId");
  const { fileId } = must(checkFileId(payload.bannerFileId, "banner"));

  mutate(KEY.meta(lg), (m) => ({ ...(m ?? meta), bannerFileId: fileId }), meta);
  return { leagueId: lg, bannerFileId: read(KEY.meta(lg), {}).bannerFileId ?? "" };
}

function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  return lg;
}
