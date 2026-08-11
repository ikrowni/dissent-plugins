// views/fantasy.js — Fantasy Command: the section shell, onboarding, and sub-tab routing.
//
// The sub-views (matchup, matchups, roster) are separate modules; this one owns which is
// showing and renders their HTML into its own body. Onboarding lives here because it is the
// gate: nothing else in the section can render without a league and a roster.
import { esc, panel, stateMsg, errorPane} from '../core/ui.js';
import { cache, TTL } from '../core/cache.js';
import { createSession, suggestRoster } from '../core/fantasy-session.js';
import { players } from '../core/players.js';
import { buildNflContext } from '../core/fantasy-nfl.js';
import { parseScoreboard } from '../core/espn-game.js';
import { urls, fetchScoreboard, fetchStandings } from '../core/espn-client.js';
import { strengthFromStandings } from '../core/opponent-strength.js';
import {
  sleeperUrls, fetchUser, fetchUserLeagues, fetchLeague, fetchRosters, fetchLeagueUsers,
  fetchMatchups, fetchProjections, joinMatchups, parseLeague, deepLink,
  fetchTransactionsParsed, fetchDrafts, fetchUserDrafts, fetchDraftPicks,
  fetchWinnersBracket, fetchLosersBracket,
} from '../core/sleeper.js';
import { store, KEY } from '../core/store.js';
import { groupByWeek } from '../core/sleeper-league.js';
import { weeklyScores, powerRankings } from '../core/power.js';
import { draftBoard, mergeDrafts } from '../core/sleeper-draft.js';
import { bracketRounds } from '../core/sleeper-bracket.js';
import { remainingGames, simulate } from '../core/playoff-odds.js';
import { request, getIdentity } from '../../plugin-sdk.js';

export const TABS = [
  ['matchup', 'My Matchup'],
  ['matchups', 'All Matchups'],
  ['roster', 'My Roster'],
  ['power', 'Power'],
  ['moves', 'Moves'],
  ['draft', 'Draft'],
  ['bracket', 'Bracket'],
];

/** The bracket only exists in the postseason — an empty tab reads as a broken one. */
export function visibleTabs(s) {
  const hasBracket = (s?.bracketRounds ?? []).length > 0;
  return TABS.filter(([id]) => id !== 'bracket' || hasBracket);
}

export function renderTabs(active, s) {
  return `<div class="subnav" role="tablist">${visibleTabs(s).map(([id, label]) => (
    `<button data-act="fantasy-tab" data-tab="${esc(id)}" role="tab"`
    + ` aria-current="${String(id === active)}">${esc(label)}</button>`
  )).join('')}</div>`;
}

export function renderOnboarding(s) {
  const err = s?.error ? `<div class="onb-error" role="alert">${esc(s.error)}</div>` : '';

  if (s?.step === 'league') {
    return panel({
      title: 'Pick your league',
      body: err + '<div class="onb-list">' + (s.leagues ?? []).map((l) => (
        `<button class="onb-item" data-act="pick-league" data-league="${esc(l.id)}">`
        + `<span class="onb-name">${esc(l.name)}</span>`
        + `<span class="onb-meta">${esc(l.teams)} teams · ${esc(l.scoringType ?? '')}</span>`
        + '</button>'
      )).join('') + '</div>',
    });
  }

  if (s?.step === 'roster') {
    const choices = s.rosterChoices ?? [];
    return panel({
      title: 'Which team is yours?',
      right: '<span class="kicker">matched against this server’s members</span>',
      body: err + '<div class="onb-list">' + choices.map((c) => (
        `<button class="onb-item${c.suggested ? ' suggested' : ''}" data-act="pick-roster"`
        + ` data-roster="${esc(c.rosterId)}" aria-pressed="${String(!!c.suggested)}">`
        + `<span class="onb-name">${esc(c.teamName)}</span>`
        + `<span class="onb-meta">${esc(c.displayName ?? '')}`
        + (c.suggested ? ' · <b>likely you</b>' : '') + '</span>'
        + '</button>'
      )).join('') + '</div>',
    });
  }

  // step === 'username'
  return panel({
    title: 'Connect your Sleeper league',
    body: err
      + '<p class="onb-copy">Sleeper has no login for apps, so tell us who you are once. '
      + 'Nothing is sent anywhere but Sleeper, and only you can see your pick.</p>'
      + '<div class="onb-form">'
        + '<input data-act="sleeper-username" type="text" autocomplete="off" spellcheck="false"'
        + ' placeholder="Your Sleeper username" aria-label="Sleeper username">'
        + '<button class="retry" data-act="sleeper-lookup">Find my leagues</button>'
      + '</div>'
      // Spec §4.4: a league id can also be entered directly. Someone who already knows it
      // should not have to remember a username to get past this screen.
      + '<div class="onb-form onb-alt">'
        + '<input data-act="sleeper-leagueid" type="text" autocomplete="off" spellcheck="false"'
        + ' placeholder="…or paste a league ID" aria-label="Sleeper league ID">'
        + '<button class="retry" data-act="sleeper-use-league">Use this league</button>'
      + '</div>',
  });
}

export function renderFantasy(s) {
  if (!s?.session || s.session.step !== 'ready') {
    const os = s?.session ?? { step: 'username' };
    return '<div class="fantasy-wrap">'
      + renderOnboarding({ ...os, rosterChoices: s?.rosterChoices ?? os.rosterChoices })
      + '</div>';
  }
  if (s.loading) return stateMsg('Loading your league…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load this league.');

  return '<div class="fantasy-wrap">'
    + '<div class="fantasy-head">'
      + renderTabs(s.tab, s)
      + '<button class="badge" data-act="fantasy-reset">Change league</button>'
    + '</div>'
    + (s.body ?? '')
    + '</div>';
}

// ── State and loading ────────────────────────────────────────────────────────

const state = {
  session: null, loading: false, error: null, tab: 'matchup', body: '',
  league: null, rosters: [], users: {}, matchups: [], projections: {}, joined: [],
  rosterChoices: [], week: null, season: null, playerIndex: null, nfl: null,
  power: [], moves: [], board: null, draft: null, drafts: [], draftId: null,
  bracketRounds: [], bracketKind: 'winners', odds: null,
  rosterNames: {}, rosterOwner: {}, playerNames: {}, strength: {},
};

/**
 * The shape every render receives.
 *
 * `state.session` is the createSession() OBJECT ({ state, load, choose, … }); renders want
 * its plain state. Flattening it here — once, in one place — is what keeps a render from
 * having to know the difference. Reading `s.session.step` off the session object instead
 * silently yields undefined, which pins onboarding to its first screen forever; that bug
 * shipped past twelve green tests because they passed a plain object as the double.
 */
export function viewModel(st = state) {
  return { ...st, session: st.session?.state ?? null };
}

export function render() { return renderFantasy(viewModel()); }

/** The host exposes members:list under the members:read permission, but plugin-sdk.js has
 *  no wrapper for it — and adding one to the shared SDK for a single plugin would be a core
 *  file changed for a plugin-specific reason. The generic request() reaches it directly.
 *  Failure is non-fatal: without members the roster list simply has no suggestion. */
async function fetchMembers() {
  try {
    const r = await request('members:list', {});
    return r?.members ?? [];
  } catch {
    return [];
  }
}

async function loadLeague(leagueId, week) {
  const season = state.season ?? new Date().getFullYear();
  const [league, rosters, users, matchups, projections] = await Promise.all([
    cache.get(sleeperUrls.league(leagueId), () => fetchLeague(leagueId),
      TTL.SLEEPER_LEAGUE, { staleOnError: true }).catch(() => null),
    cache.get(sleeperUrls.rosters(leagueId), () => fetchRosters(leagueId),
      TTL.SLEEPER_LEAGUE, { staleOnError: true }).catch(() => []),
    cache.get(sleeperUrls.leagueUsers(leagueId), () => fetchLeagueUsers(leagueId),
      TTL.SLEEPER_LEAGUE, { staleOnError: true }).catch(() => ({})),
    cache.get(sleeperUrls.matchups(leagueId, week), () => fetchMatchups(leagueId, week),
      TTL.SLEEPER_MATCHUPS, { staleOnError: true }).catch(() => []),
    // Projections are the one optional payload: 508 KiB, and every view degrades to
    // actual-only without them. Never let them fail the whole section.
    cache.get(sleeperUrls.projections(season, week), () => fetchProjections(season, week),
      TTL.SLEEPER_PROJECTIONS, { staleOnError: true }).catch(() => ({})),
  ]);

  state.league = league;
  state.rosters = rosters;
  state.users = users;
  state.matchups = matchups;
  state.projections = projections;
  state.joined = joinMatchups(matchups, rosters, users);
  indexRosters();
}

/** The live-NFL half of the section: the player index (Sleeper id → name/team/ESPN id) and
 *  this week's slate. Both are optional — the section renders without either, just with
 *  less context, which is the graceful-degradation rule in spec §6.3. */
async function loadNfl() {
  const [, sb] = await Promise.all([
    players.load().catch(() => false),
    cache.get(urls.scoreboard({}), () => fetchScoreboard({}),
      TTL.SCOREBOARD_IDLE, { staleOnError: true }).catch(() => null),
  ]);
  state.playerIndex = players.isReady ? players : null;
  const games = sb ? parseScoreboard(sb).games : [];
  // Injuries ride along with the roster payloads team pages already fetch; wave 3A wires
  // the slate and leaves the injury map empty rather than adding 32 fetches for it.
  state.nfl = buildNflContext(games, []);
}

/** Build the roster picker, with the viewer's likely team pre-selected. */
async function buildRosterChoices() {
  const [identity] = await Promise.all([
    getIdentity().catch(() => null),
    // Fetched for the spec's "matched against server members" promise. The suggestion
    // itself keys off identity; members is what makes that permission meaningful and is
    // where a future multi-member mapping will read from.
    fetchMembers(),
  ]);
  const me = identity
    ? { username: identity.username, displayName: identity.display_name ?? identity.displayName }
    : null;
  const guess = suggestRoster(me, state.users, state.rosters);
  state.rosterChoices = state.rosters.map((r) => {
    const u = r.ownerId ? state.users[r.ownerId] : null;
    return {
      rosterId: r.rosterId,
      teamName: u?.teamName ?? `Roster ${r.rosterId}`,
      displayName: u?.displayName ?? null,
      suggested: guess?.rosterId === r.rosterId,
    };
  });
}

async function renderBody() {
  const MODS = {
    matchups: () => import('./fantasy-matchups.js'),
    roster: () => import('./fantasy-roster.js'),
    power: () => import('./fantasy-power.js'),
    moves: () => import('./fantasy-moves.js'),
    draft: () => import('./fantasy-draft.js'),
    bracket: () => import('./fantasy-bracket.js'),
  };
  const mod = await (MODS[state.tab] ?? (() => import('./fantasy-matchup.js')))();
  try {
    state.body = mod.renderPanel(viewModel());
  } catch (err) {
    // A throwing sub-view must not blank the section — the tabs stay usable.
    console.error(`[nfl-hub] fantasy/${state.tab} render failed:`, err);
    state.body = stateMsg('This tab could not be displayed.', { retry: true });
  }
}

/** Roster id -> team name, and roster id -> owner id. Both views need the mapping. */
function indexRosters() {
  state.rosterOwner = {};
  state.rosterNames = {};
  for (const r of state.rosters ?? []) {
    state.rosterOwner[r.rosterId] = r.ownerId;
    state.rosterNames[r.rosterId] = state.users?.[r.ownerId]?.teamName ?? `Roster ${r.rosterId}`;
  }
}

/**
 * Every week's matchups from week 1 through the end of the regular season.
 *
 * All-play cannot be derived from season totals, so the PAST weeks are all needed; the
 * playoff sim needs the FUTURE ones, which Sleeper returns pre-paired with zeroed points.
 * `weeklyScores` drops the zeroed weeks, so fetching past the current week costs the power
 * table nothing.
 *
 * Three TTLs, because the three kinds of week are not equally volatile: a completed week
 * is immutable (6h), the current week is live (30s), and a future week's pairing only
 * changes if the commissioner edits the schedule (1h). Seventeen weeks is ~180 KB total,
 * and cache.get coalesces the fan-out.
 */
async function loadWeeks(leagueId, currentWeek, throughWeek) {
  const weeks = [];
  for (let w = 1; w <= throughWeek; w += 1) {
    const ttl = w < currentWeek ? TTL.SLEEPER_WEEK_FINAL
      : w === currentWeek ? TTL.SLEEPER_MATCHUPS
        : TTL.SLEEPER_LEAGUE;
    weeks.push(
      cache.get(sleeperUrls.matchups(leagueId, w), () => fetchMatchups(leagueId, w), ttl,
        { staleOnError: true })
        .then((matchups) => ({ week: w, matchups }))
        .catch(() => ({ week: w, matchups: [] })),
    );
  }
  return Promise.all(weeks);
}

async function loadPower(leagueId, week) {
  // Through the last regular-season week — week `start` is already the postseason, whose
  // matchups the seeding sim must not treat as regular-season games.
  const start = state.league?.playoffWeekStart ?? 15;
  const weeks = await loadWeeks(leagueId, week, Math.max(week, start - 1));
  const scored = weeklyScores(weeks);
  state.power = powerRankings(state.rosters, scored);
  return { weeks, scored };
}

/** Recent weeks only. A full-season feed is 17 requests for a list nobody scrolls. */
async function loadMoves(leagueId, week, back = 4) {
  const first = Math.max(1, week - back + 1);
  const legs = [];
  for (let w = first; w <= week; w += 1) {
    legs.push(
      cache.get(`tx:${leagueId}:${w}`, () => fetchTransactionsParsed(leagueId, w),
        TTL.SLEEPER_TRANSACTIONS, { staleOnError: true }).catch(() => []),
    );
  }
  const feed = (await Promise.all(legs)).flat();
  state.moves = groupByWeek(feed);

  // The feed carries player IDs only. Without this the whole list reads "Player 11600",
  // which the view treats as its unknown-player fallback, not as a rendered name.
  const names = {};
  for (const t of feed) {
    const ids = [
      ...t.transfers.map((x) => x.playerId),
      ...t.adds.map((x) => x.playerId),
      ...t.drops.map((x) => x.playerId),
    ];
    for (const id of ids) {
      if (names[id]) continue;
      const p = state.playerIndex?.get(id);
      if (p?.name) names[id] = p.name;
    }
  }
  state.playerNames = names;
}

/**
 * Every draft this user can see — league drafts AND mocks.
 *
 * ⚠️ TWO SOURCES, ON PURPOSE. This used to read `/league/{id}/drafts` alone and take
 * `drafts[0]`, which had two consequences on a live account (measured 2026-08-08):
 *
 *   - MOCKS WERE INVISIBLE. A mock draft sits behind a league that
 *     `/user/{id}/leagues/nfl/{season}` does not return, so a by-league lookup can never
 *     reach one. That account had 4 drafts and 1 listable league: 3 were unreachable.
 *   - `drafts[0]` silently discarded every draft after the first, so a league with a
 *     redraft and a rookie draft only ever showed one of them.
 *
 * The user endpoint is season-scoped and the league endpoint is not, so both are kept
 * and merged. A failure of either leaves the other's results rather than emptying the tab.
 */
async function loadDraft(leagueId) {
  const { userId, leagues } = state.session.state;
  const season = state.season ?? new Date().getUTCFullYear();

  const [userDrafts, leagueDrafts] = await Promise.all([
    userId
      ? cache.get(sleeperUrls.userDrafts(userId, season), () => fetchUserDrafts(userId, season),
        TTL.SLEEPER_DRAFT, { staleOnError: true }).catch(() => [])
      : Promise.resolve([]),
    leagueId
      ? cache.get(sleeperUrls.drafts(leagueId), () => fetchDrafts(leagueId),
        TTL.SLEEPER_DRAFT, { staleOnError: true }).catch(() => [])
      : Promise.resolve([]),
  ]);

  state.drafts = mergeDrafts(userDrafts, leagueDrafts,
    (leagues ?? []).map((l) => l.leagueId ?? l.league_id));

  // Keep the viewer's choice across a refresh; otherwise open the most recent.
  const chosen = state.drafts.find((d) => d.draftId === state.draftId) ?? state.drafts[0] ?? null;
  state.draft = chosen;
  state.draftId = chosen?.draftId ?? null;
  if (!chosen) { state.board = null; return; }

  const picks = await cache.get(sleeperUrls.draftPicks(chosen.draftId),
    () => fetchDraftPicks(chosen.draftId), TTL.SLEEPER_DRAFT, { staleOnError: true })
    .catch(() => []);
  state.board = draftBoard(picks);
}

async function loadBracket(leagueId) {
  const fetcher = state.bracketKind === 'losers' ? fetchLosersBracket : fetchWinnersBracket;
  const url = state.bracketKind === 'losers'
    ? sleeperUrls.losersBracket(leagueId) : sleeperUrls.winnersBracket(leagueId);
  const raw = await cache.get(url, () => fetcher(leagueId), TTL.SLEEPER_BRACKET,
    { staleOnError: true }).catch(() => []);
  state.bracketRounds = bracketRounds(raw);
}

/**
 * Playoff odds, cached to storage so re-opening the tab does not re-run 5,000 seasons.
 *
 * Fire-and-forget: the power tab renders immediately with "Simulating…" and repaints when
 * this resolves. A failed storage read only costs a recompute.
 */
async function loadOdds(leagueId, week, scored, weeks) {
  const key = KEY.playoffOdds(leagueId, state.season, week);
  const cached = await store.getUser(key, null);
  if (cached) { state.odds = cached; return; }

  const start = state.league?.playoffWeekStart ?? 15;
  const future = weeks.filter((w) => w.week > week && w.week < start);
  const rows = await simulate({
    rosters: state.rosters,
    scored,
    remaining: remainingGames(future),
    playoffTeams: state.league?.playoffTeams ?? 6,
  });
  state.odds = Object.fromEntries(rows.map((r) => [r.rosterId, r.odds]));
  await store.setUser(key, state.odds);
}

/**
 * The data only the ACTIVE tab needs.
 *
 * Called both from refreshAll and from the tab-switch handler — a tab switch does not
 * re-run refreshAll, so without this second call the wave 3B tabs would render their empty
 * state forever. Each loader already catches to a neutral value, so a failure here leaves
 * one tab empty rather than blanking the section (spec §6.3).
 */
async function loadTab(app, leagueId, week) {
  if (state.tab === 'roster') {
    // Cache the RAW standings payload under exactly the key views/standings.js uses, so
    // the two sections share one request. Parsing happens after the cache, never inside
    // it — caching the parsed table here would hand the Standings view the wrong shape
    // the next time it reads this key.
    const season = state.season ?? new Date().getFullYear();
    const raw = await cache.get(urls.standings(season), () => fetchStandings(season),
      TTL.STANDINGS, { staleOnError: true }).catch(() => null);
    state.strength = raw ? strengthFromStandings(raw) : {};
    return;
  }
  if (state.tab === 'power') {
    const { weeks, scored } = await loadPower(leagueId, week);
    loadOdds(leagueId, week, scored, weeks).then(() => app.router?.refresh()).catch(() => {});
  } else if (state.tab === 'moves') {
    await loadMoves(leagueId, week);
  } else if (state.tab === 'draft') {
    await loadDraft(leagueId);
  }
}

async function refreshAll(app) {
  const leagueId = state.session.state.leagueId;
  state.loading = true;
  app.router.refresh();
  try {
    await Promise.all([
      loadLeague(leagueId, state.week),
      loadNfl(),
    ]);
    // Unconditional: visibleTabs needs to know whether a bracket exists before it can
    // decide to show the tab at all, so this cannot wait for the tab to be selected.
    await loadBracket(leagueId).catch(() => {});
    await loadTab(app, leagueId, state.week);
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  }
  state.loading = false;
  await renderBody();
  app.router.refresh();
}

async function toRosterStep(app, leagueId) {
  state.loading = true;
  app.router.refresh();
  await loadLeague(leagueId, state.week);
  await buildRosterChoices();
  state.loading = false;
  app.router.refresh();
}

export async function enter() {
  const { app } = await import('../core/app.js');
  state.week = app.week ?? 1;
  state.season = app.season ?? new Date().getFullYear();

  if (!state.session) {
    state.session = createSession({
      configLeagueId: app.ctx?.config?.sleeper_league_id ?? null,
    });
    await state.session.load();
  }

  app.onAction = async (act, el) => {
    if (act === 'fantasy-tab') {
      state.tab = el.dataset.tab;
      const leagueId = state.session?.state?.leagueId;
      if (leagueId) await loadTab(app, leagueId, state.week).catch(() => {});
      await renderBody();
      app.router.refresh();
      return;
    }
    if (act === 'fantasy-reset') {
      await state.session.reset();
      state.rosterChoices = [];
      app.router.refresh();
      return;
    }
    if (act === 'sleeper-lookup') {
      const input = document.querySelector('[data-act="sleeper-username"]');
      const name = String(input?.value ?? '').trim();
      if (!name) return;
      state.session.state.error = null;
      try {
        const u = await fetchUser(name);
        if (!u?.user_id) {
          state.session.state.error = `No Sleeper user called “${name}”.`;
          app.router.refresh();
          return;
        }
        const raw = await fetchUserLeagues(u.user_id, state.season);
        state.session.setLeagues(name, u.user_id, (raw ?? []).map(parseLeague).filter(Boolean));
      } catch {
        state.session.state.error = 'Could not reach Sleeper. Try again.';
      }
      app.router.refresh();
      return;
    }
    if (act === 'sleeper-use-league') {
      const input = document.querySelector('[data-act="sleeper-leagueid"]');
      const id = String(input?.value ?? '').trim();
      // Sleeper league ids are numeric strings; rejecting junk here is cheaper than a
      // fetch that 404s and leaves the user staring at a generic error.
      if (!/^\d{6,}$/.test(id)) {
        state.session.state.error = 'That does not look like a Sleeper league ID.';
        app.router.refresh();
        return;
      }
      state.session.selectLeague(id);
      await toRosterStep(app, id);
      if (!state.league) {
        state.session.state.error = 'No league with that ID.';
        state.session.state.step = 'username';
        app.router.refresh();
      }
      return;
    }
    if (act === 'pick-league') {
      state.session.selectLeague(el.dataset.league);
      await toRosterStep(app, el.dataset.league);
      return;
    }
    if (act === 'pick-roster') {
      await state.session.choose({
        leagueId: state.session.state.leagueId, rosterId: el.dataset.roster,
      });
      await refreshAll(app);
      return;
    }
    if (act === 'draft-pick') {
      // Remember the choice so a refresh does not silently snap back to the newest.
      state.draftId = el.dataset.draft;
      await loadDraft(state.session.state.leagueId);
      app.paint();
      return;
    }
    if (act === 'draft-open') {
      window.open(deepLink.draft(null, el.dataset.draft), '_blank', 'noopener');
      return;
    }
    if (act === 'sleeper-open') {
      window.open(deepLink.league(state.session.state.leagueId), '_blank', 'noopener');
      return;
    }
    if (act === 'player') { app.athleteId = el.dataset.player; app.router.go('player'); return; }
    if (act === 'team') { app.teamAbbr = el.dataset.team; app.router.go('team'); }
  };

  // A league configured server-wide still needs the roster picker populated before the
  // user can answer "which team is yours".
  if (state.session.state.step === 'roster' && !state.rosterChoices.length) {
    await toRosterStep(app, state.session.state.leagueId);
    return;
  }

  if (state.session.state.step === 'ready') await refreshAll(app);
  else app.router.refresh();
}

export function leave() { state.body = ''; }
