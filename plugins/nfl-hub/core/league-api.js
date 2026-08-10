// core/league-api.js — the browser half's view of the native league.
//
// Every call goes through the server module: this file is the ONLY place in the
// client that knows op names, so a renamed op breaks in one place rather than
// nine.
//
// ⚠️ NOTHING HERE IS AUTHORITATIVE. The module re-checks every rule — ownership,
// permissions, roster legality — because this code runs in the user's browser
// and can be made to say anything. Helpers like `canManage` exist to keep the UI
// from offering an action that will be refused, never to decide whether it is
// allowed.

import { invokeModule } from '../../plugin-sdk.js';

const call = (op, payload) => invokeModule({ op, payload });

// ── League lifecycle ─────────────────────────────────────────────────────────
export const listLeagues = () => call('league:list', {});
export const getLeague = (leagueId) => call('league:get', { leagueId });
export const createLeague = (settings, opts = {}) =>
  call('league:create', { settings, ...opts });
export const joinLeague = (leagueId, teamName) =>
  call('league:join', { leagueId, teamName });
export const updateSettings = (leagueId, settings) =>
  call('league:settings', { leagueId, settings });
export const setCurrentWeek = (leagueId, week) =>
  call('league:week', { leagueId, week });

// ── Schedule ─────────────────────────────────────────────────────────────────
//
// ⚠️ The schedule is STORED, not derived. It used to be recomputed in the
// browser from the same pure generator, which agreed by construction — until a
// team joined, at which point the client and a future server copy would silently
// disagree about who played whom in weeks already played.
export const getSchedule = (leagueId, season) => call('schedule:get', { leagueId, season });
export const generateSchedule = (leagueId, opts = {}) =>
  call('schedule:generate', { leagueId, ...opts });

// ── Rosters and lineups ──────────────────────────────────────────────────────
export const setLineup = (leagueId, teamId, week, lineup) =>
  call('lineup:set', { leagueId, teamId, week, lineup });
export const getLineup = (leagueId, teamId, week) =>
  call('lineup:get', { leagueId, teamId, week });
export const addPlayer = (leagueId, teamId, playerId, dropPlayerId = null) =>
  call('roster:add', { leagueId, teamId, playerId, dropPlayerId });
export const dropPlayer = (leagueId, teamId, playerId) =>
  call('roster:drop', { leagueId, teamId, playerId });
export const movePlayer = (leagueId, teamId, playerId, compartment) =>
  call('roster:move', { leagueId, teamId, playerId, compartment });

// ── Draft ────────────────────────────────────────────────────────────────────
export const createDraft = (leagueId, opts = {}) => call('draft:create', { leagueId, ...opts });
export const startDraft = (leagueId) => call('draft:start', { leagueId });
export const getDraft = (leagueId, ranking = []) => call('draft:get', { leagueId, ranking });
export const makePick = (leagueId, teamId, playerId) =>
  call('draft:pick', { leagueId, teamId, playerId });
export const setQueue = (leagueId, teamId, queue) =>
  call('draft:queue', { leagueId, teamId, queue });
export const setPaused = (leagueId, paused) => call('draft:pause', { leagueId, paused });
export const finalizeDraft = (leagueId) => call('draft:finalize', { leagueId });

// ── Waivers ──────────────────────────────────────────────────────────────────
export const submitClaim = (leagueId, teamId, week, playerId, bid, dropPlayerId = null) =>
  call('waiver:submit', { leagueId, teamId, week, playerId, bid, dropPlayerId });
export const cancelClaim = (leagueId, teamId, week, playerId) =>
  call('waiver:cancel', { leagueId, teamId, week, playerId });
export const listClaims = (leagueId, week) => call('waiver:list', { leagueId, week });

// ── Trades ───────────────────────────────────────────────────────────────────
export const proposeTrade = (leagueId, fromTeamId, legs, opts = {}) =>
  call('trade:propose', { leagueId, fromTeamId, legs, ...opts });
export const respondToTrade = (leagueId, tradeId, teamId, action) =>
  call('trade:respond', { leagueId, tradeId, teamId, action });
export const listTrades = (leagueId) => call('trade:list', { leagueId });
export const commissionerTrade = (leagueId, tradeId, approve) =>
  call('trade:commissioner', { leagueId, tradeId, approve });

// ── Scores and standings ─────────────────────────────────────────────────────
export const getScores = (leagueId, season, week) =>
  call('scores:get', { leagueId, season, week });

// ⚠️ Standings are computed by the MODULE, not here. They decide playoff
// seeding, so a second answer to "what is my record" is worse than a second
// answer to "who do I play" — and working it out client-side would mean fetching
// every week separately for a number the node already holds.
export const getStandings = (leagueId, season) =>
  call('standings:get', { leagueId, season });

// ── UI-only helpers ──────────────────────────────────────────────────────────

/** Does this user manage that team? Mirrors the module; never trusted by it. */
export function canManage(league, teamId) {
  return (league?.myTeams ?? []).includes(String(teamId));
}

/** The team this user manages, or null. */
export function myTeam(league) {
  return (league?.myTeams ?? [])[0] ?? null;
}

/**
 * A roster's players split by the slots they can fill.
 *
 * ⚠️ Presentation only. The module decides legality against its own trusted
 * position index; this exists so a lineup editor can group sensibly, and a
 * disagreement between the two shows up as a refused save rather than a wrong
 * roster.
 */
export function groupByPosition(playerIds, positionOf) {
  const out = {};
  for (const id of playerIds ?? []) {
    const pos = positionOf?.(id) ?? '—';
    (out[pos] ??= []).push(id);
  }
  return out;
}

/** Milliseconds to a mm:ss clock, for the draft. */
export function formatClock(ms) {
  if (ms === null || ms === undefined) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
