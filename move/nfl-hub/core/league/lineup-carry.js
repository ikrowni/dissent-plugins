/**
 * Which lineup a team plays in a week it has not set one for.
 *
 * Lineups are stored per team PER WEEK (`fl:<lg>:lineup:<season>:w<week>:<team>`), and until
 * 2026-09-30 an unset week read as an EMPTY lineup — so every manager had to re-enter their
 * whole lineup every week or score zero. A lineup now carries forward: a week with nothing
 * saved plays the most recent earlier week that has one. Setting a week still writes only
 * that week, so an injury is handled by editing the one position, and the edit then carries
 * forward in turn.
 *
 * ⚠️ A carried player who is NO LONGER ON THE ROSTER (dropped, traded) becomes an empty
 * slot rather than being scored. The roster is the truth about who a team owns; a lineup
 * only says where they play. The manager sees the hole and fills it.
 *
 * ⚠️ Only earlier weeks of the SAME season are consulted — a new season starts empty.
 *
 * @param {(week: number) => ({ lineup?: (string|null)[], setAt?: number|null } | null)} readWeek
 *   the stored record for one week, or null when that week was never set
 * @param {number} week the week being played or viewed
 * @param {Iterable<string>} held every player the team holds now (active + IR)
 * @returns {{ lineup: (string|null)[], setAt: number|null, setBy?: string|null, carriedFrom: number|null }}
 *   `carriedFrom` is null when the week has its own lineup, else the week it came from
 */
export function effectiveLineup(readWeek, week, held) {
  const own = readWeek(week);
  if (isSet(own)) return { ...own, lineup: own.lineup, carriedFrom: null };

  const onRoster = new Set([...held].map(String));
  for (let w = week - 1; w >= 1; w--) {
    const prev = readWeek(w);
    if (!isSet(prev)) continue;
    return {
      lineup: prev.lineup.map((id) => (id && onRoster.has(String(id)) ? String(id) : null)),
      setAt: null,
      setBy: null,
      carriedFrom: w,
    };
  }
  return { lineup: [], setAt: null, setBy: null, carriedFrom: null };
}

// A week counts as SET when someone saved it, even if they saved it with holes. An
// all-empty lineup that was deliberately saved is still that manager's choice for the week.
function isSet(rec) {
  return Boolean(rec && Array.isArray(rec.lineup) && rec.setAt != null);
}
