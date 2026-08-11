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
import { POOL_FILTERS, matchesFilter } from '../core/league/draft-pool.js';

// ⚠️ RE-EXPORTED, NOT REDEFINED. The filter rule now lives in core/league so the
// live draft, the mock and the pool counts all answer it the same way. This file
// keeps exporting both so existing importers do not care where they moved to.
export { POOL_FILTERS, matchesFilter };

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

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
/**
 * How many picks happen before this team's next one.
 *
 * Feeds the queue's NEXT PICK divider: that many players come off the board
 * before the manager chooses again, so anything past that point in the queue is
 * unlikely to survive.
 *
 * 0 means on the clock. null means no pick left — the divider is then
 * meaningless and must not be drawn at all.
 */
export function picksUntilTurn(order = [], picks = {}, teamId = null) {
  if (!teamId) return null;
  const made = new Set(Object.keys(picks ?? {}).map((k) => Number(k)));
  const upcoming = (order ?? [])
    .filter((p) => !made.has(Number(p.overall)))
    .sort((a, b) => a.overall - b.overall);
  const idx = upcoming.findIndex((p) => String(p.owner) === String(teamId));
  return idx === -1 ? null : idx;
}

/**
 * A manager's autodraft queue.
 *
 * ⚠️ THE DIVIDER IS THE POINT. Sleeper draws a `NEXT PICK` line inside the queue
 * showing how far down the list this manager's next pick is likely to reach —
 * verified live on 2026-08-11, where a pre-draft queue put it at the very top.
 * Without it a queue is a wish list; with it, it is a plan.
 *
 * It is drawn only when it falls INSIDE the queue: a divider hanging off the end
 * says nothing, and one drawn with no next turn is a lie.
 *
 * ⚠️ The queue is what makes autodraft express a preference. Until this shipped,
 * `setQueue()` had no caller and every autodraft fell through to the league
 * ranking — see `server/ops-draft.js` `autoPicker`.
 */
export function renderQueue({
  queue = [], playerOf = () => null, untilTurn = null, canEdit = false,
} = {}) {
  const head = `<div class="db-q-head">QUEUE (${queue.length})</div>`;
  if (queue.length === 0) {
    return `<div class="db-queue">${head}<p class="muted">Queue is empty. Queued players are picked for you if your clock runs out.</p></div>`;
  }

  const divider = '<div class="db-q-divider" role="separator">NEXT PICK</div>';
  const showDivider = untilTurn !== null && untilTurn <= queue.length;

  const rows = queue.map((id, i) => {
    const p = playerOf(id);
    const name = p ? p.n : `Player ${id}`;
    const meta = p ? `${p.p ?? ''} - ${p.t ?? ''}` : '';
    const safe = esc(String(id));
    return `${showDivider && i === untilTurn ? divider : ''}
      <div class="db-q-row">
        <span class="db-q-rank">${i + 1}</span>
        <span class="db-q-name">${esc(name)}</span>
        <span class="db-q-meta">${esc(meta)}</span>
        ${canEdit ? `<button class="db-q-up" data-act="draft-queue-up" data-player="${safe}" aria-label="Move ${esc(name)} up">↑</button>
        <button class="db-q-rm" data-act="draft-queue-remove" data-player="${safe}" aria-label="Remove ${esc(name)}">REMOVE</button>` : ''}
      </div>`;
  }).join('');

  const trailing = showDivider && untilTurn === queue.length ? divider : '';
  return `<div class="db-queue">${head}${rows}${trailing}</div>`;
}

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
