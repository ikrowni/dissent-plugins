// sleeper-sidebar/sleeper-sidebar-api.js
const BASE = 'https://api.sleeper.app/v1';

async function sleeperFetch(path) {
  const res = await Dissent.fetch(`${BASE}${path}`);
  if (res.status !== 200) throw new Error(`Sleeper API ${res.status} at ${path}`);
  return JSON.parse(res.body);
}

export async function fetchUser(username) {
  return sleeperFetch(`/user/${encodeURIComponent(username)}`);
}

export async function fetchNflState() {
  return sleeperFetch('/state/nfl');
}

export async function fetchLeagues(userId, season) {
  return sleeperFetch(`/user/${userId}/leagues/nfl/${season}`);
}

export async function fetchRosters(leagueId) {
  return sleeperFetch(`/league/${leagueId}/rosters`);
}

export async function fetchLeagueUsers(leagueId) {
  return sleeperFetch(`/league/${leagueId}/users`);
}

export async function fetchMatchups(leagueId, week) {
  return sleeperFetch(`/league/${leagueId}/matchups/${week}`);
}

export async function fetchTransactions(leagueId, week) {
  return sleeperFetch(`/league/${leagueId}/transactions/${week}`);
}

export async function fetchWinnersBracket(leagueId) {
  return sleeperFetch(`/league/${leagueId}/winners_bracket`);
}

export async function fetchDrafts(leagueId) {
  return sleeperFetch(`/league/${leagueId}/drafts`);
}

export async function fetchDraftPicks(draftId) {
  return sleeperFetch(`/draft/${draftId}/picks`);
}

// Cached once per session — the players list is ~5MB.
let _playersCache = null;
export async function fetchPlayers() {
  if (_playersCache) return _playersCache;
  _playersCache = await sleeperFetch('/players/nfl');
  return _playersCache;
}
