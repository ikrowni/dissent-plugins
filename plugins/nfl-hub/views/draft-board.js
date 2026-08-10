// views/draft-board.js — the board, the pool and the clock.
//
// PURE RENDER. No state, no fetching, no actions of its own — it is handed a
// normalised shape and returns HTML. That is what lets the live draft and the
// mock draft share it: two boards that looked different would make the rehearsal
// worthless, and two implementations would drift within a week.
//
// ⚠️ THE BOARD IS THE PRODUCT. A fantasy draft is the one moment everybody is in
// the room at once, and a list of text rows does not carry it. Rounds run down,
// teams run across, and every pick is coloured by position — which is the only
// way to see the shape of a roster, or a run on running backs, at a glance.

import { esc } from '../core/ui.js';
import { playerChip, positionColor, positionPill, avatar } from '../core/player-visuals.js';

/** Positions the filter offers, in the order a draft board wants them. */
export const POOL_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

/** Does this player match the active filter? */
export function matchesFilter(pos, filter) {
  const p = String(pos ?? '').toUpperCase();
  if (!filter || filter === 'ALL') return true;
  if (filter === 'FLEX') return FLEX_POSITIONS.has(p);
  return p === filter;
}

/**
 * The grid: rounds down, teams across.
 *
 * ⚠️ SNAKE ORDER IS DRAWN, NOT DESCRIBED. In a snake the second round runs right
 * to left, and a board that ignores that puts each pick under the wrong manager —
 * which is not a cosmetic error, it is the board telling you a lie about who
 * picked. Each cell is placed by its OWNER's column, whatever the pick order.
 */
export function renderBoard({
  order = [], picks = {}, teamIds = [], teamLabel = (t) => t, isMine = () => false,
  onClock = null, playerOf = () => null, maxRounds = null,
} = {}) {
  if (order.length === 0 || teamIds.length === 0) {
    return '<p class="muted">The board appears once the draft order is set.</p>';
  }

  const rounds = [...new Set(order.map((p) => p.round))]
    .sort((a, b) => a - b)
    .slice(0, maxRounds ?? Infinity);
  const colOf = new Map(teamIds.map((t, i) => [String(t), i]));

  const head = `<div class="db-row db-head">
    <div class="db-rd"></div>
    ${teamIds.map((t) => `<div class="db-th${isMine(t) ? ' mine' : ''}">${esc(teamLabel(t))}</div>`).join('')}
  </div>`;

  const body = rounds.map((round) => {
    const cells = new Array(teamIds.length).fill('<div class="db-cell db-empty"></div>');
    for (const p of order.filter((x) => x.round === round)) {
      const col = colOf.get(String(p.owner));
      if (col === undefined) continue;
      cells[col] = cell(p, picks[p.overall], onClock, playerOf, isMine(p.owner));
    }
    return `<div class="db-row">
      <div class="db-rd">${round}</div>${cells.join('')}
    </div>`;
  }).join('');

  return `<div class="db-scroll"><div class="db" style="--db-cols:${teamIds.length}">${head}${body}</div></div>`;
}

function cell(pick, made, onClock, playerOf, mine) {
  const live = onClock && onClock.overall === pick.overall;
  if (!made) {
    return `<div class="db-cell${live ? ' db-live' : ''}${mine ? ' db-mine' : ''}">
      <span class="db-no">${pick.round}.${String(pick.pickInRound).padStart(2, '0')}</span>
      ${live ? '<span class="db-clocktag">On the clock</span>' : ''}
    </div>`;
  }
  const p = playerOf(made.playerId);
  const color = positionColor(p?.p);
  return `<div class="db-cell db-made${mine ? ' db-mine' : ''}" style="--db-pos:${esc(color)}">
    <span class="db-name">${esc(p?.n ?? made.playerId)}</span>
    <span class="db-sub">${esc(String(p?.p ?? '').toUpperCase())}${p?.t ? ` · ${esc(p.t)}` : ''}</span>
    ${made.auto ? '<span class="db-auto" title="Auto-picked">auto</span>' : ''}
  </div>`;
}

/**
 * Who is up, and what they are choosing between.
 *
 * ⚠️ "On the clock" has to be the loudest thing on the screen. In a live draft
 * the single question anybody has is whether it is their turn.
 */
export function renderOnTheClock({ onClock, teamLabel = (t) => t, isMine = () => false, complete = false }) {
  if (complete) {
    return `<div class="db-clock db-clock-done">
      <span class="db-clock-label">Draft complete</span>
      <span class="db-clock-team">Every pick is in</span>
    </div>`;
  }
  if (!onClock) return '';
  const mine = isMine(onClock.owner);
  return `<div class="db-clock${mine ? ' is-me' : ''}">
    <span class="db-clock-label">${mine ? 'You are on the clock' : 'On the clock'}</span>
    <span class="db-clock-team">${esc(teamLabel(onClock.owner))}</span>
    <span class="db-clock-pick">Round ${onClock.round} · pick ${onClock.pickInRound} · #${onClock.overall} overall</span>
  </div>`;
}

/** The position filter row. */
export function renderFilters(active = 'ALL', counts = {}) {
  return `<div class="db-filters" role="tablist">${POOL_FILTERS.map((f) => {
    const n = counts[f];
    return `<button class="db-filter${active === f ? ' on' : ''}" role="tab"
      aria-selected="${active === f}" data-act="draft-filter" data-filter="${f}"
      ${f === 'ALL' ? '' : `style="--db-pos:${esc(positionColor(f === 'FLEX' ? 'RB' : f))}"`}>
      ${esc(f)}${n === undefined ? '' : ` <span class="db-filter-n">${n}</span>`}
    </button>`;
  }).join('')}</div>`;
}

/**
 * The pool of players still available.
 *
 * ⚠️ RANK IS SHOWN, because a board without it is just an alphabet. The number
 * is where the player sat before anybody picked, so a manager can see how far a
 * run has pushed somebody down.
 */
export function renderPool({
  available = [], playerOf = () => null, canPick = false, limit = 60, emptyText = 'Nobody left.',
} = {}) {
  if (available.length === 0) return `<p class="muted">${esc(emptyText)}</p>`;
  const rows = available.slice(0, limit).map((entry) => {
    const p = playerOf(entry.id);
    return `<div class="db-pool-row m-lift">
      <span class="db-rank">${entry.rank ?? ''}</span>
      ${playerChip(p ?? { n: entry.id, p: entry.pos }, { size: 34, compact: true })}
      ${canPick
    ? `<button class="btn primary db-take" data-act="draft-take" data-player="${esc(entry.id)}">Draft</button>`
    : ''}
    </div>`;
  }).join('');
  const more = available.length > limit
    ? `<p class="tiny">${available.length - limit} more — narrow it with a filter or the search box.</p>`
    : '';
  return `<div class="db-pool m-stagger">${rows}</div>${more}`;
}

/**
 * One team's roster as it fills, grouped by starting slot.
 *
 * ⚠️ Shows the SLOTS, not just what was taken — an empty QB row is the single
 * most useful thing on a draft screen and a plain list of picks never shows it.
 */
export function renderRosterProgress({ slots = [], owned = [], playerOf = () => null }) {
  const pool = [...owned];
  const take = (accept) => {
    const i = pool.findIndex((o) => accept(String(o.pos ?? '').toUpperCase()));
    return i === -1 ? null : pool.splice(i, 1)[0];
  };

  const filled = slots.map((slot) => {
    const got = slot === 'FLEX'
      ? take((p) => FLEX_POSITIONS.has(p))
      : take((p) => p === slot);
    return { slot, got };
  });

  const rows = filled.map(({ slot, got }) => {
    const p = got ? playerOf(got.id) : null;
    return `<div class="db-slot${got ? ' filled' : ''}">
      <span class="db-slot-tag" style="--db-pos:${esc(positionColor(slot === 'FLEX' ? 'RB' : slot))}">${esc(slot)}</span>
      ${p ? `${avatar(p, { size: 26 })}<span class="db-slot-name">${esc(p.n)}</span>`
    : '<span class="db-slot-empty">—</span>'}
    </div>`;
  }).join('');

  const extra = pool.length
    ? `<div class="db-bench"><span class="db-slot-tag">BN</span>
        ${pool.map((o) => positionPill(o.pos)).join('')}
        <span class="tiny">${pool.length} on the bench</span></div>`
    : '';

  return `<div class="db-roster m-stagger">${rows}${extra}</div>`;
}
