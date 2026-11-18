// core/league/keepers.js — carrying a league across seasons.
//
// PURE. The rules that separate a redraft league (rosters reset, everyone is a
// free agent again) from keeper and dynasty leagues (ownership persists).
//
// ⚠️ THE FORMAT DECIDES, NOT THE SETTINGS. A redraft league with maxKeepers set
// keeps nobody — `validateSettings` refuses that combination precisely because a
// silently inert setting is worse than a rejected one.

import { FORMAT, isMultiSeason } from './settings.js';
import { emptyRoster } from './rosters.js';

/**
 * Roll a league into the next season.
 *
 * `keeperChoices` maps teamId → the player ids that team elected to keep. It is
 * ignored entirely in dynasty (everyone is kept) and in redraft (nobody is).
 *
 * Returns { rosters, released, errors }: the new ownership, the players who
 * returned to the pool, and any elections that could not be honoured.
 *
 * ⚠️ An invalid election is REPORTED, NOT THROWN, and the rest of the league
 * still rolls over. A single manager keeping a player they no longer own must
 * not block the whole league from starting its season.
 */
export function rolloverSeason(rosters, settings, keeperChoices = {}) {
  const errors = [];
  const next = {};
  const released = [];

  const teamIds = Object.keys(rosters ?? {});

  // Redraft: everyone goes back in the pool. Nothing to elect, nothing to check.
  if (!isMultiSeason(settings)) {
    for (const teamId of teamIds) {
      next[teamId] = emptyRoster();
      released.push(...heldBy(rosters[teamId]));
    }
    return { rosters: next, released, errors };
  }

  const dynasty = settings?.format === FORMAT.DYNASTY;
  const maxKeepers = dynasty ? Infinity : (settings?.maxKeepers ?? 0);

  for (const teamId of teamIds) {
    const roster = rosters[teamId] ?? emptyRoster();
    const held = new Set(heldBy(roster));

    let keeping;
    if (dynasty) {
      // ⚠️ Dynasty keeps the WHOLE roster, including IR and taxi. Treating it as
      // "keepers with a big limit" would quietly drop anyone parked off the
      // active roster at season roll.
      keeping = [...held];
    } else {
      const elected = (keeperChoices[teamId] ?? []).map(String);
      keeping = [];
      for (const id of elected) {
        if (!held.has(id)) {
          errors.push(`team ${teamId} elected to keep ${id}, which it does not own`);
          continue;
        }
        if (keeping.includes(id)) continue; // a duplicate election is not two keepers
        if (keeping.length >= maxKeepers) {
          errors.push(`team ${teamId} elected more than ${maxKeepers} keepers; ${id} was dropped`);
          continue;
        }
        keeping.push(id);
      }
    }

    const kept = new Set(keeping);
    next[teamId] = {
      players: (roster.players ?? []).map(String).filter((id) => kept.has(id)),
      // IR clears at season roll: last season's injury designation says nothing
      // about this one, and a player left on IR would occupy a slot nobody is
      // using.
      ir: [],
      taxi: dynasty ? (roster.taxi ?? []).map(String) : [],
    };
    // Dynasty keeps taxi players, so they must not also be counted as active.
    if (dynasty) {
      const taxi = new Set(next[teamId].taxi);
      next[teamId].players = [...new Set([...(roster.players ?? []).map(String), ...(roster.ir ?? []).map(String)])]
        .filter((id) => !taxi.has(id));
    }

    for (const id of held) {
      if (!kept.has(id)) released.push(id);
    }
  }

  return { rosters: next, released, errors };
}

/** Every player a roster holds, across all compartments. */
function heldBy(roster) {
  return [
    ...(roster?.players ?? []),
    ...(roster?.ir ?? []),
    ...(roster?.taxi ?? []),
  ].map(String);
}

/**
 * How many keepers a team may still elect.
 *
 * Dynasty has no limit — the whole roster carries — so it reports Infinity
 * rather than a number that would read as a cap.
 */
export function keeperSlotsRemaining(settings, elected = []) {
  if (settings?.format === FORMAT.DYNASTY) return Infinity;
  if (!isMultiSeason(settings)) return 0;
  return Math.max(0, (settings?.maxKeepers ?? 0) - elected.length);
}

/**
 * Is a player still eligible for the taxi squad?
 *
 * ⚠️ TAXI IS FOR DEVELOPING PLAYERS, and `taxiYears` bounds how long. A player
 * drafted three seasons ago in a two-year taxi league must graduate; leaving him
 * there is how a manager stashes a starter off the roster cap indefinitely.
 *
 * `taxiAllowVets` (Sleeper's setting) decides whether a player who was never
 * rookie-drafted by this team may occupy taxi at all.
 */
export function taxiEligible(player, settings, currentSeason) {
  if (settings?.format !== FORMAT.DYNASTY) return false;
  if ((settings?.taxiSlots ?? 0) <= 0) return false;
  if (!player) return false;

  if (!player.rookieDraftedBy && !settings?.taxiAllowVets) return false;

  const years = settings?.taxiYears ?? 0;
  if (years <= 0) return true; // no limit configured
  const drafted = Number(player.draftedSeason);
  if (!Number.isFinite(drafted)) return false;
  return Number(currentSeason) - drafted < years;
}

/**
 * Players who must leave the taxi squad this season.
 *
 * Returned rather than moved: graduating a player needs a roster spot, and
 * whether one exists is a question for the caller holding the whole assets
 * bundle, not for this module.
 */
export function taxiGraduates(roster, settings, currentSeason, playerOf) {
  return (roster?.taxi ?? [])
    .map(String)
    .filter((id) => !taxiEligible(playerOf?.(id) ?? null, settings, currentSeason));
}

/**
 * The rookie draft order for a dynasty league: worst record picks first.
 *
 * ⚠️ NOT the same as the startup draft order, and not the same as waiver
 * priority either — this is the standing every fantasy league inverts, and it
 * needs the same deterministic tiebreak as seeding so two runs over one season
 * cannot disagree.
 */
export function rookieDraftOrder(standings = []) {
  return [...standings]
    .sort((a, b) => (a.wins - b.wins)
      || (a.pointsFor - b.pointsFor)
      || String(a.teamId).localeCompare(String(b.teamId)))
    .map((row) => String(row.teamId));
}
