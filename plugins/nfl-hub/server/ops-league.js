// server/ops-league.js — league lifecycle and roster operations.
//
// Each op takes ({ p, payload }) and returns data, or throws an Error whose
// message reaches the caller. `p` is the resolved principal from auth.js.

import { KEY, read, mutate, writeUncontended, leagueIndex, loadLeague } from "./store.js";
import {
  requireUser, requireCommissioner, requireTeamControl, isCommissioner, teamsOf,
} from "./auth.js";
import { normalizeSettings, validateSettings } from "../core/league/settings.js";
import { splitRosterPositions, validateLineup, irEligible } from "../core/league/slots.js";
import { emptyRoster, addPlayer, dropPlayer, moveCompartment, ownerOf } from "../core/league/rosters.js";
import { generateRegularSeason } from "../core/league/schedule.js";
import { positionMap, injuryMap } from "./ops-scoring.js";
import { validateAutoSubs } from "../core/league/autosubs.js";
import { rosterCapacity, mayAddAtPosition } from "../core/league/rosters.js";
import { setBlock, setInterest, interestCounts } from "../core/league/trade-block.js";
import {
  DROP_DESTINATION, dropDestination, wireClearsAt, placeOnWire, onWaivers,
  recordAcquisition, forgetAcquisition,
} from "../core/league/waiver-wire.js";

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
    // The UI renders the week and every week-scoped call is keyed on it, so
    // omitting it made every league look like it was in preseason forever.
    currentWeek: meta.currentWeek ?? null,
    commissioners: meta.commissioners,
    teams: redactRequests(teams, meta, p.userId),
    assets,
    myTeams: teamsOf(teams, p.userId),
    isCommissioner: isCommissioner(meta, p.userId),
    // ⚠️ The caller's OWN verified id. `myTeams` cannot tell owning a team apart
    // from co-owning one — `teamsOf` returns both — and the co-ownership UI has
    // to, because only an owner may approve or remove anybody.
    me: p.userId,
  };
}

/**
 * Hide each team's pending co-ownership requests from everyone but the person
 * who has to act on them.
 *
 * ⚠️ A REQUEST IS NOT PUBLIC. Who asked to co-own whose team is between those
 * two and the commissioner; leaving it in the league payload would broadcast
 * every declined approach to the whole server. The caller's OWN request stays
 * visible to them so the UI can show "pending" instead of offering to ask again.
 */
function redactRequests(teams, meta, userId) {
  const commish = isCommissioner(meta, userId);
  const out = {};
  for (const [id, team] of Object.entries(teams ?? {})) {
    const pending = (team.coOwnerRequests ?? []).map((r) => (typeof r === 'string' ? { userId: r, label: '', at: 0 } : r));
    const maySee = commish || team.ownerId === userId;
    out[id] = {
      ...team,
      coOwnerRequests: maySee ? pending : pending.filter((r) => r.userId === userId),
    };
  }
  return out;
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
 * Designate AutoSubs for one team and week.
 *
 * ⚠️ Uncontended by construction — one team, one week, one writer — so a plain
 * write is correct, exactly as for a lineup.
 *
 * ⚠️ THE ROSTER LIMIT IS CHECKED HERE AND NOWHERE ELSE. Sleeper refuses to SET
 * subs while a roster is over its limit, but HONOURS subs set while it was legal
 * and only later breached by a mid-week trade. `resolveAutoSubs` therefore never
 * re-checks it — moving this check into scoring would silently break that rule.
 */
export function setAutoSubs({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const week = Number(payload?.week);
  const season = Number(payload?.season ?? meta.season);
  if (!Number.isInteger(week) || week < 1) refuse("week must be a positive integer");

  const maxSubs = Number(meta.settings?.autoSubsPerWeek ?? 0);
  if (!Number.isInteger(maxSubs) || maxSubs <= 0) {
    refuse("AutoSubs are not enabled in this league");
  }

  const raw = payload?.subs && typeof payload.subs === "object" ? payload.subs : {};
  const subs = {};
  for (const [starterId, subId] of Object.entries(raw)) {
    if (starterId == null || subId == null) continue;
    subs[String(starterId)] = String(subId);
  }

  const roster = assets.rosters?.[teamId] ?? { players: [], ir: [], taxi: [] };

  // ⚠️ Over the limit means no NEW designations. Clearing them must still work,
  // or a manager who goes over is stuck with subs they cannot remove.
  if (Object.keys(subs).length > 0) {
    const held = (roster.players ?? []).length;
    const capacity = rosterCapacity(meta.settings);
    if (capacity > 0 && held > capacity) {
      refuse(`roster is over the limit (${held}/${capacity}) — clear it before setting AutoSubs`);
    }
  }

  const stored = read(KEY.lineup(lg, season, week, teamId), { lineup: [] });
  const { starters } = splitRosterPositions(meta.settings?.rosterPositions);

  // ⚠️ POSITIONS COME FROM THE CACHED INDEX, NEVER FROM THE PAYLOAD — the same
  // rule `setLineup` encodes. A caller that supplied positions could declare a
  // QB an RB and back up an RB slot with him.
  const positions = positionMap();
  if (Object.keys(positions).length === 0) {
    refuse("player positions are not loaded yet — try again shortly");
  }

  const check = validateAutoSubs({
    subs,
    lineup: stored.lineup ?? [],
    starterSlots: starters,
    positionOf: (id) => positions[String(id)] ?? null,
    roster: [...(roster.players ?? []), ...(roster.ir ?? [])],
    maxSubs,
  });
  if (!check.ok) refuse(check.error);

  writeUncontended(KEY.autosubs(lg, season, week, teamId), {
    subs, setAt: Date.now(), setBy: p.userId,
  });
  return { leagueId: lg, teamId, season, week, subs };
}

/** Read AutoSub designations back. */
export function getAutoSubs({ payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  const week = Number(payload?.week);
  const teamId = String(payload?.teamId ?? "");
  return read(KEY.autosubs(lg, season, week, teamId), { subs: {}, setAt: null, setBy: null });
}

/**
 * Set this team's trade block, or its interest list.
 *
 * ⚠️ CONTENDED — one record, every team writes it — so the whole read-modify-
 * write goes through `mutate`. A plain `set` here loses a rival team's block
 * silently: no error, no trace, just an offer that vanishes.
 *
 * ⚠️ OWNERSHIP IS RESOLVED FROM STORED ASSETS, NEVER FROM THE PAYLOAD. Trusting
 * the caller would let a manager put somebody else's player on the market.
 */
export function setTradeBlock({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams, assets } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);

  const teamId = String(payload?.teamId ?? "");
  const err = requireTeamControl(p, teams, meta, teamId);
  if (err) refuse(err);

  const rosters = assets.rosters ?? {};
  const ownerOf = (playerId) => {
    const id = String(playerId);
    for (const [t, r] of Object.entries(rosters)) {
      if ((r?.players ?? []).map(String).includes(id)) return String(t);
      if ((r?.ir ?? []).map(String).includes(id)) return String(t);
      if ((r?.taxi ?? []).map(String).includes(id)) return String(t);
    }
    return null;
  };
  const owns = (t, playerId) => ownerOf(playerId) === String(t);

  const players = Array.isArray(payload?.players) ? payload.players.map(String) : [];
  const picks = Array.isArray(payload?.picks) ? payload.picks : [];
  const interested = Array.isArray(payload?.interest) ? payload.interest.map(String) : [];
  const touchesBlock = payload?.players !== undefined || payload?.picks !== undefined;
  const touchesInterest = payload?.interest !== undefined;

  // ⚠️ THE CALLBACK STAYS PURE. `mutate` may run it more than once — on a CAS
  // conflict it re-reads and re-applies — so capturing the result inside it
  // would depend on which invocation happened to win. Read the settled value
  // back afterwards instead.
  mutate(KEY.tradeBlock(lg), (cur) => {
    const state = cur ?? { block: {}, interest: {} };
    let block = state.block ?? {};
    let interest = state.interest ?? {};

    if (touchesBlock) block = setBlock(block, teamId, { players, picks }, owns);
    if (touchesInterest) interest = setInterest(interest, teamId, interested, ownerOf);

    return { block, interest };
  }, { block: {}, interest: {} });

  const settled = read(KEY.tradeBlock(lg), { block: {}, interest: {} });
  return {
    leagueId: lg,
    teamId,
    block: settled.block?.[teamId] ?? { players: [], picks: [] },
    counts: interestCounts(settled.interest ?? {}),
  };
}

/**
 * The whole league's block and interest.
 *
 * Returns counts alongside the raw interest so a roster view can render the
 * heart-with-a-number without recomputing it per row.
 */
export function getTradeBlock({ payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const state = read(KEY.tradeBlock(lg), { block: {}, interest: {} });
  return {
    block: state.block ?? {},
    interest: state.interest ?? {},
    counts: interestCounts(state.interest ?? {}),
  };
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

  const now = Date.now();
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

    // ⚠️ CHECKED AFTER THE DROP, INSIDE THE SWAP. An add-with-drop that swaps
    // one QB for another must pass even at the cap, and checking before the
    // drop would refuse it. Positions come from the cached index, never the
    // payload — the rule setLineup already encodes.
    // ⚠️ A PLAYER ON WAIVERS IS NOT A FREE AGENT. Without this the whole wire is
    // decorative: anyone could add a dropped player instantly and the claim
    // everyone else submitted would lose to whoever refreshed fastest.
    if (onWaivers(assets.wire ?? {}, playerId, now)) {
      refuse(`${playerId} is on waivers — submit a claim instead`);
    }

    const positions = positionMap();
    const limitCheck = mayAddAtPosition(
      rosters?.[teamId], playerId, meta.settings, (id) => positions[String(id)] ?? null,
    );
    if (!limitCheck.ok) refuse(limitCheck.error);

    const added = addPlayer(rosters, teamId, playerId);
    if (!added.ok) refuse(added.error);
    result = { added: playerId, dropped: dropId };

    // ⚠️ RECORDED AS free_agency, which is the ONLY route the 24-Hour Rule
    // exempts. A drafted or traded player dropped within a day still goes to
    // waivers — see core/league/waiver-wire.js.
    let acquired = recordAcquisition(assets.acquired ?? {}, playerId, { at: now, via: "free_agency" });
    if (dropId) acquired = forgetAcquisition(acquired, dropId);

    return { ...assets, rosters: added.rosters, acquired };
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
  const now = Date.now();

  mutate(KEY.assets(lg), (a) => {
    const assets = a ?? { rosters: {}, budgets: {}, pickOwnership: [] };
    const res = dropPlayer(assets.rosters, teamId, playerId);
    if (!res.ok) refuse(res.error);

    // ⚠️ THE 24-HOUR RULE LIVES HERE. A free-agent pickup dropped inside a day
    // goes straight back to free agency instead of onto the wire — the rule
    // that stops a manager parking players on waivers to deny the league.
    const dest = dropDestination({
      acquired: assets.acquired ?? {}, playerId, now, settings: meta.settings,
    });
    const wire = dest === DROP_DESTINATION.WAIVERS
      ? placeOnWire(assets.wire ?? {}, playerId, {
        clearsAt: wireClearsAt(now, meta.settings), droppedBy: teamId, droppedAt: now,
      })
      : (assets.wire ?? {});

    return {
      ...assets,
      rosters: res.rosters,
      wire,
      acquired: forgetAcquisition(assets.acquired ?? {}, playerId),
    };
  }, null);

  // ⚠️ Read the settled state rather than reporting what the callback decided —
  // `mutate` may run more than once on a CAS conflict.
  const settled = read(KEY.assets(lg), { wire: {} });
  return {
    dropped: playerId,
    destination: onWaivers(settled.wire ?? {}, playerId, now)
      ? DROP_DESTINATION.WAIVERS
      : DROP_DESTINATION.FREE_AGENCY,
    clearsAt: settled.wire?.[playerId]?.clearsAt ?? null,
  };
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

  // ⚠️ CHECKED BEFORE THE SWAP, because it depends on nothing inside it. IR does
  // not count against the roster limit, so a healthy player parked there is a
  // free extra bench spot — the client hides the button, and this is what makes
  // hiding it a rule rather than a suggestion.
  if (compartment === "ir") {
    const injuries = injuryMap();
    // null = this install has never cached injury data (see injuryMap). Refusing
    // every IR move on that basis would break IR entirely rather than protect it.
    if (injuries) {
      const allowed = meta.settings?.irStatuses;
      const status = injuries[playerId] ?? null;
      if (!irEligible(status, allowed ? { allowed } : undefined)) {
        refuse(status
          ? `player ${playerId} is listed ${status}, which is not an IR designation`
          : `player ${playerId} carries no injury designation and cannot be placed on IR`);
      }
    }
  }

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

/**
 * Generate and store the regular-season schedule.
 *
 * ⚠️ REGENERATING MID-SEASON REWRITES HISTORY. The generator is deterministic
 * for a given team list, but the team list changes as people join — so a
 * regenerate after week 3 can hand a team different opponents for weeks it has
 * already played, and every standings and tiebreak computed from those results
 * becomes wrong. It is therefore refused once any week has been scored, unless
 * the commissioner explicitly forces it.
 *
 * ⚠️ THE TEAM ORDER IS FROZEN INTO THE STORED SCHEDULE. Deriving it later from
 * whatever `teams` happens to contain would silently produce a different
 * schedule the moment somebody joins — which is exactly why this is stored
 * rather than recomputed on read.
 */
export function generateSchedule({ p, payload }) {
  const lg = requireLeagueId(payload);
  const { meta, teams } = loadLeague(lg);
  if (!meta) refuse(`no such league: ${lg}`);
  const err = requireCommissioner(p, meta);
  if (err) refuse(err);

  const season = Number(payload?.season ?? meta.season);
  const teamIds = Object.keys(teams);
  if (teamIds.length < 2) refuse('a schedule needs at least two teams');

  const existing = read(KEY.schedule(lg, season), null);
  if (existing && !payload?.force) {
    const scored = (existing.weeks ?? []).some((w) => read(KEY.scores(lg, season, w.week), null));
    if (scored) {
      refuse('this season already has scored weeks — regenerating would change opponents for games already played. Pass force to override.');
    }
  }

  const startWeek = meta.settings?.startWeek ?? 1;
  const weeks = Math.max(1, (meta.settings?.playoffWeekStart ?? 15) - startWeek);
  const generated = generateRegularSeason(teamIds, weeks, { startWeek });

  const record = {
    season,
    startWeek,
    // The exact order the schedule was built from, kept so a later reader can
    // see WHY the pairings are what they are.
    teamIds,
    generatedAt: Date.now(),
    generatedBy: p.userId,
    weeks: generated,
  };
  mutate(KEY.schedule(lg, season), () => record, null);
  return { season, weeks: generated.length, teams: teamIds.length };
}

/**
 * The stored schedule, or null.
 *
 * ⚠️ RETURNS NULL RATHER THAN GENERATING ONE. A read that quietly created a
 * schedule would let any member fix the season's pairings by opening a tab, and
 * would do it with whatever team list happened to exist at that moment.
 */
export function getSchedule({ payload }) {
  const lg = requireLeagueId(payload);
  const meta = read(KEY.meta(lg), null);
  if (!meta) refuse(`no such league: ${lg}`);
  const season = Number(payload?.season ?? meta.season);
  return read(KEY.schedule(lg, season), null);
}
