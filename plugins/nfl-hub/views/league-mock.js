// views/league-mock.js — run a mock draft against bots.
//
// ⚠️ NOTHING HERE TOUCHES THE SERVER. A mock is a rehearsal: no league, no
// module call, no storage. That is the point — you can blow a first-round pick
// and find out what that feels like at no cost, and you can do it before your
// league even exists.
//
// It shares views/draft-board.js with the live draft, so the rehearsal looks
// exactly like the event.

import { esc, panel, stateMsg } from '../core/ui.js';
import { loadIndex, getIndex } from '../core/player-index.js';
import { loadRanking } from '../core/draft-ranking.js';
import {
  createMock, availableIn, rosterOf, onTheClock, pick as makeMockPick,
  runBotsUntilMyTurn, isComplete, gradeDrafts, bestPickFor, remainingNeed,
} from '../core/mock-draft.js';
import {
  renderBoard, renderOnTheClock, renderFilters, renderPool, renderRosterProgress,
  rosterNeeds,
  matchesFilter,
  renderStage, renderBoardStage, renderHero, renderTicker, renderFeed,
} from './draft-board.js';
import { tickerLine, feedItems } from '../core/draft-intel.js';
import { PPR_SCORING } from '../core/league/scoring.js';

const DEFAULT_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

const state = {
  mock: null,
  ranking: null,      // { season, generated, ppr:[], half:[], std:[] }
  loading: false,
  error: null,
  filter: 'ALL',
  query: '',
  setup: { teams: 12, rounds: 15, slot: 1, scoring: 'ppr' },
};

export function reset() {
  Object.assign(state, {
    mock: null, loading: false, error: null, filter: 'ALL', query: '',
    setup: { teams: 12, rounds: 15, slot: 1, scoring: 'ppr' },
  });
}

const positionOf = (id) => getIndex()?.[String(id)]?.p ?? null;
const playerOf = (id) => getIndex()?.[String(id)] ?? null;

export function render() {
  if (state.error) {
    return panel({
      title: 'Mock draft',
      body: `<p class="muted">${esc(state.error)}</p>
             <button class="btn" data-act="mock-reset">Start over</button>`,
    });
  }
  // ⚠️ A skeleton, not a spinner: it reserves the space the board will occupy,
  // so nothing jumps when the ranking lands, and it says WHAT is coming.
  if (state.loading) {
    return panel({
      title: 'Mock draft',
      body: `<div class="m-skel m-skel-row"></div>
             <div class="m-skel m-skel-row"></div>
             <div class="m-skel m-skel-row"></div>
             <p class="tiny">Building the board…</p>`,
    });
  }
  if (!state.mock) return setupPane();
  return boardPane();
}

/**
 * ⚠️ The ranking's basis is stated on the setup screen, not buried. It is last
 * season's points — it knows nothing about rookies, injuries or a changed depth
 * chart, and a manager who thinks they are looking at projections will draw
 * wrong conclusions from a perfectly working board.
 */
function setupPane() {
  const s = state.setup;
  const opt = (v, cur, label = v) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  return panel({
    title: 'Mock draft',
    body: `
      <p class="muted">Practise against bots. Nothing is saved and no league is touched —
      it is a rehearsal you can run as many times as you like.</p>
      <div class="mock-setup">
        <label class="inline">Teams
          <select data-act="mock-set" data-field="teams">
            ${[8, 10, 12, 14].map((n) => opt(n, s.teams, `${n}`)).join('')}
          </select>
        </label>
        <label class="inline">Rounds
          <select data-act="mock-set" data-field="rounds">
            ${[10, 12, 15, 16].map((n) => opt(n, s.rounds, `${n}`)).join('')}
          </select>
        </label>
        <label class="inline">Your seat
          <select data-act="mock-set" data-field="slot">
            ${Array.from({ length: s.teams }, (_, i) => opt(i + 1, s.slot, `#${i + 1}`)).join('')}
          </select>
        </label>
        <label class="inline">Scoring
          <select data-act="mock-set" data-field="scoring">
            ${opt('ppr', s.scoring, 'PPR')}${opt('half', s.scoring, 'Half PPR')}${opt('std', s.scoring, 'Standard')}
          </select>
        </label>
      </div>
      <div class="row-actions">
        <button class="btn primary" data-act="mock-start">Start mock draft</button>
      </div>
      <p class="tiny">Players are ranked by last season’s fantasy points. That is a real
      ranking, not a projection — it knows nothing about rookies or a changed depth chart.</p>`,
  });
}

function boardPane() {
  const m = state.mock;
  const clock = onTheClock(m);
  const done = isComplete(m);
  const myTurn = Boolean(clock) && clock.owner === m.myTeam;

  const teamLabel = (t) => (t === m.myTeam ? 'You' : `Team ${String(t).replace('m', '')}`);
  const isMine = (t) => t === m.myTeam;

  // ⚠️ THE ORIGINAL RANK, not the position in the remaining pool. Renumbering
  // the available list from 1 on every pick hides the only thing the number is
  // for — how far a player has slid past where they were supposed to go.
  const rankOf = new Map(m.ranking.map((id, i) => [id, i + 1]));
  const all = availableIn(m).map((e) => ({ ...e, rank: rankOf.get(e.id) }));
  const q = state.query.trim().toLowerCase();
  const shown = all.filter((e) => matchesFilter(e.pos, state.filter)
    && (!q || String(playerOf(e.id)?.n ?? '').toLowerCase().includes(q)));

  const counts = {};
  for (const f of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    counts[f] = all.filter((e) => matchesFilter(e.pos, f)).length;
  }

  // ⚠️ THE SAME STAGE AS THE LIVE DRAFT, on purpose. Two boards that looked
  // different would make the rehearsal worthless.
  const stage = renderStage({
    hero: renderHero({
      onClock: clock, teamLabel, isMine, complete: done,
      // ⚠️ NO CLOCK. A mock is turn-based against bots — there is no deadline to
      // count down, and a hero showing "—" would be the rehearsal lying.
      clockText: null,
    }),
    ticker: renderTicker(tickerLine({ picks: m.draft.picks, positionOf, pool: all })),
  });

  // ⚠️ THE BOARD GOES LAST. It is a RECORD — you glance at it between picks to
  // read the run — while the pool is the only thing on this screen you can act
  // on. Ordering the record first put fifteen rounds of mostly-empty cells
  // between a manager and the one control they came for.
  const boardStage = renderBoardStage({
    board: renderBoard({
      order: m.draft.order, picks: m.draft.picks, teamIds: m.teamIds,
      teamLabel, isMine, onClock: clock, playerOf,
    }),
    feed: renderFeed(feedItems({ picks: m.draft.picks, playerOf, teamLabel })),
  });

  return panel({
    title: 'Mock draft',
    flush: true,
    right: `<span class="muted">${Object.keys(m.draft.picks).length} / ${m.draft.order.length} picks</span>`,
    body: `
      ${stage}
      ${done ? gradesPane(m, teamLabel) : ''}
      <div class="mock-cols">
        <div class="mock-pool-col">
          <input class="db-search" type="search" placeholder="Search players…"
                 value="${esc(state.query)}" data-act="mock-search">
          ${renderFilters(state.filter, counts, rosterNeeds({
    // ⚠️ THE FULL ROSTER SHAPE, bench included — `ALL` is roster size over every
    // spot, which is why a full 15-man roster reads `All 15/15` rather than
    // `15/10`. The starters alone would understate it.
    slots: [...DEFAULT_SLOTS, 'BN', 'BN', 'BN', 'BN', 'BN'],
    owned: rosterOf(m, m.myTeam),
  }))}
          ${renderPool({
    available: shown,
    playerOf,
    canPick: myTurn && !done,
    emptyText: done ? 'The draft is over.' : 'Nobody matches that filter.',
  })}
        </div>
        <div class="mock-side">
          <h4>Your roster</h4>
          ${renderRosterProgress({ slots: DEFAULT_SLOTS, owned: rosterOf(m, m.myTeam), playerOf })}
          <div class="row-actions">
            ${done ? '' : `<button class="btn" data-act="mock-sim" title="Let the bots pick for you">Simulate to my next pick</button>`}
            <button class="btn" data-act="mock-reset">New mock</button>
          </div>
        </div>
      </div>
      ${boardStage}`,
  });
}

/**
 * How everybody did, once the board is full.
 *
 * ⚠️ A mock that just stops is a mock nobody runs twice. The grade is what turns
 * a rehearsal into a result — and it is a CURVE against the rest of the room,
 * because every pick came from one board and the total value in it is fixed.
 */
function gradesPane(m, teamLabel) {
  const values = state.ranking?.[`${state.setup.scoring}_v`] ?? {};
  const rows = gradeDrafts(m, (id) => values[String(id)]);
  return `<div class="mock-grades m-rise">
    <h4>How the room drafted</h4>
    <div class="grade-list m-stagger">${rows.map((r, i) => `
      <div class="grade-row${r.teamId === m.myTeam ? ' mine' : ''}">
        <span class="grade-rank">${i + 1}</span>
        <span class="grade-team">${esc(teamLabel(r.teamId))}</span>
        <span class="grade-bar"><span class="grade-bar-fill" style="width:${Math.max(3, Math.round(r.pct * 100))}%"></span></span>
        <span class="grade-mark" data-grade="${esc(r.grade[0])}">${esc(r.grade)}</span>
      </div>`).join('')}</div>
    <p class="tiny">Graded on value over replacement, against the rest of this room —
    every pick came from one board, so one team can only do well by another doing badly.</p>
  </div>`;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export function setField(app, field, value) {
  const n = Number(value);
  state.setup[field] = field === 'scoring' ? String(value) : n;
  // Moving to a smaller league must not leave the human in a seat that no longer
  // exists — they would be assigned the last seat silently at start.
  if (field === 'teams' && state.setup.slot > n) state.setup.slot = n;
  app?.router?.refresh();
}

export async function start(app) {
  state.loading = true;
  state.error = null;
  app?.router?.refresh();
  try {
    await loadIndex();
    // Shared with the live draft, so the rehearsal and the event rank from one
    // fetch and one ordering.
    if (!state.ranking) state.ranking = await loadRanking();
    const { teams, rounds, slot, scoring } = state.setup;
    const ranking = state.ranking[scoring] ?? state.ranking.ppr ?? [];
    if (ranking.length === 0) throw new Error('the draft ranking is empty');
    state.mock = runBotsUntilMyTurn(createMock({
      teams, rounds, slot, rosterPositions: [...DEFAULT_SLOTS, 'BN', 'BN', 'BN', 'BN', 'BN'],
      ranking, positionOf, seed: Date.now() % 100000,
    }));
    state.filter = 'ALL';
    state.query = '';
  } catch (err) {
    state.error = `Could not start the mock: ${String(err?.message ?? err)}`;
  } finally {
    state.loading = false;
    app?.router?.refresh();
  }
}

/** Take a player, then let the bots run back round to you. */
export function take(app, playerId) {
  if (!state.mock) return;
  const clock = onTheClock(state.mock);
  if (!clock || clock.owner !== state.mock.myTeam) return;
  state.mock = runBotsUntilMyTurn(makeMockPick(state.mock, playerId));
  app?.router?.refresh();
}

/**
 * Hand this pick to the bots.
 *
 * ⚠️ It picks FOR you and then continues, rather than skipping your turn — a
 * skipped pick would leave a hole in the board that the real draft can never
 * produce, and the rehearsal would stop matching the event.
 */
export function simulate(app) {
  if (!state.mock || isComplete(state.mock)) return;
  const avail = availableIn(state.mock);
  if (avail.length === 0) return;
  // 🔴 THE SAME NEED-AWARE LOGIC THE BOTS USE. This was `avail[0]` — the raw top
  // of the ranking — so simulating filled the human's roster with the kickers and
  // defences that survive to the late rounds, and never filled WR/TE/FLEX.
  const mine = rosterOf(state.mock, state.mock.myTeam);
  const chosen = bestPickFor(avail, {
    need: remainingNeed(state.mock.rosterPositions, mine.map((o) => o.pos)),
    owned: mine,
  });
  if (!chosen) return;
  state.mock = runBotsUntilMyTurn(makeMockPick(state.mock, chosen));
  app?.router?.refresh();
}

export function setFilter(app, filter) {
  state.filter = String(filter ?? 'ALL');
  app?.router?.refresh();
}

export function search(app, query, caret = null) {
  state.query = String(query ?? '');
  app?.router?.refresh();
  // The hub re-renders the whole view, which destroys the input — restore focus
  // synchronously or the box is unusable after one keystroke.
  if (typeof document !== 'undefined') {
    const el = document.querySelector('[data-act="mock-search"]');
    if (el) {
      el.focus();
      const pos = caret === null ? el.value.length : caret;
      try { el.setSelectionRange(pos, pos); } catch { /* some inputs refuse */ }
    }
  }
}

export function restart(app) {
  state.mock = null;
  state.error = null;
  app?.router?.refresh();
}

export { state as _state, DEFAULT_SLOTS, PPR_SCORING };
