// core/sleeper.js — Sleeper client. READ ONLY BY CONSTRUCTION.
//
// The Sleeper API has no write endpoints and no auth token (docs.sleeper.com): you
// cannot set a lineup, claim a waiver or accept a trade through it. Anything that
// would mutate league state is handed off via deepLink below.
//
// There is deliberately no players() url here: /v1/players/nfl is 14.3 MB against a
// 1 MB fetch:external cap, so it can never be fetched at runtime. core/players.js
// reads the generated static index instead. The trending endpoint is fine — it is a
// small, explicitly limited list.
import { getJson } from './http.js';

const API = 'https://api.sleeper.app/v1';
const CDN = 'https://sleepercdn.com';

export const sleeperUrls = {
  state: () => `${API}/state/nfl`,
  user: (nameOrId) => `${API}/user/${encodeURIComponent(nameOrId)}`,
  userLeagues: (userId, season) => `${API}/user/${userId}/leagues/nfl/${season}`,
  league: (leagueId) => `${API}/league/${leagueId}`,
  rosters: (leagueId) => `${API}/league/${leagueId}/rosters`,
  leagueUsers: (leagueId) => `${API}/league/${leagueId}/users`,
  matchups: (leagueId, week) => `${API}/league/${leagueId}/matchups/${week}`,
  transactions: (leagueId, round) => `${API}/league/${leagueId}/transactions/${round}`,
  winnersBracket: (leagueId) => `${API}/league/${leagueId}/winners_bracket`,
  losersBracket: (leagueId) => `${API}/league/${leagueId}/losers_bracket`,
  drafts: (leagueId) => `${API}/league/${leagueId}/drafts`,
  draftPicks: (draftId) => `${API}/draft/${draftId}/picks`,
  trending: (type = 'add', limit = 25) =>
    `${API}/players/nfl/trending/${type}?limit=${limit}`,
  avatar: (id) => (id ? `${CDN}/avatars/thumbs/${id}` : null),
};

/** Sleeper cannot be written to, so every mutating action becomes a handoff. */
export const deepLink = {
  league: (leagueId) => `https://sleeper.com/leagues/${leagueId}`,
  roster: (leagueId, rosterId) => `https://sleeper.com/leagues/${leagueId}/team/${rosterId}`,
  matchup: (leagueId, week) => `https://sleeper.com/leagues/${leagueId}/matchup/${week}`,
  players: (leagueId) => `https://sleeper.com/leagues/${leagueId}/players`,
  trade: (leagueId) => `https://sleeper.com/leagues/${leagueId}/trade`,
};

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function parseState(json) {
  if (!json) return null;
  const type = json.season_type ?? null;
  return {
    week: num(json.week) ?? 1,
    displayWeek: num(json.display_week) ?? num(json.week) ?? 1,
    season: num(json.season),
    seasonType: type,
    isPreseason: type === 'pre',
    isRegular: type === 'regular',
    seasonStart: json.season_start_date ?? null,
  };
}

function scoringType(scoring) {
  const rec = Number(scoring?.rec ?? 0);
  if (rec >= 1) return 'PPR';
  if (rec > 0) return 'Half PPR';
  return 'Standard';
}

export function parseLeague(json) {
  if (!json) return null;
  const positions = json.roster_positions ?? [];
  return {
    id: json.league_id ?? null,
    name: json.name ?? 'League',
    season: num(json.season),
    status: json.status ?? null,
    teams: num(json.total_rosters) ?? num(json.settings?.num_teams) ?? 0,
    avatar: sleeperUrls.avatar(json.avatar),
    playoffTeams: num(json.settings?.playoff_teams),
    playoffWeekStart: num(json.settings?.playoff_week_start),
    scoringType: scoringType(json.scoring_settings),
    rosterPositions: positions,
    starterSlots: positions.filter((p) => p !== 'BN' && p !== 'IR' && p !== 'TAXI'),
  };
}

export function parseRosters(json) {
  if (!Array.isArray(json)) return [];
  return json.map((r) => {
    const s = r.settings ?? {};
    return {
      rosterId: num(r.roster_id),
      ownerId: r.owner_id ?? null,
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      wins: num(s.wins) ?? 0,
      losses: num(s.losses) ?? 0,
      ties: num(s.ties) ?? 0,
      // Sleeper splits points across whole and fractional fields.
      pointsFor: Number(`${s.fpts ?? 0}.${s.fpts_decimal ?? 0}`),
      pointsAgainst: Number(`${s.fpts_against ?? 0}.${s.fpts_against_decimal ?? 0}`),
    };
  });
}

export function parseLeagueUsers(json) {
  const out = {};
  for (const u of json ?? []) {
    out[u.user_id] = {
      id: u.user_id,
      displayName: u.display_name ?? 'Unknown',
      teamName: u.metadata?.team_name || u.display_name || 'Unknown',
      avatar: sleeperUrls.avatar(u.avatar),
    };
  }
  return out;
}

export function parseMatchups(json) {
  if (!Array.isArray(json)) return [];
  return json.map((m) => ({
    matchupId: num(m.matchup_id),
    rosterId: num(m.roster_id),
    points: Number(m.points ?? 0),
    starters: m.starters ?? [],
    playerPoints: m.players_points ?? {},
  }));
}

/** Pair rosters that share a matchup_id, attaching owner metadata to each side.
 *  A matchup with one entry is a bye; away stays null rather than inventing one. */
export function joinMatchups(matchups, rosters, users) {
  const rosterById = new Map((rosters ?? []).map((r) => [r.rosterId, r]));
  const groups = new Map();
  for (const m of matchups ?? []) {
    if (m.matchupId === null) continue;
    if (!groups.has(m.matchupId)) groups.set(m.matchupId, []);
    groups.get(m.matchupId).push(m);
  }

  const side = (m) => {
    if (!m) return null;
    const roster = rosterById.get(m.rosterId) ?? null;
    const user = roster?.ownerId ? (users ?? {})[roster.ownerId] : null;
    return {
      rosterId: m.rosterId,
      points: m.points,
      starters: m.starters,
      playerPoints: m.playerPoints,
      teamName: user?.teamName ?? `Roster ${m.rosterId}`,
      displayName: user?.displayName ?? null,
      avatar: user?.avatar ?? null,
      record: roster
        ? `${roster.wins}-${roster.losses}${roster.ties ? `-${roster.ties}` : ''}`
        : null,
    };
  };

  const out = [];
  for (const [matchupId, pair] of groups) {
    const [a, b] = pair;
    const home = side(a);
    const away = side(b);
    const margin = away ? Math.round(Math.abs(home.points - away.points) * 100) / 100 : 0;
    out.push({
      matchupId,
      home,
      away,
      margin,
      leaderRosterId: !away || home.points >= away.points ? home.rosterId : away.rosterId,
    });
  }
  return out.sort((x, y) => x.matchupId - y.matchupId);
}

export const fetchState = async () => parseState(await getJson(sleeperUrls.state()));
export const fetchUser = (nameOrId) => getJson(sleeperUrls.user(nameOrId));
export const fetchUserLeagues = (userId, season) => getJson(sleeperUrls.userLeagues(userId, season));
export const fetchLeague = async (id) => parseLeague(await getJson(sleeperUrls.league(id)));
export const fetchRosters = async (id) => parseRosters(await getJson(sleeperUrls.rosters(id)));
export const fetchLeagueUsers = async (id) => parseLeagueUsers(await getJson(sleeperUrls.leagueUsers(id)));
export const fetchMatchups = async (id, week) => parseMatchups(await getJson(sleeperUrls.matchups(id, week)));
export const fetchTransactions = (id, round) => getJson(sleeperUrls.transactions(id, round));
export const fetchTrending = (type, limit) => getJson(sleeperUrls.trending(type, limit));
