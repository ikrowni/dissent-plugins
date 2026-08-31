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

/**
 * Is this the SDK's mangled form of a module op that returned null?
 *
 * 🔴 THE SDK CANNOT TELL "no data" FROM "data is null", AND IT SHOWS.
 * `invokeModule` unwraps the module's `{ok, data}` envelope with
 * `return inner?.data ?? inner` — and `??` treats a null `data` as "absent" and
 * falls back to THE ENVELOPE ITSELF. So an op that answers "there is nothing
 * here" hands the caller a truthy `{ok:true, data:null}` object.
 *
 * That is not a cosmetic difference. `getPlayoffs` returns null when a league
 * has no bracket, and views/league-matchup.js branches on `state.bracket` being
 * truthy — so on 2026-08-31 a league in WEEK 1 rendered the postseason pane,
 * empty, and the regular season was unreachable behind it. The "Generate
 * schedule" button lives on that unreachable branch, so a freshly drafted league
 * had no way to create the schedule its matchups needed. `getSchedule` returns
 * null the same way, so fixing only the bracket would have revealed it next.
 *
 * ⚠️ The real fix belongs in the SDK, which is EMBEDDED IN THE GO BINARY
 * (internal/api/handlers/pluginsdk/plugin-sdk.js, served by ServePluginSDKShim)
 * — so it needs a dissent-core release and affects every plugin. This narrows
 * the blast radius to nfl-hub until that happens.
 *
 * ⚠️ MATCHED EXACTLY, never loosely. Only the precise two-key envelope counts,
 * so an op whose legitimate answer merely CONTAINS an `ok` field is untouched.
 */
function isNullEnvelope(v) {
  return v !== null
    && typeof v === 'object'
    && !Array.isArray(v)
    && v.ok === true
    && v.data === null
    && Object.keys(v).length === 2;
}

const call = async (op, payload) => {
  const res = await invokeModule({ op, payload });
  return isNullEnvelope(res) ? null : res;
};

export { isNullEnvelope as _isNullEnvelope };

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

// ── Identity ─────────────────────────────────────────────────────────────────
//
// ⚠️ IMAGES ARE FILE IDS, NEVER URLS. The module refuses anything that is not a
// node-minted id, and `core/team-images.js` redeems one for a signed, expiring
// node URL at render time. The reasoning is in server/ops-identity.js: a URL in
// a team record is rendered into every other manager's DOM.
//
// ⚠️ ABSENT AND EMPTY DIFFER. Omit a field to leave it alone; send '' to CLEAR
// it. That is what makes it possible to drop an avatar without also dropping the
// banner, so these bindings pass only the fields they were given.
export const renameTeam = (leagueId, teamId, name) =>
  call('team:rename', { leagueId, teamId, name });
export const setTeamIdentity = (leagueId, teamId, patch) =>
  call('team:identity', { leagueId, teamId, ...patch });
export const setLeagueBanner = (leagueId, bannerFileId) =>
  call('league:identity', { leagueId, bannerFileId });

// ── Co-ownership ─────────────────────────────────────────────────────────────
//
// ⚠️ A HANDSHAKE, NOT AN INVITE, and the reason is worth knowing before reading
// the UI: the module has no user directory, so an owner naming a user id could
// attach a typo or a stranger who never agreed, and nothing could check it. The
// prospective co-owner asks first — which records THEIR verified session — and
// the owner approves from that list. Both ids are then real and both consented.
// `label` is the requester's own display name, carried only so the owner sees
// something more useful than a snowflake in the approval prompt. The module
// never treats it as identity — see server/ops-coowners.js.
export const requestCoOwnership = (leagueId, teamId, label = '') =>
  call('team:coowner:request', { leagueId, teamId, label });
export const withdrawCoOwnershipRequest = (leagueId, teamId) =>
  call('team:coowner:request', { leagueId, teamId, withdraw: true });
export const respondToCoOwnerRequest = (leagueId, teamId, userId, approve) =>
  call('team:coowner:respond', { leagueId, teamId, userId, approve });
export const removeCoOwner = (leagueId, teamId, userId) =>
  call('team:coowner:remove', { leagueId, teamId, userId });

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
// ⚠️ `subs` is { [starterPlayerId]: subPlayerId }. Wire every binding to a
// caller when you add it — `setQueue` shipped here unused for a whole release
// and every autodraft silently fell through to the league ranking.
export const setAutoSubs = (leagueId, teamId, week, subs) =>
  call('autosub:set', { leagueId, teamId, week, subs });
export const getAutoSubs = (leagueId, teamId, week) =>
  call('autosub:get', { leagueId, teamId, week });
// ⚠️ `players`/`picks` set the block; `interest` sets what this team wants.
// Omit a field to leave that half untouched — sending [] CLEARS it.
export const setTradeBlock = (leagueId, teamId, patch) =>
  call('tradeblock:set', { leagueId, teamId, ...patch });
export const getTradeBlock = (leagueId) =>
  call('tradeblock:get', { leagueId });
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
// ⚠️ `ranking` is not cosmetic on a pick either. The module resolves any lapsed
// picks in the SAME swap before applying this one, and it autodrafts them from
// the ranking — sending none means a pick that arrives after somebody else's
// clock expired cannot resolve the lapse and is refused.
export const makePick = (leagueId, teamId, playerId, ranking = []) =>
  call('draft:pick', { leagueId, teamId, playerId, ranking });
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
export const getWaiverWire = (leagueId) => call('waiver:wire', { leagueId });

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

// ── Playoffs ─────────────────────────────────────────────────────────────────
//
// ⚠️ getPlayoffs ADVANCES the bracket as a side effect: a round is decided when
// its week is scored, and reading is what resolves that. Same shape as the draft
// clock, and the reason the view polls rather than caching.
export const getPlayoffs = (leagueId, season) => call('playoffs:get', { leagueId, season });
export const startPlayoffs = (leagueId, opts = {}) =>
  call('playoffs:start', { leagueId, ...opts });

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
