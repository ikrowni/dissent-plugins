/**
 * ESPN's NFL scoreboard for one regular-season week, reduced to what week-locking needs.
 * ~160 KB per week — under the node's 1 MiB plugin fetch cap. ⚠️ ESPN refuses curl's default
 * User-Agent (403); the node's fetch proxy sends Go's and gets 200. Probe with that UA.
 */
export function scoreboardUrl(season, week) {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;
}

/** @returns {{kickoff:number, completed:boolean}[] | null} null = not a usable scoreboard */
export function gamesFromScoreboard(payload) {
  const events = payload?.events;
  if (!Array.isArray(events) || events.length === 0) return null;
  return events.map((e) => ({
    kickoff: Date.parse(e?.date),
    completed: e?.status?.type?.completed === true,
  }));
}
