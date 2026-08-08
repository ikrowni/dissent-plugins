// core/fantasy-session.js — the onboarding state machine and its persistence.
//
// Sleeper has no auth, so "who am I" cannot be asked of the API — the user tells us, once,
// and we remember it per-user (storage:user). The channel-wide config_schema league id is a
// seed, not an answer: it says which league this channel is about, not which roster is the
// viewer's.
import { store as defaultStore, KEY } from './store.js';
import { normalizeName } from './players.js';

/**
 * Guess which Sleeper roster belongs to this Dissent user.
 *
 * Matching on the normalised display name is why `members:read` is requested: the common
 * case is that someone's Dissent name and their Sleeper name are the same string modulo
 * case and punctuation. This only ever pre-selects — the UI always shows the full roster
 * list so a wrong guess costs one click, and a null guess is better than a confident wrong
 * one (picking the wrong roster shows someone else's team as "yours").
 */
export function suggestRoster(me, users, rosters) {
  if (!me || !users || !rosters) return null;

  const mine = [me.displayName, me.username].filter(Boolean);
  if (!mine.length) return null;

  // Sleeper handles are usually one token ("MyLeekNeighbor") where a Dissent display name
  // is spaced ("My Leek Neighbor"), so a space-insensitive pass catches a large share of
  // real matches. It runs as a SECOND pass over the whole league, never interleaved: a
  // compact near-match on roster 1 must not beat an exact match on roster 12.
  const compact = (s) => normalizeName(s).replace(/\s+/g, '');

  const exact = new Set(mine.map(normalizeName));
  const loose = new Set(mine.map(compact));

  const hit = (r, norm, wanted) => {
    const u = r.ownerId ? users[r.ownerId] : null;
    if (!u) return null;
    if (wanted.has(norm(u.displayName)) || wanted.has(norm(u.teamName))) {
      return { rosterId: r.rosterId, ownerId: r.ownerId, displayName: u.displayName };
    }
    return null;
  };

  for (const r of rosters) {
    const m = hit(r, normalizeName, exact);
    if (m) return m;
  }
  for (const r of rosters) {
    const m = hit(r, compact, loose);
    if (m) return m;
  }
  return null;
}

/**
 * Steps: 'username' → 'league' → 'roster' → 'ready'.
 * `leagues` and `users`/`rosters` are filled in by the view as it fetches them; this module
 * owns only the state transitions and what is persisted.
 */
export function createSession({ store = defaultStore, configLeagueId = null } = {}) {
  const state = {
    step: 'username',
    username: null,
    userId: null,
    leagues: [],
    leagueId: null,
    rosterId: null,
    error: null,
  };

  async function patchPrefs(patch) {
    // Read-modify-write: prefs also carries reduceMotion (core/app.js), and a blind
    // overwrite here would silently reset the user's motion preference.
    const prefs = (await store.getUser(KEY.prefs(), {})) ?? {};
    const next = { ...prefs, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    await store.setUser(KEY.prefs(), next);
    return next;
  }

  return {
    state,

    async load() {
      const prefs = (await store.getUser(KEY.prefs(), {})) ?? {};
      state.leagueId = prefs.sleeperLeagueId ?? configLeagueId ?? null;
      state.rosterId = prefs.sleeperRosterId ?? null;
      if (state.leagueId && state.rosterId) state.step = 'ready';
      else if (state.leagueId) state.step = 'roster';
      else state.step = 'username';
      return state;
    },

    /** Advance past the username step once their leagues are known. */
    setLeagues(username, userId, leagues) {
      state.username = username;
      state.userId = userId;
      state.leagues = leagues ?? [];
      state.step = state.leagues.length ? 'league' : 'username';
      state.error = state.leagues.length ? null : 'No NFL leagues found for that username.';
      return state;
    },

    selectLeague(leagueId) {
      state.leagueId = String(leagueId);
      state.rosterId = null;
      state.step = 'roster';
      return state;
    },

    async choose({ leagueId, rosterId }) {
      state.leagueId = String(leagueId);
      state.rosterId = Number(rosterId);
      state.step = 'ready';
      await patchPrefs({ sleeperLeagueId: state.leagueId, sleeperRosterId: state.rosterId });
      return state;
    },

    async reset() {
      await patchPrefs({ sleeperLeagueId: undefined, sleeperRosterId: undefined });
      state.step = 'username';
      state.username = null;
      state.userId = null;
      state.leagues = [];
      state.leagueId = null;
      state.rosterId = null;
      state.error = null;
      return state;
    },
  };
}
