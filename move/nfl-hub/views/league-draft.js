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

import { esc, panel, stateMsg, noLeaguePane} from '../core/ui.js';
import {
  renderBoard, renderOnTheClock, renderRosterProgress, renderFilters, renderPool,
  renderQueue, picksUntilTurn, rosterNeeds, renderStage, renderBoardStage, renderHero,
  renderTicker, renderFeed,
} from './draft-board.js';
import { tickerLine, feedItems } from '../core/draft-intel.js';
import { motion } from '../core/motion.js';
import { getIndex } from '../core/player-index.js';
import { teamAvatar } from '../core/team-visuals.js';
import {
  getDraft, makePick, startDraft, setPaused, finalizeDraft, formatClock, createDraft, setQueue,
  setAutoDraft,
} from '../core/league-api.js';
import { loadIndex, searchPlayers } from '../core/player-index.js';
import { loadRanking, rankingFor, scoringKeyFor } from '../core/draft-ranking.js';
import {
  availablePool, filterPool, poolCounts, matchesFilter,
} from '../core/league/draft-pool.js';
import { describe } from './league-home.js';
import { formatDraftTime } from '../core/draft-schedule.js';
import { autoPickTarget, bestAvailableFor } from '../core/draft-auto.js';
import { playTurnAlert, becameMyTurn, alertEnabled, setAlertEnabled } from '../core/draft-alert.js';

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
// Was the clock mine on the PREVIOUS poll? The chime keys on the transition.
let wasMyTurn = false;
// The overall pick this client has already auto-submitted for, so a 3 s poll
// landing before that pick registers cannot fire the same one twice.
let autoSubmittedFor = null;
// Consecutive failed polls, and how many ticks to sit out before retrying.
// ⚠️ NOT a reason to stop — see poll()'s catch. Backing off is how a client
// survives a node outage without spending POLL_MS-rate invocations on it.
const FAIL_STREAK_MAX = 5;
const FAIL_SKIP_MAX = 10;   // x POLL_MS = 30 s at worst
let lastClockText = null;
let stopGlowLoop = null;
let glowPhase = 0;
let lastRunPos = null;

export function reset() {
  stopPolling();
  lastRunPos = null;
  Object.assign(state, {
    leagueId: null, league: null, teamId: null, draft: null,
    error: null, busy: false, notice: null, localDeadline: null, frozenRemaining: null,
    ranking: [], queue: [], filter: 'ALL', query: '', noDraft: false,
    _failStreak: 0, _skipTicks: 0, autoDraft: {},
  });
  wasMyTurn = false;
  autoSubmittedFor = null;
}

export function render() {
  // ⚠️ BEFORE the error check, because "leagueId required" IS the no-league case
  // arriving as a module refusal. Rendering it verbatim showed a developer string
  // next to a Try again that cannot work, while every sibling tab said there was
  // no league — the last disagreement in the set.
  if (!state.leagueId) return noLeaguePane('Draft');
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
      ${scheduleLine(state.league?.settings)}
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

/**
 * The scheduled draft time, for a draft that has not started.
 *
 * ⚠️ ABSOLUTE TIME AND RELATIVE TIME TOGETHER, never one alone. "in 2 days"
 * cannot be written in a calendar, and a bare timestamp makes every reader do
 * the arithmetic the page could have done. The absolute half carries the
 * reader's own timezone name so two managers comparing notes can tell whether
 * they are looking at the same moment.
 */
function scheduleLine(settings) {
  const when = formatDraftTime(settings?.draftScheduledAt);
  if (!when) return '';
  return when.past
    ? `<p class="notice">Draft day was <strong>${esc(when.absolute)}</strong> (${esc(when.relative)}).
         It has not been started yet.</p>`
    : `<p class="notice">Draft day: <strong>${esc(when.absolute)}</strong> — ${esc(when.relative)}.</p>`;
}

/**
 * Which of this draft's baked-in settings no longer match the league's.
 *
 * ⚠️ A DRAFT IS A SNAPSHOT, AND NOTHING SAID SO. `rounds`, `type` and the pick
 * clock are fixed into `order` when the draft is built, so a commissioner who
 * edits the league afterwards sees the board go on reporting the old numbers
 * with only a Start button to press. It reads as a stuck button, which is
 * exactly how it was reported — the settings had saved fine, they simply had
 * nowhere to land.
 */
function staleAgainstSettings(d, settings) {
  if (!settings) return [];
  const out = [];
  // ⚠️ THE ABSENCE CHECK RUNS ON THE RAW VALUE, BEFORE FORMATTING. Formatting
  // first turns an unset pick clock into the string "undefineds", which is not
  // null, compares unequal to everything, and reports every league that has
  // never set one as having drifted.
  const cmp = (label, was, now, fmt = (v) => v) => {
    if (now === undefined || now === null || now === '') return;
    if (String(was) !== String(now)) out.push(`${label} ${fmt(was)} → ${fmt(now)}`);
  };
  cmp('rounds', d.rounds, settings.draftRounds);
  cmp('order', d.type, settings.draftType);
  cmp('pick clock', d.pickTimerSeconds, settings.pickTimerSeconds, (v) => `${v}s`);
  return out;
}

function prePane(d) {
  const stale = staleAgainstSettings(d, state.league?.settings);
  return panel({
    title: 'Draft',
    body: `
      <p class="muted">${d.order.length} picks over ${d.rounds} round${d.rounds === 1 ? '' : 's'},
      ${esc(d.type)} order. Pick clock ${d.pickTimerSeconds}s.</p>
      ${scheduleLine(state.league?.settings)}
      ${stale.length && d.isCommissioner
    ? `<p class="notice">This draft was built before your latest settings change, so it still
         uses ${esc(stale.join(', '))}. Rebuilding discards nothing — no pick has been made —
         and applies the league's current settings.</p>`
    : ''}
      ${d.isCommissioner
    ? `<div class="row-actions">
         <button class="btn primary" data-act="draft-start" ${state.busy ? 'disabled' : ''}>Start draft</button>
         <button class="btn" data-act="draft-rebuild" ${state.busy ? 'disabled' : ''}>
           ${state.busy ? 'Rebuilding…' : 'Rebuild from settings'}
         </button>
       </div>
       <p class="tiny">Rebuild regenerates the board from the league settings — rounds, order and
         pick clock. It is refused once the draft has started.</p>`
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
  })}
      ${renderBoardStage({
    board: renderBoard({
      order: d.order, picks: d.picks, teamIds: boardTeamIds(d),
      teamLabel: (t) => teamName(t),
      teamMark,
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

/**
 * The controls that stop an absent manager costing the room 90 seconds a round,
 * plus the chime toggle.
 *
 * ⚠️ The auto-draft toggle is offered for the team ON THE CLOCK, not for a list
 * of every team, because that is the only one it can act on right now and a
 * twelve-row grid of toggles is a worse answer to "Dave isn't here" than one
 * button in the place you are already looking.
 */
function draftControls(d, clock, mine, paused) {
  // ⚠️ PAUSED COUNTS. A commissioner pauses precisely BECAUSE somebody is
  // missing, so hiding the auto-draft toggle then hides it exactly when it is
  // being reached for. Taking the pick manually still requires a running clock.
  if (!clock || (d.status !== 'active' && d.status !== 'paused')) return '';
  const onClockTeam = String(clock.owner ?? '');
  const flagged = Boolean(state.autoDraft?.[onClockTeam]);
  const canActForThem = Boolean(d.isCommissioner) || mine;
  const label = mine ? 'my picks' : teamName(onClockTeam);
  return `<div class="draft-controls">
    <button class="btn btn-sm" data-act="draft-alert-toggle"
      title="Plays a short chime when you go on the clock">
      ${alertEnabled() ? '&#128276; Turn alert on' : '&#128277; Turn alert off'}
    </button>
    ${canActForThem ? `
      <button class="btn btn-sm ${flagged ? 'on' : ''}" data-act="draft-auto-toggle"
        data-team="${esc(onClockTeam)}"
        title="Pick automatically for this team instead of waiting out the clock">
        ${flagged ? '&#9209; Auto-drafting' : '&#9193;'} Auto-draft ${esc(label)}
      </button>` : ''}
    ${d.isCommissioner && !mine && !paused ? `
      <button class="btn btn-sm" data-act="draft-pick-for"
        title="Take this pick now, on their behalf">
        Pick for ${esc(teamName(onClockTeam))}
      </button>` : ''}
  </div>`;
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
      teamMark,
      isMine: (t) => String(t) === String(state.teamId),
      clockText: clockText(),
      urgent: remaining !== null && remaining > 0 && remaining < 15000,
      queued: state.queue.length || null,
    }),
    ticker: (() => {
      const line = tickerLine({ picks: d.picks, positionOf, pool });
      // ⚠️ COMPARED AGAINST THE LAST RUN, not against "is there a run". The view
      // re-renders on every fingerprint change, so keying the flash on presence
      // alone would re-fire it for the whole length of the run.
      const isNew = Boolean(line) && line.pos !== lastRunPos;
      lastRunPos = line?.pos ?? null;
      return renderTicker(line, { isNew });
    })(),
  });

  // ⚠️ THE BOARD GOES LAST, exactly as in the mock — two boards that read
  // differently would make the rehearsal worthless. It is a RECORD; the pool is
  // the only thing on the screen you can act on.
  const boardStage = renderBoardStage({
    board: renderBoard({
      order: d.order, picks: d.picks, teamIds: boardTeamIds(d),
      teamLabel: (t) => teamName(t),
      teamMark,
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
      ${draftControls(d, clock, mine, paused)}
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
      </div>
      ${boardStage}`,
  });
}

function teamName(teamId) {
  return state.league?.teams?.[String(teamId)]?.name ?? String(teamId);
}

/**
 * The board's and the hero's team picture.
 *
 * ⚠️ PASSED IN RATHER THAN IMPORTED BY draft-board.js, because that module is
 * shared with the MOCK draft, whose teams are simulated and have no records at
 * all. A default of '' there leaves the mock exactly as it was.
 */
function teamMark(teamId) {
  const id = String(teamId);
  return teamAvatar(state.league?.teams?.[id] ?? { id, name: teamName(id) }, { size: 22 });
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
 * The on-the-clock glow — the only continuously animating thing this view owns.
 *
 * ⚠️ THROUGH motion.loop(), NEVER A RAW rAF. That is the plugin's whole motion
 * budget in one line: capped at TARGET_FPS, stopped while the frame is hidden, and —
 * since the focus gate — stopped while the window merely sits behind another
 * application, which is when all three of this project's measured GPU incidents
 * happened. core/motion.test.js has a static guard that fails if any view opens its
 * own loop.
 *
 * ⚠️ OPACITY ONLY, VIA A CUSTOM PROPERTY. It writes one CSS variable on one element,
 * which the compositor handles without a repaint. Animating the glow's colour, size
 * or box-shadow instead would repaint a 120px band every frame for the whole draft —
 * the exact pattern that measured 68% of desktop idle GPU elsewhere in this project.
 */
export function startGlow() {
  stopGlow();
  if (typeof document === 'undefined') return;
  stopGlowLoop = motion.loop((dt) => {
    const el = document.querySelector('[data-gr-glow]');
    if (!el) return;
    // ~4.5s per breath. Slow enough to sit next to for three hours.
    glowPhase = (glowPhase + dt / 4500) % 1;
    const eased = (1 - Math.cos(glowPhase * Math.PI * 2)) / 2;
    el.style.setProperty('--gr-glow', (0.08 + eased * 0.26).toFixed(3));
  });
}

export function stopGlow() {
  if (stopGlowLoop) { stopGlowLoop(); stopGlowLoop = null; }
  glowPhase = 0;
}

/**
 * A single sweep across the stage, fired when a pick lands.
 *
 * ⚠️ ONE-SHOT, NOT AMBIENT. stadium.css's `.sweep` translates forever and that file
 * names it as the first thing to cut if the WebView2 measurement comes back bad.
 * The same gesture is worth keeping at the moment it means something — a pick
 * landing — and worth nothing at all for the ninety seconds in between.
 *
 * ⚠️ IT DELETES ITSELF. An element left on the stage keeps a compositor layer alive,
 * and fifteen rounds of them would rebuild the exact cost this avoids. It also
 * refuses to stack: two picks landing in the same poll produce one sweep, not two.
 */
export function flashSweep() {
  if (typeof document === 'undefined') return;
  const stage = document.querySelector('[data-gr-stage]');
  if (!stage) return;
  if (stage.querySelector('.gr-sweep')) return;
  const el = document.createElement('div');
  el.className = 'gr-sweep';
  el.addEventListener('animationend', () => el.remove(), { once: true });
  stage.appendChild(el);
}

/**
 * The yard lines drift against the board as it scrolls sideways.
 *
 * ⚠️ SCROLL-LINKED, WHICH MEANS NO LOOP AT ALL. §6 lists this as free precisely
 * because it does zero work between scroll events — no rAF, no interval, nothing
 * running while the board sits still. It writes one transform on one element.
 *
 * ⚠️ transform, not background-position. Moving the background repaints the whole
 * stage on every scroll frame; a transform on a positioned layer stays on the
 * compositor. That distinction is the difference between free and the 68%-of-idle-
 * GPU pattern this project has measured three times.
 */
export function bindParallax() {
  if (typeof document === 'undefined') return;
  const stage = document.querySelector('[data-gr-stage]');
  const lines = stage?.querySelector('.gr-lines');
  const scroller = stage?.querySelector('[data-gr-scroll]');
  if (!lines || !scroller) return;
  const paint = () => {
    lines.style.transform = `translate3d(${-Math.round(scroller.scrollLeft * 0.3)}px, 0, 0)`;
  };
  scroller.addEventListener('scroll', paint, { passive: true });
  paint();
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
  startGlow();

  pollTimer = setInterval(async () => {
    const status = state.draft?.status;
    // A finished draft cannot change on its own; stop rather than burn the
    // install's daily invocation allowance on a settled board.
    if (!status || status === 'complete') { stopPolling(); return; }

    if (status !== 'active') {
      idleTicks += 1;
      if (idleTicks % IDLE_POLL_EVERY !== 0) return;
    }

    // Sit out the backoff earned by consecutive failures, without ever stopping.
    if (state._skipTicks > 0) { state._skipTicks -= 1; return; }

    // ⚠️ COUNT THE PICKS, do not just compare the fingerprint. The fingerprint also
    // changes on a pause or a commissioner change, and sweeping the stage for those
    // would spend the gesture on nothing.
    const before = fingerprint(state.draft);
    const picksBefore = Object.keys(state.draft?.picks ?? {}).length;
    await poll(app);
    if (fingerprint(state.draft) !== before) {
      refreshKeepingSearch(app);
      if (Object.keys(state.draft?.picks ?? {}).length > picksBefore) flashSweep();
    } else paintClock();
  }, POLL_MS);
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  stopGlow();
  lastClockText = null;
  lastRunPos = null;
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
  // The old scroller and its listener went with the old DOM.
  bindParallax();
}

async function poll(app) {
  try {
    const d = await getDraft(state.leagueId, state.ranking);
    state.draft = d;
    state.noDraft = false;
    // ⚠️ THE MODULE IS THE ONLY SOURCE. These used to come from a separate
    // server-storage read that any member could have written; they now ride
    // along with the board that is already authoritative for everything else on
    // it, so a flag set by another client shows up on the next poll for free.
    state.autoDraft = d.autoDraft ?? {};
    // A good answer retires a stale failure banner and the backoff with it.
    state.error = null;
    state._failStreak = 0;
    state._skipTicks = 0;

    // Re-anchor the local countdown to the server's answer on every poll.
    const paused = d.status === 'paused';
    const ms = d.msRemaining === null || d.msRemaining === undefined ? null : d.msRemaining;
    state.frozenRemaining = paused ? ms : null;
    state.localDeadline = paused || ms === null ? null : Date.now() + ms;

    if (d.autoPicked?.length) {
      state.notice = `${d.autoPicked.length} pick${d.autoPicked.length === 1 ? '' : 's'} auto-drafted after the clock expired.`;
    }

    onDraftSettled(app, d);
  } catch (err) {
    // ⚠️ A league with no draft is not a failure, and polling it forever is
    // pointless — the answer cannot change until somebody creates one. This is
    // the ONLY error that may stop the board.
    if (/no draft/i.test(String(err?.message ?? err))) {
      state.noDraft = true;
      state.draft = null;
      state.error = null;
      stopPolling();
      return;
    }
    // 🔴 EVERYTHING ELSE IS TRANSIENT AND MUST NOT STOP THE BOARD. This used to
    // fall through to stopPolling(), which clears BOTH timers — so one network
    // blip, module timeout, 429 or node restart permanently killed that client's
    // draft: it never fetched again and the clock froze mid-count, with no way
    // back but a remount. That is why ctrl+R and tab-switching "fixed" it, and
    // why over a long draft it eventually hit everyone. Reported 2026-08-31.
    state.error = describe(err);
    state._failStreak = Math.min((state._failStreak ?? 0) + 1, FAIL_STREAK_MAX);
    state._skipTicks = Math.min(2 ** state._failStreak, FAIL_SKIP_MAX);
  }
}

/** Is the board still live? False means only a remount will bring it back. */
export function isPolling() { return pollTimer !== null; }

export { poll as _poll, startPolling as _startPolling };

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
    // ⚠️ RESOLVE THE MAP TO A KEY. `settings.scoring` is the weight map, not a
    // name; handed to rankingFor raw it stringifies to "[object object]",
    // matches nothing and silently falls back to PPR — so every half-ppr and
    // standard league drafted off the PPR board, and off it the module
    // autodrafted too, since this same list is what draft:get is sent.
    state.ranking = rankingFor(scoringKeyFor(state.league?.settings?.scoring ?? 'ppr'));
  } catch {
    state.ranking = [];
  }
  await poll(app);
  startPolling(app);
  app?.router?.refresh();
  paintClock();
  bindParallax();
}

/**
 * Everything that must happen the moment a poll settles: the chime, and the
 * auto-pick a flagged absent manager needs.
 *
 * ⚠️ Side effects of a SETTLED BOARD, so they live here and not in render() —
 * render runs on every keystroke and would chime for each one.
 */
function onDraftSettled(app, d) {
  const clock = normalizeClock(d);
  const mine = Boolean(clock) && String(clock.owner) === String(state.teamId);
  if (becameMyTurn(wasMyTurn, mine)) playTurnAlert();
  wasMyTurn = mine;

  const target = autoPickTarget({
    status: d.status,
    clock,
    flags: state.autoDraft,
    isCommissioner: Boolean(state.league?.isCommissioner),
    myTeamId: state.teamId,
  });
  if (!target) return;

  // ⚠️ ONCE PER PICK. Submitting is async and the board keeps polling, so without
  // this the same overall is auto-picked repeatedly while the first is in flight.
  const overall = clock?.overall ?? null;
  if (overall === null || autoSubmittedFor === overall) return;
  autoSubmittedFor = overall;

  const playerId = bestAvailableFor({
    ranking: state.ranking,
    queue: target === state.teamId ? state.queue : [],
    taken: takenIds(),
  });
  // Nothing left to pick: leave it to the module's expiry cascade rather than
  // submitting a null and turning a slow pick into a failed one.
  if (!playerId) return;

  Promise.resolve(makePick(state.leagueId, target, playerId, state.ranking))
    .then(() => poll(app))
    .catch(() => { autoSubmittedFor = null; })   // a failed auto-pick may retry
    .finally(() => app?.router?.refresh());
}

/**
 * Commissioner (any team) or a manager (their own): flip auto-draft on a team.
 *
 * ⚠️ THE MODULE DECIDES WHETHER THIS IS ALLOWED, not this function. `draft:auto`
 * is gated by `requireTeamControl`, so a member who reaches past the UI to flag
 * a team they do not manage is refused server-side — which is the entire reason
 * the flags moved out of member-writable plugin storage.
 *
 * Painted optimistically because a draft board that lags a click feels broken,
 * then REVERTED if the module refuses: leaving the optimistic state up would
 * show a manager auto-drafting when the module knows they are not, which is the
 * one lie this screen must not tell.
 */
export async function toggleAutoDraft(app, teamId) {
  const id = String(teamId ?? '');
  if (!id) return;
  const before = state.autoDraft ?? {};
  const auto = !before[id];
  const next = { ...before };
  if (auto) next[id] = true; else delete next[id];
  state.autoDraft = next;
  app?.router?.refresh();
  try {
    await setAutoDraft(state.leagueId, id, auto);
  } catch (err) {
    state.autoDraft = before;
    state.error = describe(err);
    app?.router?.refresh();
  }
}

/** Mute or unmute the on-the-clock chime. Remembered per browser. */
export function toggleAlert(app) {
  setAlertEnabled(!alertEnabled());
  app?.router?.refresh();
}

export { alertEnabled as isAlertEnabled };

/** Commissioner: take the pick for whoever is on the clock, right now. */
export async function pickForOnClock(app) {
  const clock = normalizeClock(state.draft ?? {});
  if (!clock) return;
  const playerId = bestAvailableFor({ ranking: state.ranking, queue: [], taken: takenIds() });
  if (!playerId) return;
  await act(app, () => makePick(state.leagueId, String(clock.owner), playerId, state.ranking));
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

/**
 * Commissioner: regenerate a not-yet-started board from the current settings.
 *
 * ⚠️ Sends no options, on purpose. `draft:create` falls back to the league's own
 * settings for rounds, type and clock, so passing this view's idea of them would
 * be a second place for those numbers to be wrong.
 */
export async function rebuild(app) {
  await act(app, () => createDraft(state.leagueId), 'Draft rebuilt from the league settings.');
}
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
