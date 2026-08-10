// server/ops-league.js — league lifecycle and roster operations.
//
// Each op takes ({ p, payload }) and returns data, or throws an Error whose
// message reaches the caller. `p` is the resolved principal from auth.js.

import { KEY, read, mutate, writeUncontended, leagueIndex, loadLeague } from "./store.js";
import {
  requireUser, requireCommissioner, requireTeamControl, isCommissioner, teamsOf,
} from "./auth.js";
import { normalizeSettings, validateSettings } from "../core/league/settings.js";
import { splitRosterPositions, validateLineup } from "../core/league/slots.js";
import { emptyRoster, addPlayer, dropPlayer, moveCompartment, ownerOf } from "../core/league/rosters.js";
import { positionMap } from "./ops-scoring.js";

const refuse = (msg) => { throw new Error(msg); };

/** Create a league. The creator becomes its first commissioner. */
export function createLeague({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse(err);

  const settings = normalizeSettings(payload?.settings ?? {});
  const check = validateSettings(settings);
  if (!check.valid) refuse(`invalid settings: ${check.errors.join("; ")}`);

  // A caller MAY propose an id, which makes creation deterministic and scriptable.
  //
  // ⚠️ It is create-only: an id that already exists is refused, never overwritten.
  // Without that check a caller could name an existing league and blow away its
  // settings, commissioners and season — and `mutate` would happily write it.
  const proposed = payload?.leagueId ? String(payload.leagueId) : null;
  if (proposed && !/^[a-zA-Z0-9_-]{1,40}$/.test(proposed)) {
    refuse("leagueId must be 1-40 characters of [A-Za-z0-9_-]");
  }
  const id = proposed ?? `lg${Date.now().toString(36)}`;
  if (read(KEY.meta(id), null)) refuse(`league ${id} already exists`);

  mutate(KEY.index(), (list) => {
    const list2 = list ?? [];
    return list2.includes(id) ? list2 : [...list2, id];
  }, []);
  mutate(KEY.meta(id), () => ({
    id,
    settings,
    commissioners: [p.userId],
    season: payload?.season ?? new Date().getUTCFullYear(),
    createdAt: Date.now(),
    createdBy: p.userId,
  }), null);
  mutate(KEY.teams(id), () => ({}), {});
  mutate(KEY.assets(id), () => ({ rosters: {}, budgets: {}, pickOwnership: [] }), null);

  return { leagueId: id, settings };
}

/** Every league on this install, with the caller's teams marked. */
export function listLeagues({ p }) {
  return leagueIndex().map((id) => {
    const meta = read(KEY.meta(id), null);
    const teams = read(KEY.teams(id), {});
    return {
      id,
      name: meta?.settings?.name ?? id,
      season: meta?.season ?? null,
      format: meta?.settings?.format ?? null,
      teamCount: Object.keys(teams).length,
      myTeams: teamsOf(teams, p.userId),
      isCommissioner: isCommissioner(meta, p.userId),
    };
  });
}

/** One league, for rendering. */
export function getLeague({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  return {
    id: lg,
    settings: meta.settings,
    season: meta.season,
    commissioners: meta.commissioners,
    teams,
    assets,
    myTeams: teamsOf(teams, p.userId),
    isCommissioner: isCommissioner(meta, p.userId),
  };
}

/**
 * Join a league, claiming a team.
 *
 * ⚠️ ONE TEAM PER USER, and the check happens INSIDE the swap. Checking before
 * would let two concurrent joins both pass and hand one user two teams — the
 * same lost-update shape the whole storage design exists to prevent.
 */
export function joinLeague({ p, payload }) {
  const err = requireUser(p);
  if (err) refuse(err);
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);

  const name = String(payload?.teamName ?? "").trim() || `Team ${p.userId.slice(0, 6)}`;
  let assigned = null;

  mutate(KEY.teams(lg), (teams) => {
    const current = teams ?? {};
    const mine = teamsOf(current, p.userId);
    if (mine.length > 0) {
      assigned = mine[0];
      return current; // already in — idempotent rather than an error
    }
    if (Object.keys(current).length >= (meta.settings?.numTeams ?? 12)) {
      refuse("this league is full");
    }
    const teamId = `t${Object.keys(current).length + 1}`;
    assigned = teamId;
    return { ...current, [teamId]: { id: teamId, name, ownerId: p.userId, coOwners: [] } };
  }, {});

  // The roster is created separately; a team with no roster row simply has no
  // players yet, which is the correct starting state.
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    if (assets.rosters[assigned]) return assets;
    return {
      ...assets,
      rosters: { ...assets.rosters, [assigned]: emptyRoster() },
      budgets: { ...assets.budgets, [assigned]: meta.settings?.waiverBudget ?? 0 },
    };
  }, null);

  return { leagueId: lg, teamId: assigned };
}

/** Commissioner: change league settings mid-season. */
export function updateSettings({ p, payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  const next = normalizeSettings({ ...meta.settings, ...(payload?.settings ?? {}) });
  const check = validateSettings(next);
  if (!check.valid) refuse(`invalid settings: ${check.errors.join("; ")}`);

  mutate(KEY.meta(lg), (m) => ({ ...m, settings: next }), meta);
  return { settings: next };
}

/**
 * Set a lineup for one team and week.
 *
 * ⚠️ Uncontended by construction — one team, one week, one writer — so this is
 * the one place a plain write is correct.
 */
export function setLineup({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const week = Number(payload?.week);
  const season = Number(payload?.season ?? meta.season);
  if (!Number.isInteger(week) || week < 1) refuse("week must be a positive integer");

  const lineup = Array.isArray(payload?.lineup) ? payload.lineup.map((x) => (x == null ? null : String(x))) : [];
  const { starters } = splitRosterPositions(meta.settings?.rosterPositions);

  // The lineup must be legal AND every player must actually be on the roster —
  // two different checks, and the second is the one a client cannot be trusted on.
  const held = new Set([
    ...(assets.rosters?.[teamId]?.players ?? []),
    ...(assets.rosters?.[teamId]?.ir ?? []),
  ].map(String));
  for (const id of lineup) {
    if (id && id !== "0" && !held.has(id)) refuse(`player ${id} is not on team ${teamId}`);
  }

  // ⚠️ POSITIONS COME FROM THE CACHED INDEX, NEVER FROM THE PAYLOAD. Taking them
  // from the caller let a manager declare their QB an RB and start him in an RB
  // slot — the client supplies the payload, so it can say anything.
  //
  // An empty map means the index has not been fetched yet. Validating against
  // nothing would silently accept every lineup, so it refuses instead: a lineup
  // that cannot be checked must not be recorded as checked.
  const positions = positionMap();
  if (Object.keys(positions).length === 0) {
    refuse("player positions are not loaded yet — try again shortly");
  }
  const check = validateLineup(lineup, starters, (id) => positions[String(id)] ?? null);
  if (!check.valid) refuse(check.errors.join("; "));

  writeUncontended(KEY.lineup(lg, season, week, teamId), { lineup, setAt: Date.now(), setBy: p.userId });
  return { leagueId: lg, teamId, season, week, lineup };
}

/** Read a lineup back. */
export function getLineup({ payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const teamId = String(payload?.teamId ?? "");
  return read(KEY.lineup(lg, season, week, teamId), { lineup: [], setAt: null, setBy: null });
}

/**
 * Add a free agent, immediately.
 *
 * ⚠️ The whole read-check-write runs INSIDE the swap. Two managers claiming the
 * same free agent at the same moment is precisely the case that must not both
 * succeed, and checking ownership outside the swap would let it.
 */
export function addFreeAgent({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);
  if (meta.settings?.addsEnabled === false) refuse("adds are disabled in this league");

  const playerId = String(payload?.playerId ?? "");
  if (!playerId) refuse("playerId required");
  const dropId = payload?.dropPlayerId ? String(payload.dropPlayerId) : null;

  let result = null;
  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    let rosters = assets.rosters;

    if (dropId) {
      const dropped = dropPlayer(rosters, teamId, dropId);
      if (!dropped.ok) refuse(dropped.error);
      rosters = dropped.rosters;
    }

    const owner = ownerOf(rosters, playerId);
    if (owner) refuse(`player ${playerId} is owned by team ${owner}`);

    const added = addPlayer(rosters, teamId, playerId);
    if (!added.ok) refuse(added.error);
    result = { added: playerId, dropped: dropId };
    return { ...assets, rosters: added.rosters };
  }, null);

  return result;
}

/** Drop a player to free agency. */
export function dropFreeAgent({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const playerId = String(payload?.playerId ?? "");
  mutate(KEY.assets(lg), (a) => {
    const res = dropPlayer(a.rosters, teamId, playerId);
    if (!res.ok) refuse(res.error);
    return { ...a, rosters: res.rosters };
  }, null);
  return { dropped: playerId };
}

/** Move a player between active, IR and taxi. */
export function movePlayer({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const playerId = String(payload?.playerId ?? "");
  const compartment = String(payload?.compartment ?? "players");

  mutate(KEY.assets(lg), (a) => {
    const res = moveCompartment(a.rosters, teamId, playerId, compartment);
    if (!res.ok) refuse(res.error);
    const roster = res.rosters[teamId];
    if (compartment === "ir" && roster.ir.length > (meta.settings?.irSlots ?? 0)) {
      refuse(`no IR slots free (${meta.settings?.irSlots ?? 0})`);
    }
    if (compartment === "taxi" && roster.taxi.length > (meta.settings?.taxiSlots ?? 0)) {
      refuse(`no taxi slots free (${meta.settings?.taxiSlots ?? 0})`);
    }
    return { ...a, rosters: res.rosters };
  }, null);

  return { playerId, compartment };
}

function requireLeagueId(payload) {
  const lg = String(payload?.leagueId ?? "");
  if (!lg) refuse("leagueId required");
  return lg;
}
