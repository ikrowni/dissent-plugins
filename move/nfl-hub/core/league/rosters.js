// core/league/rosters.js — who owns whom.
//
// PURE. Every function takes the WHOLE rosters object and returns a new one.
//
// ⚠️ THIS IS WHY ALL ROSTERS LIVE IN ONE STORAGE KEY. "A player is owned by
// exactly one team" is a CROSS-TEAM invariant, and compare-and-swap on
// per-team keys cannot protect it: two swaps on `roster:A` and `roster:B` can
// both legitimately succeed and leave the same player on both rosters. Holding
// every team in one value makes each ownership change a single atomic swap, and
// makes the invariant checkable in one place — here.
//
// Sizing, so the choice stays honest: 14 dynasty teams x 40 slots x ~8 bytes of
// id is about 6 KB, against a 256 KiB per-value ceiling.
//
// A roster is ownership only. Who STARTS in a given week is a separate,
// per-team, per-week key with a single writer, and needs no locking at all.

/** An empty roster. `players` excludes anyone parked on IR or taxi. */
export function emptyRoster() {
  return { players: [], ir: [], taxi: [] };
}

/** Build a fresh rosters object for a set of team ids. */
export function emptyRosters(teamIds = []) {
  const out = {};
  for (const id of teamIds) out[String(id)] = emptyRoster();
  return out;
}

const COMPARTMENTS = ['players', 'ir', 'taxi'];

/** Every player id a team holds, across all three compartments. */
export function allPlayers(roster) {
  if (!roster) return [];
  return COMPARTMENTS.flatMap((c) => roster[c] ?? []);
}

/**
 * Which team owns a player, or null.
 *
 * ⚠️ Scans every team by design. The alternative — a maintained index — is a
 * second source of truth for ownership, and the two would eventually disagree.
 * At 14 teams x 40 players this is a few hundred comparisons.
 */
export function ownerOf(rosters, playerId) {
  const id = String(playerId);
  for (const [teamId, roster] of Object.entries(rosters ?? {})) {
    if (allPlayers(roster).some((p) => String(p) === id)) return teamId;
  }
  return null;
}

/** Deep-ish clone: new objects and new arrays, ids are strings and immutable. */
function cloneRosters(rosters) {
  const out = {};
  for (const [teamId, roster] of Object.entries(rosters ?? {})) {
    out[teamId] = {
      players: [...(roster.players ?? [])],
      ir: [...(roster.ir ?? [])],
      taxi: [...(roster.taxi ?? [])],
    };
  }
  return out;
}

/**
 * Every mutation returns { ok, rosters, error }.
 *
 * ⚠️ A REFUSAL IS A RESULT, NOT AN EXCEPTION. These run inside a compare-and-swap
 * retry loop on the server and inside optimistic UI on the client; both need to
 * distinguish "illegal move" from "something broke", and neither wants a throw
 * on the ordinary path of two managers wanting the same player.
 */
const fail = (rosters, error) => ({ ok: false, rosters, error });
const done = (rosters) => ({ ok: true, rosters, error: null });

/** Add a free agent to a team, in the given compartment. */
export function addPlayer(rosters, teamId, playerId, { compartment = 'players' } = {}) {
  const team = String(teamId);
  const id = String(playerId);
  if (!rosters?.[team]) return fail(rosters, `no such team: ${team}`);
  if (!COMPARTMENTS.includes(compartment)) return fail(rosters, `no such compartment: ${compartment}`);

  // ⚠️ THE INVARIANT. Checked against every team, not just the acting one.
  const current = ownerOf(rosters, id);
  if (current) return fail(rosters, `player ${id} is already owned by team ${current}`);

  const next = cloneRosters(rosters);
  next[team][compartment].push(id);
  return done(next);
}

/** Drop a player to free agency. */
export function dropPlayer(rosters, teamId, playerId) {
  const team = String(teamId);
  const id = String(playerId);
  if (!rosters?.[team]) return fail(rosters, `no such team: ${team}`);
  if (!allPlayers(rosters[team]).some((p) => String(p) === id)) {
    return fail(rosters, `team ${team} does not own player ${id}`);
  }

  const next = cloneRosters(rosters);
  for (const c of COMPARTMENTS) {
    next[team][c] = next[team][c].filter((p) => String(p) !== id);
  }
  return done(next);
}

/** Move a player between compartments on the same team (activate, IR, taxi). */
export function moveCompartment(rosters, teamId, playerId, compartment) {
  const team = String(teamId);
  const id = String(playerId);
  if (!rosters?.[team]) return fail(rosters, `no such team: ${team}`);
  if (!COMPARTMENTS.includes(compartment)) return fail(rosters, `no such compartment: ${compartment}`);
  if (!allPlayers(rosters[team]).some((p) => String(p) === id)) {
    return fail(rosters, `team ${team} does not own player ${id}`);
  }

  const next = cloneRosters(rosters);
  for (const c of COMPARTMENTS) next[team][c] = next[team][c].filter((p) => String(p) !== id);
  next[team][compartment].push(id);
  return done(next);
}

/**
 * Execute a trade as ONE operation.
 *
 * `legs` is [{ from, to, playerId }]. Either every leg applies or none does —
 * a half-applied trade is how a player ends up owned by nobody, and it is
 * unrecoverable without a commissioner.
 *
 * ⚠️ Validation runs against the ORIGINAL rosters for every leg before anything
 * moves. Validating incrementally would let leg 2 "see" leg 1's move and accept
 * a trade that was never legal as a whole.
 */
export function executeTrade(rosters, legs) {
  if (!Array.isArray(legs) || legs.length === 0) return fail(rosters, 'a trade needs at least one leg');

  const seen = new Set();
  for (const leg of legs) {
    const { from, to, playerId } = leg ?? {};
    const id = String(playerId);
    if (!rosters?.[String(from)]) return fail(rosters, `no such team: ${from}`);
    if (!rosters?.[String(to)]) return fail(rosters, `no such team: ${to}`);
    if (String(from) === String(to)) return fail(rosters, `leg moves player ${id} to its own team`);
    if (seen.has(id)) return fail(rosters, `player ${id} appears in two legs of one trade`);
    seen.add(id);

    const owner = ownerOf(rosters, id);
    if (owner !== String(from)) {
      return fail(rosters, `player ${id} is owned by ${owner ?? 'nobody'}, not ${from}`);
    }
  }

  let next = cloneRosters(rosters);
  for (const { from, to, playerId } of legs) {
    const id = String(playerId);
    // Preserve the compartment the player sat in — an IR player stays on IR.
    const compartment = COMPARTMENTS.find((c) =>
      next[String(from)][c].some((p) => String(p) === id)) ?? 'players';
    for (const c of COMPARTMENTS) {
      next[String(from)][c] = next[String(from)][c].filter((p) => String(p) !== id);
    }
    next[String(to)][compartment].push(id);
  }
  return done(next);
}

/**
 * Check the whole structure holds together.
 *
 * ⚠️ THE DUPLICATE-OWNERSHIP CHECK IS THE ONE THAT MATTERS. Everything else here
 * is a size limit a commissioner can reasonably override; a player on two rosters
 * is a corrupt league that cannot be scored.
 */
export function validateRosters(rosters, settings) {
  const errors = [];
  const owners = new Map();

  for (const [teamId, roster] of Object.entries(rosters ?? {})) {
    const held = allPlayers(roster);

    for (const p of held) {
      const id = String(p);
      if (owners.has(id)) {
        errors.push(`player ${id} is owned by both ${owners.get(id)} and ${teamId}`);
      } else {
        owners.set(id, teamId);
      }
    }

    // A player listed twice on ONE roster is the same corruption, and a scan
    // across teams alone would miss it.
    const within = new Set();
    for (const p of held) {
      const id = String(p);
      if (within.has(id)) errors.push(`player ${id} appears twice on team ${teamId}`);
      within.add(id);
    }

    if (settings) {
      const active = (roster.players ?? []).length;
      const capacity = rosterCapacity(settings);
      if (active > capacity) {
        errors.push(`team ${teamId} holds ${active} players, over the ${capacity} roster spots`);
      }
      if ((roster.ir ?? []).length > (settings.irSlots ?? 0)) {
        errors.push(`team ${teamId} has ${roster.ir.length} on IR, over the ${settings.irSlots ?? 0} slots`);
      }
      if ((roster.taxi ?? []).length > (settings.taxiSlots ?? 0)) {
        errors.push(`team ${teamId} has ${roster.taxi.length} on taxi, over the ${settings.taxiSlots ?? 0} slots`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * How many players a team may hold, excluding IR and taxi.
 *
 * IR and taxi are deliberately NOT counted: that is the entire point of those
 * compartments, and counting them would make a legal roster look illegal.
 */
export function rosterCapacity(settings) {
  const positions = settings?.rosterPositions ?? [];
  return positions.filter((p) => p !== 'IR' && p !== 'TAXI').length;
}

/**
 * How many ACTIVE players a team holds at each position.
 *
 * ⚠️ IR AND TAXI ARE EXEMPT, which is the entire point of those compartments.
 * Counting them would mean a league with a QB cap could not use IR at all —
 * an injured quarterback would occupy a cap slot he cannot play in.
 */
export function positionCounts(roster, positionOf = () => null) {
  const counts = {};
  for (const id of roster?.players ?? []) {
    const pos = positionOf(id);
    if (!pos) continue;
    counts[pos] = (counts[pos] ?? 0) + 1;
  }
  return counts;
}

/**
 * Positions where a roster exceeds its league's cap.
 *
 * `settings.positionLimits` is `{ [position]: max }`; a position absent from it
 * is uncapped. Returns `[]` when the league sets no limits, which is the
 * default and by far the common case.
 *
 * ⚠️ REPORTS rather than refuses. A trade may legitimately leave a roster over
 * the cap for a while — Sleeper allows it and locks the LINEUP until it is
 * cured — so the caller decides what a breach means in its context.
 */
export function overPositionLimit(roster, settings, positionOf = () => null) {
  const limits = settings?.positionLimits ?? {};
  if (Object.keys(limits).length === 0) return [];

  const counts = positionCounts(roster, positionOf);
  const out = [];
  for (const [position, max] of Object.entries(limits)) {
    if (!Number.isInteger(max) || max < 0) continue;
    const have = counts[position] ?? 0;
    if (have > max) out.push({ position, have, max });
  }
  return out;
}

/**
 * May this team add this player without breaching its positional cap?
 *
 * ⚠️ AN UNKNOWN POSITION IS ALLOWED. Refusing a player the index has not caught
 * up on would block a legal add for a data-freshness reason the manager cannot
 * see or fix — the same reasoning `injuryMap()` uses for IR enforcement.
 */
export function mayAddAtPosition(roster, playerId, settings, positionOf = () => null) {
  const limits = settings?.positionLimits ?? {};
  const pos = positionOf(playerId);
  if (!pos) return { ok: true };

  const max = limits[pos];
  if (!Number.isInteger(max) || max < 0) return { ok: true };

  const have = positionCounts(roster, positionOf)[pos] ?? 0;
  if (have < max) return { ok: true };
  return { ok: false, error: `this league allows at most ${max} ${pos}${max === 1 ? '' : 's'} on an active roster` };
}
