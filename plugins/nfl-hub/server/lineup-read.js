// The one reader of a team's lineup for a week. Every server path that needs "who is
// starting" goes through here, so none of them can read an unset week as empty again.
import { KEY, read } from "./store.js";
import { effectiveLineup } from "../core/league/lineup-carry.js";

/** The lineup a team plays in a week, carried forward when that week was never set. */
export function lineupFor(lg, season, week, teamId, assets) {
  const roster = assets?.rosters?.[teamId] ?? {};
  return effectiveLineup(
    (w) => read(KEY.lineup(lg, season, w, teamId), null),
    week,
    [...(roster.players ?? []), ...(roster.ir ?? [])],
  );
}
