// core/espn-client.js — ESPN url builders and fetches. Parsing lives in espn-game.js
// and espn-league.js so the parsers stay testable without a transport.
//
// Endpoint choices here are load-bearing and were measured, not assumed. See the
// comments on standings and teamRoster before "simplifying" either.
import { getJson } from './http.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const WEB  = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl';
const WEB2 = 'https://site.web.api.espn.com/apis/v2/sports/football/nfl';
const CDN  = 'https://a.espncdn.com';

/** ESPN's game endpoints repeat the event id as the competition id. */
const comp = (id) => `${CORE}/events/${id}/competitions/${id}`;

export const urls = {
  scoreboard({ season, seasonType, week }) {
    if (!season && !week) return `${SITE}/scoreboard`;
    const p = new URLSearchParams();
    if (season) p.set('dates', String(season));
    if (seasonType) p.set('seasontype', String(seasonType));
    if (week) p.set('week', String(week));
    return `${SITE}/scoreboard?${p}`;
  },
  summary: (eventId) => `${SITE}/summary?event=${eventId}`,
  plays: (eventId) => `${comp(eventId)}/plays?limit=400`,
  drives: (eventId) => `${comp(eventId)}/drives`,
  probabilities: (eventId) => `${comp(eventId)}/probabilities?limit=200`,
  odds: (eventId) => `${comp(eventId)}/odds`,

  /** NOT `${SITE}/standings` — measured 2026-08-07, that returns 86 bytes
   *  ({"fullViewLink":{…}} and nothing else) at HTTP 200, which is why the shipped v1
   *  plugin's Standings tab renders nothing. level=3 yields eight divisions of four;
   *  level=2 gives two conferences of sixteen and level=1 gives nothing. */
  standings: (season, level = 3) => `${WEB2}/standings?season=${season}&level=${level}`,

  news: (limit = 25) => `${SITE}/news?limit=${limit}`,
  teamSchedule: (teamId) => `${SITE}/teams/${teamId}/schedule`,

  /** ?enable=roster is 356 KB and carries an injuries array on every athlete, which is
   *  how team pages get injury data.
   *
   *  There is deliberately NO leagueInjuries builder: `${SITE}/injuries` is 8.95 MB on
   *  the wire — nine times the 1 MB fetch:external cap — and the per-team core-api
   *  variant (`/teams/{id}/injuries`) returns bare $ref stubs, one fetch per injury.
   *  Game Center takes injuries from the summary payload instead, which already
   *  carries a full inline block for both teams. */
  teamRoster: (teamId) => `${SITE}/teams/${teamId}?enable=roster`,

  depthChart: (teamId, season) => `${CORE}/seasons/${season}/teams/${teamId}/depthcharts`,
  leaders: () => `${CORE}/leaders`,
  athlete: (athleteId) => `${WEB}/athletes/${athleteId}/overview`,

  /** Headshots MUST go through the combiner resizer: the raw asset is ~230 KB and the
   *  resized one ~28 KB. Wrap the result in imageUrl() before assigning to img.src —
   *  a direct espncdn load is a CSP violation and leaks the viewer's IP. */
  headshot: (athleteId, w = 200) =>
    `${CDN}/combiner/i?img=/i/headshots/nfl/players/full/${athleteId}.png&w=${w}&h=${Math.round(w * 0.725)}`,
};

export const fetchScoreboard = (opts = {}) => getJson(urls.scoreboard(opts));
export const fetchSummary = (id) => getJson(urls.summary(id));
export const fetchPlays = (id) => getJson(urls.plays(id));
export const fetchDrives = (id) => getJson(urls.drives(id));
export const fetchProbabilities = (id) => getJson(urls.probabilities(id));
export const fetchOdds = (id) => getJson(urls.odds(id));
export const fetchStandings = (season) => getJson(urls.standings(season));
export const fetchNews = (limit) => getJson(urls.news(limit));
export const fetchLeaders = () => getJson(urls.leaders());
export const fetchAthlete = (id) => getJson(urls.athlete(id));
export const fetchTeamSchedule = (id) => getJson(urls.teamSchedule(id));
export const fetchTeamRoster = (id) => getJson(urls.teamRoster(id));
export const fetchDepthChart = (id, season) => getJson(urls.depthChart(id, season));
// No fetchInjuries: see the comment on urls.teamRoster. Injuries come from the summary
// payload (Game Center) or the team roster payload (team pages).
