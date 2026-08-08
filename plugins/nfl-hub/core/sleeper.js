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
  // UNDOCUMENTED but stable, and on a host already in allowed_fetch_domains. 508 KiB —
  // ~45% headroom under the 1 MB fetch:external cap — returned as a dict keyed by Sleeper
  // player_id, which is the same key matchups.starters and players_points use. One fetch
  // covers every roster in the league and needs no name join.
  //
  // NOT the query-param form (/projections/nfl/{season}/{week}?position[]=…): with the six
  // fantasy positions that is 2.05 MB, twice the cap. Measured 2026-08-08.
  projections: (season, week) => `${API}/projections/nfl/regular/${season}/${week}`,
  trending: (type = 'add', limit = 25) =>
    `${API}/players/nfl/trending/${type}?limit=${limit}`,
  avatar: (id) => (id ? `${CDN}/avatars/thumbs/${id}` : null),
};

/** Player headshot. Keyed by Sleeper's own player_id, so unlike the ESPN join this is
 *  100% coverage with no name matching.
 *
 *  ⚠️ ~99 KB per image, and the `thumb/` path returns byte-identical content — measured
 *  2026-08-08, there is no cheaper variant. A 24-row matchup is therefore ~2.4 MB through
 *  the node image proxy, which is metered. Always render these `loading="lazy"`; most of
 *  the lineup is below the fold. This is the first thing to cut if the fantasy section
 *  shows up in the bandwidth meter.
 *
 *  sleepercdn.com is deliberately NOT in allowed_fetch_domains: these load as <img src>
 *  through the node image proxy (which is allowlist-free), not via fetch:external. */
export const headshotUrl = (playerId) =>
  (playerId ? `${CDN}/content/nfl/players/${playerId}.jpg` : null);

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
      // ppts is Sleeper's "potential points": what the roster would have scored with the
      // optimal lineup. The gap to pointsFor is the points left on the bench, and wave 3B's
      // luck metric is derived from it. Split across whole/decimal fields like fpts.
      potentialPoints: Number(`${s.ppts ?? 0}.${s.ppts_decimal ?? 0}`),
      waiverBudgetUsed: num(s.waiver_budget_used) ?? 0,
      waiverPosition: num(s.waiver_position) ?? 0,
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

/** Normalise the projection dict, keeping only records that actually carry points.
 *
 *  Only ~858 of 9,403 records do; the rest are ADP-only stubs like {"adp_dd_ppr": 1000}.
 *  Keeping them would hand the UI a projection of `undefined` for most of the league. */
export function parseProjections(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  const out = {};
  for (const [id, stats] of Object.entries(json)) {
    if (!stats || typeof stats !== 'object') continue;
    const ppr = Number(stats.pts_ppr);
    const half = Number(stats.pts_half_ppr);
    const std = Number(stats.pts_std);
    if (!Number.isFinite(ppr) && !Number.isFinite(half) && !Number.isFinite(std)) continue;
    out[String(id)] = {
      ppr: Number.isFinite(ppr) ? ppr : 0,
      halfPpr: Number.isFinite(half) ? half : 0,
      std: Number.isFinite(std) ? std : 0,
    };
  }
  return out;
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
export const fetchProjections = async (season, week) =>
  parseProjections(await getJson(sleeperUrls.projections(season, week)));
export const fetchTransactions = (id, round) => getJson(sleeperUrls.transactions(id, round));
export const fetchTrending = (type, limit) => getJson(sleeperUrls.trending(type, limit));
