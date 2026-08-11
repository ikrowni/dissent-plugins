// views/league-draft.js — the draft board and its clock.
//
// ⚠️ THE CLOCK IS THE SERVER'S, NOT THE BROWSER'S. `msRemaining` comes from the
// module on every poll and is counted down locally only between polls, purely so
// the digits move. A purely local timer would drift, and worse, would let two
// managers see different times for the same pick.
//
// ⚠️ POLLING IS WHAT ADVANCES THE CLOCK. Every `draft:get` resolves lapsed picks
// server-side, which is the whole deadline-on-read design: the node's scheduler
// floor is five minutes and cannot drive a 90-second timer, so the board being
// open is what keeps a live draft moving.
//
// ⚠️ TICKING AND POLLING ARE TWO DIFFERENT TIMERS, AND ONLY ONE OF THEM PAINTS.
// They used to be one 3-second interval that re-rendered the whole view, which
// made the clock jump three seconds at a time, wiped the search box mid-word on
// every tick, and reset the scroll position of the board. The tick now writes
// one text node and touches nothing else; a full re-render happens only when the
// draft ACTUALLY CHANGED — a pick, a status change, somebody new on the clock.

import { esc, panel, stateMsg } from '../core/ui.js';
import {
  renderBoard, renderOnTheClock, renderRosterProgress, renderFilters, renderPool,
  renderQueue, picksUntilTurn, rosterNeeds, renderStage, renderHero, renderTicker, renderFeed,
} from './draft-board.js';
import { tickerLine, feedItems } from '../core/draft-intel.js';
import { motion } from '../core/motion.js';
import { getIndex } from '../core/player-index.js';
import {
  getDraft, makePick, startDraft, setPaused, finalizeDraft, formatClock, createDraft, setQueue,
} from '../core/league-api.js';
import { loadIndex, searchPlayers } from '../core/player-index.js';
import { loadRanking, rankingFor } from '../core/draft-ranking.js';
import {
  availablePool, filterPool, poolCounts, matchesFilter,
} from '../core/league/draft-pool.js';
import { describe } from './league-home.js';

/** How often the board is re-read from the module. */
const POLL_MS = 3000;

/**
 * How often the digits are repainted.
 *
 * ⚠️ FASTER THAN ONE SECOND, ON PURPOSE. A 1000 ms interval drifts against the
 * wall clock, so the display skips a second every so often — the exact stutter
 * this was reported as. Sampling four times a second and writing only when the
 * rendered string changed costs one string compare and makes every second land.
 */
const TICK_MS = 250;

/**
 * A draft that is not running still has to notice when it starts.
 *
 * ⚠️ Polled SLOWER, not never. The old code kept the interval alive on a `pre`
 * draft but never re-read it, so a manager waiting for the commissioner to start
 * sat on "waiting for the commissioner" forever while the draft ran without
 * them. Every 5th poll is ~15 s, which is responsive enough for a lobby and
 * cheap against the install's daily invocation allowance.
 */
const IDLE_POLL_EVERY = 5;

const state = {
  leagueId: null,
  league: null,
  teamId: null,
  draft: null,
  error: null,
  busy: false,
  notice: null,
  localDeadline: null,    // epoch ms, refreshed from the server on every poll
  frozenRemaining: null,  // ms banked while paused — see the clock note below
  ranking: [],
  queue: [],
  filter: 'ALL',
  query: '',
  // ⚠️ "No draft yet" is a STATE, not an error. The module refuses `draft:get`
  // for a league that has never created one, and rendering that refusal as an
  // error pane left a commissioner staring at "Try again" — a button that could
  // never work, on the one screen that needed a "Create draft" instead.
  noDraft: false,
};

let pollTimer = null;
let tickTimer = null;
let idleTicks = 0;
let lastClockText = null;

export function reset() {
  stopPolling();
  Object.assign(state, {
    leagueId: null, league: null, teamId: null, draft: null,
    error: null, busy: false, notice: null, localDeadline: null, frozenRemaining: null,
    ranking: [], queue: [], filter: 'ALL', query: '', noDraft: false,
  });
}

export function render() {
  if (state.error) {
    return panel({
      title: 'Draft',
      body: `<p class="muted">${esc(state.error)}</p>
             <button class="btn" data-act="draft-retry">Try again</button>`,
    });
  }
  if (state.noDraft) return noDraftPane();
  if (!state.draft) return stateMsg('Loading the draft…', { spinner: true });

  const d = state.draft;
  if (d.status === 'pre') return prePane(d);
  if (d.status === 'complete') return completePane(d);
  return livePane(d);
}

/**
 * No draft exists yet — the state every new league starts in.
 *
 * ⚠️ A COMMISSIONER GETS THE BUTTON THAT FIXES IT. This used to render as an
 * error with "Try again", which is the least useful thing to show somebody who
 * is the only person able to act.
 */
function noDraftPane() {
  const teams = Object.keys(state.league?.teams ?? {}).length;
  return panel({
    title: 'Draft',
    body: `
      <p class="muted">No draft has been set up for this league yet.</p>
      ${teams < 2
    ? `<p class="muted">A draft needs at least two teams — this league has ${teams}.
         Invite people to the server and have them join from the League tab.</p>`
    : ''}
      ${state.league?.isCommissioner
    ? `<button class="btn primary" data-act="draft-create" ${state.busy || teams < 2 ? 'disabled' : ''}>
         ${state.busy ? 'Creating…' : 'Create draft'}
       </button>`
    : '<p class="muted">A commissioner needs to create it.</p>'}`,
  });
}

function prePane(d) {
  return panel({
    title: 'Draft',
    body: `
      <p class="muted">${d.order.length} picks over ${d.rounds} round${d.rounds === 1 ? '' : 's'},
      ${esc(d.type)} order. Pick clock ${d.pickTimerSeconds}s.</p>
      ${d.isCommissioner
    ? `<button class="btn primary" data-act="draft-start" ${state.busy ? 'disabled' : ''}>Start draft</button>`
    : '<p class="muted">Waiting for the commissioner to start.</p>'}`,
  });
}

function completePane(d) {
  const playerOf = (id) => getIndex()?.[String(id)] ?? null;
  return panel({
    title: 'Draft complete',
    flush: true,
    body: `
      ${renderStage({
    hero: renderHero({ onClock: null, complete: true }),
    ticker: renderTicker(null),
    board: renderBoard({
      order: d.order, picks: d.picks, teamIds: boardTeamIds(d),
      teamLabel: (t) => teamName(t),
      isMine: (t) => String(t) === String(state.teamId),
      playerOf,
    }),
    feed: renderFeed(feedItems({ picks: d.picks, playerOf, teamLabel: (t) => teamName(t) })),
  })}
      ${d.isCommissioner
    ? `<button class="btn primary" data-act="draft-finalize" ${state.busy ? 'disabled' : ''}>
         Move picks onto rosters
       </button>`
    : ''}`,
  });
}

/**
 * The pool of players still on the board.
 *
 * ⚠️ THIS LIST IS THE DRAFT BOARD'S WHOLE JOB, and it used to be a search box
 * with nothing in it — you could only draft somebody whose name you had already
 * thought of, and the list stayed empty until you typed two letters. It is now
 * populated from the ranking, ordered best-first, with a tab per position so
 * "who is the best receiver left" is one click rather than a memory test.
 *
 * ⚠️ SHOWN WHETHER OR NOT IT IS YOUR TURN. Only the Draft buttons are gated. A
 * board you cannot look at until you are on the clock gives you ninety seconds
 * to do all of your thinking.
 */
function pickPool(mine) {
  const nameOf = (id) => getIndex()?.[String(id)]?.n ?? '';
  const positionOf = (id) => getIndex()?.[String(id)]?.p ?? null;
  const playerOf = (id) => getIndex()?.[String(id)] ?? null;

  const pool = availablePool({ ranking: state.ranking, taken: takenIds(), positionOf });
  const counts = poolCounts(pool);
  const ranked = pool.length > 0;

  // ⚠️ A MISSING RANKING MUST NOT MEAN A DRAFT NOBODY CAN MAKE A PICK IN. The
  // ranking is a static asset and it can fail to load; before the pool existed
  // this screen was search-only, so falling back to exactly that keeps a live
  // draft playable on the one day the CDN misbehaves. It is a degraded mode and
  // it says so — an unranked list with no explanation would read as the feature
  // being broken rather than the data being missing.
  const shown = ranked
    ? filterPool(pool, { filter: state.filter, query: state.query, nameOf })
    : searchPlayers(state.query, { taken: takenIds(), limit: 25 })
      .map((p) => ({ id: p.id, pos: String(p.position ?? '').toUpperCase() }))
      .filter((e) => matchesFilter(e.pos, state.filter));

  const empty = state.query.trim()
    ? 'Nobody available matches that.'
    : 'Nobody left at that position.';

  return `
    <input class="db-search" type="search" data-act="draft-search" placeholder="Search players…"
           value="${esc(state.query)}" autocomplete="off">
    ${renderFilters(state.filter, ranked ? counts : {}, myRosterNeeds())}
    ${ranked || state.query.trim().length >= 2
    ? renderPool({ available: shown, playerOf, canPick: mine && !state.busy, emptyText: empty })
    : `<p class="muted">The ranked player pool could not be loaded, so the board is falling
       back to search — type at least two letters to find a player.
       <button class="btn tiny" data-act="draft-retry">Try loading it again</button></p>`}
    ${mine ? '' : '<p class="tiny">Waiting on the manager who is up — you can still look around.</p>'}`;
}

/**
 * This manager's rostered-vs-slots counts, for the filter pills.
 *
 * ⚠️ Passes the FULL `rosterPositions` — bench included — because `ALL` is
 * roster size over the whole roster. Filtering BN out here would render
 * `All 15/9` where Sleeper renders `All 15/15`; `rosterNeeds` drops bench from
 * the per-position counts itself.
 */
function myRosterNeeds() {
  const allSlots = state.league?.settings?.rosterPositions ?? [];
  if (allSlots.length === 0) return {};
  const playerOf = (id) => getIndex()?.[String(id)] ?? null;
  const owned = Object.values(state.draft?.picks ?? {})
    .filter((p) => String(p.teamId) === String(state.teamId))
    .map((p) => ({ pos: String(playerOf(p.playerId)?.p ?? '').toUpperCase() }));
  return rosterNeeds({ slots: allSlots, owned });
}

/**
 * The column order of the board: round one, left to right.
 *
 * ⚠️ Derived from the ORDER, not from the league's team map. The board's columns
 * are draft slots, and a league's teams are stored in join order — using the
 * latter puts every manager in the wrong column on a board that otherwise looks
 * perfectly plausible.
 */
function boardTeamIds(d) {
  return (d.order ?? [])
    .filter((p) => p.round === 1)
    .sort((a, b) => a.pickInRound - b.pickInRound)
    .map((p) => String(p.owner));
}

/**
 * The module's `onClock` is `{ overall, round, teamId }` — it carries NO `owner`
 * and NO `pickInRound`, which the shared board needs.
 *
 * ⚠️ NORMALISE, NEVER ASSUME. Passing the raw payload straight through leaves
 * `owner` undefined, and the board then quietly reports that nobody is on the
 * clock while every other part of the screen says somebody is.
 */
function normalizeClock(d) {
  if (!d.onClock) return null;
  const full = (d.order ?? []).find((p) => p.overall === d.onClock.overall);
  return full ?? { ...d.onClock, owner: d.onClock.teamId, pickInRound: d.onClock.overall };
}

function livePane(d) {
  const clock = normalizeClock(d);
  const mine = Boolean(clock) && String(clock.owner) === String(state.teamId);
  const playerOf = (id) => getIndex()?.[String(id)] ?? null;
  const owned = Object.values(d.picks ?? {})
    .filter((p) => String(p.teamId) === String(state.teamId))
    .map((p) => ({ id: String(p.playerId), pos: String(playerOf(p.playerId)?.p ?? '').toUpperCase() }));
  const slots = state.league?.settings?.rosterPositions?.filter((x) => x !== 'BN' && x !== 'IR' && x !== 'TAXI') ?? [];
  const paused = d.status === 'paused';

  // ⚠️ THE POOL THE TICKER READS IS THE ONE THE BOARD ALREADY BUILT. Rebuilding it
  // here would be a second answer to "who is left", and the two would drift.
  const positionOf = (id) => getIndex()?.[String(id)]?.p ?? null;
  const pool = availablePool({ ranking: state.ranking, taken: takenIds(), positionOf });
  const remaining = remainingMs();

  const stage = renderStage({
    hero: renderHero({
      onClock: clock,
      teamLabel: (t) => teamName(t),
      isMine: (t) => String(t) === String(state.teamId),
      clockText: clockText(),
      urgent: remaining !== null && remaining > 0 && remaining < 15000,
      queued: state.queue.length || null,
    }),
    ticker: renderTicker(tickerLine({ picks: d.picks, positionOf, pool })),
    board: renderBoard({
      order: d.order, picks: d.picks, teamIds: boardTeamIds(d),
      teamLabel: (t) => teamName(t),
      isMine: (t) => String(t) === String(state.teamId),
      onClock: clock, playerOf,
    }),
    feed: renderFeed(feedItems({ picks: d.picks, playerOf, teamLabel: (t) => teamName(t) })),
  });

  return panel({
    title: 'Draft',
    flush: true,
    body: `
      ${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
      ${paused ? '<p class="notice">The draft is paused. The clock resumes where it stopped.</p>' : ''}
      ${stage}
      <div class="mock-cols">
        <div class="mock-pool-col">
          ${pickPool(mine && !paused)}
        </div>
        <div class="mock-side">
          ${renderQueue({
    queue: state.queue,
    playerOf,
    untilTurn: picksUntilTurn(d.order, d.picks, state.teamId),
    canEdit: Boolean(state.teamId),
  })}
          <h4>Your roster</h4>
          ${renderRosterProgress({ slots, owned, playerOf })}
          ${d.isCommissioner ? `
            <div class="row-actions">
              <button class="btn" data-act="draft-pause" data-paused="${paused}">
                ${paused ? 'Resume draft' : 'Pause draft'}
              </button>
            </div>` : ''}
        </div>
      </div>`,
  });
}

function teamName(teamId) {
  return state.league?.teams?.[String(teamId)]?.name ?? String(teamId);
}

// ── The clock ────────────────────────────────────────────────────────────────

/**
 * Milliseconds left on the current pick.
 *
 * ⚠️ A PAUSED CLOCK DOES NOT COUNT DOWN. While paused the module reports the
 * banked remainder and no deadline, so the display holds still — counting down
 * against a deadline that is not running is how a paused draft appears to expire.
 */
export function remainingMs() {
  if (state.frozenRemaining !== null) return state.frozenRemaining;
  if (state.localDeadline === null) return null;
  return Math.max(0, state.localDeadline - Date.now());
}

function clockText() {
  return formatClock(remainingMs());
}

/**
 * Repaint the clock alone.
 *
 * ⚠️ ONE TEXT NODE, NEVER `router.refresh()`. A refresh replaces the whole
 * section's innerHTML, which destroys the search input the manager is typing
 * into and resets the board's scroll — four times a second, that is not a
 * screen anybody can use.
 */
export function paintClock() {
  if (typeof document === 'undefined') return;
  const el = document.querySelector('[data-draft-clock]');
  if (!el) { lastClockText = null; return; }
  const remaining = remainingMs();
  const text = formatClock(remaining);
  if (text !== lastClockText) {
    el.textContent = text;
    lastClockText = text;
  }
  el.classList.toggle('urgent', remaining !== null && remaining > 0 && remaining < 15000);
}

/**
 * What a repaint would have to be caused by.
 *
 * ⚠️ THE CLOCK IS DELIBERATELY NOT IN IT. Including the deadline would make
 * every poll a full re-render again, which is the bug this exists to stop. Only
 * things that change the SHAPE of the screen belong here.
 */
export function fingerprint(d) {
  if (!d) return 'none';
  return [
    d.status,
    Object.keys(d.picks ?? {}).length,
    d.onClock?.overall ?? '-',
    d.isCommissioner ? 'c' : '-',
  ].join('|');
}

// ── Polling ──────────────────────────────────────────────────────────────────

function startPolling(app) {
  stopPolling();
  idleTicks = 0;

  tickTimer = setInterval(paintClock, TICK_MS);

  pollTimer = setInterval(async () => {
    const status = state.draft?.status;
    // A finished draft cannot change on its own; stop rather than burn the
    // install's daily invocation allowance on a settled board.
    if (!status || status === 'complete') { stopPolling(); return; }

    if (status !== 'active') {
      idleTicks += 1;
      if (idleTicks % IDLE_POLL_EVERY !== 0) return;
    }

    const before = fingerprint(state.draft);
    await poll(app);
    if (fingerprint(state.draft) !== before) refreshKeepingSearch(app);
    else paintClock();
  }, POLL_MS);
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  lastClockText = null;
}

/**
 * Re-render, then put the manager back where they were.
 *
 * ⚠️ THE HUB RE-RENDERS THE WHOLE VIEW, which destroys the input element. A
 * refresh landing mid-word used to drop focus and the caret, so a search typed
 * during a live draft lost characters to whichever poll happened to land. Focus
 * is only restored if it was in the box to begin with — stealing it otherwise
 * would yank the page around for somebody who was reading the board.
 */
function refreshKeepingSearch(app) {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  const wasSearch = Boolean(active?.matches?.('[data-act="draft-search"]'));
  const caret = wasSearch ? active.selectionStart : null;
  app?.router?.refresh();
  if (wasSearch) restoreSearchFocus(caret);
  paintClock();
}

async function poll(app) {
  try {
    const d = await getDraft(state.leagueId, state.ranking);
    state.draft = d;
    state.noDraft = false;

    // Re-anchor the local countdown to the server's answer on every poll.
    const paused = d.status === 'paused';
    const ms = d.msRemaining === null || d.msRemaining === undefined ? null : d.msRemaining;
    state.frozenRemaining = paused ? ms : null;
    state.localDeadline = paused || ms === null ? null : Date.now() + ms;

    if (d.autoPicked?.length) {
      state.notice = `${d.autoPicked.length} pick${d.autoPicked.length === 1 ? '' : 's'} auto-drafted after the clock expired.`;
    }
  } catch (err) {
    // ⚠️ A league with no draft is not a failure, and polling it forever is
    // pointless — the answer cannot change until somebody creates one.
    if (/no draft/i.test(String(err?.message ?? err))) {
      state.noDraft = true;
      state.draft = null;
      state.error = null;
    } else {
      state.error = describe(err);
    }
    stopPolling();
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function load(app, { leagueId, league, teamId }) {
  Object.assign(state, {
    leagueId, league, teamId, error: null, notice: null, query: '', filter: 'ALL',
  });
  // Names and the pool both need the index; a draft board showing raw ids is
  // unusable even though it is technically correct.
  await loadIndex();
  // ⚠️ THE RANKING IS ALSO WHAT THE SERVER AUTODRAFTS FROM. It is sent on every
  // `draft:get`, and without it `bestAvailable` has nothing to choose from and
  // returns null — so a lapsed pick is never resolved, the cascade stops, and
  // the board sits at 0:00 with nobody able to move. A board that cannot load
  // the ranking must still work, so this is best-effort.
  try {
    await loadRanking();
    state.ranking = rankingFor(state.league?.settings?.scoring ?? 'ppr');
  } catch {
    state.ranking = [];
  }
  await poll(app);
  startPolling(app);
  app?.router?.refresh();
  paintClock();
}

/** Every id already drafted — the set the pool must exclude. */
export function takenIds() {
  return new Set(Object.values(state.draft?.picks ?? {}).map((p) => String(p.playerId)));
}

/**
 * Persist the queue to the module.
 *
 * Fire-and-forget: the local list is truth for rendering, because a failed save
 * must not wipe what the manager just built mid-draft.
 *
 * ⚠️ `setQueue` had NO caller before this — the op has shipped in the signed
 * module since 2.26.0, so every autodraft fell through to the league ranking.
 */
function saveQueue(app) {
  if (!state.leagueId || !state.teamId) return;
  Promise.resolve(setQueue(state.leagueId, state.teamId, state.queue))
    .catch(() => { state.notice = 'Queue not saved \u2014 check your connection.'; });
  app?.router?.refresh();
}

/** Add a player to the end of the queue. Adding twice is a no-op, not a duplicate. */
export function queueAdd(app, playerId) {
  const id = String(playerId ?? '');
  if (!id || state.queue.includes(id)) return;
  state.queue = [...state.queue, id];
  saveQueue(app);
}

/** Drop a player from the queue. */
export function queueRemove(app, playerId) {
  const id = String(playerId ?? '');
  state.queue = state.queue.filter((q) => q !== id);
  saveQueue(app);
}

/** Move a player one place up the queue. */
export function queueUp(app, playerId) {
  const id = String(playerId ?? '');
  const i = state.queue.indexOf(id);
  if (i <= 0) return;
  const next = [...state.queue];
  [next[i - 1], next[i]] = [next[i], next[i - 1]];
  state.queue = next;
  saveQueue(app);
}

/** Narrow the pool to one position. */
export function setFilter(app, filter) {
  state.filter = String(filter ?? 'ALL');
  app?.router?.refresh();
  paintClock();
}

/**
 * Filter as the manager types.
 *
 * ⚠️ THE HUB RE-RENDERS THE WHOLE VIEW, which destroys the input element. Without
 * restoring focus and the caret, the box loses focus after EVERY keystroke and is
 * unusable while appearing to work perfectly in a screenshot. Restoring is done
 * synchronously after the refresh, before the browser paints.
 */
export function search(app, query, caret = null) {
  state.query = String(query ?? '');
  app?.router?.refresh();
  restoreSearchFocus(caret);
  paintClock();
}

/** Put focus and the caret back after a re-render. */
export function restoreSearchFocus(caret = null) {
  if (typeof document === 'undefined') return;
  const el = document.querySelector('[data-act="draft-search"]');
  if (!el) return;
  el.focus();
  const pos = caret === null ? el.value.length : caret;
  try { el.setSelectionRange(pos, pos); } catch { /* not all inputs support it */ }
}

/** Commissioner: create the draft this league has never had. */
export async function create(app) {
  await act(app, async () => {
    await createDraft(state.leagueId);
    state.noDraft = false;
  }, 'Draft created.');
  // Polling stopped when the draft turned out not to exist; restart it now that
  // one does, or the board never updates.
  await poll(app);
  startPolling(app);
  app?.router?.refresh();
  paintClock();
}

export async function start(app) { await act(app, () => startDraft(state.leagueId)); }
export async function pause(app, paused) { await act(app, () => setPaused(state.leagueId, paused)); }
export async function finalize(app) {
  await act(app, () => finalizeDraft(state.leagueId), 'Rosters updated from the draft.');
}

export async function pick(app, playerId) {
  await act(app, () => makePick(state.leagueId, state.teamId, playerId, state.ranking), 'Pick made.');
}

async function act(app, fn, notice = null) {
  state.busy = true;
  state.error = null;
  app?.router?.refresh();
  try {
    await fn();
    state.notice = notice;
    await poll(app);
    if (state.draft && state.draft.status !== 'complete') startPolling(app);
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
    paintClock();
  }
}

export { state as _state };
