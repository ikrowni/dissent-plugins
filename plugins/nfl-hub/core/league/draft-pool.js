// core/league/draft-pool.js — who is still available, in the order worth taking.
//
// PURE. No DOM, no fetch, no state. Shared by the live draft and the mock, so
// the rehearsal and the event rank players identically.
//
// ⚠️ A DRAFT BOARD WITH NO LIST IS A SEARCH BOX. Before this existed the live
// draft showed players only once you typed two letters, which means you could
// only draft somebody you had already thought of — the exact opposite of what a
// board is for. The pool answers "who is the best player left", and the filters
// answer it per position.

import { eligiblePositions } from './slots.js';

/** Positions the filter row offers, in the order a draft board wants them. */
export const POOL_FILTERS = Object.freeze(['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF']);

// ⚠️ NO LOCAL FLEX SET. `slots.js` is the single source of truth for what any
// slot accepts, and it has known five flex variants from the start. A second
// copy here matched only the literal 'FLEX', so SUPER_FLEX / WRRB_FLEX /
// REC_FLEX / IDP_FLEX fell through to the exact-position branch and looked for
// a player whose POSITION was literally "SUPER_FLEX" — nobody. Superflex
// leagues therefore reported every flex slot permanently unfilled.
const FLEX_POSITIONS = new Set(eligiblePositions('FLEX'));

/** Does this slot accept more than one position? Then it fills LAST. */
function isFlexish(slot) {
  return eligiblePositions(slot).length > 1;
}

/**
 * Does this player match the active filter?
 *
 * ⚠️ THE ONE DEFINITION. `views/draft-board.js` re-exports this rather than
 * keeping its own copy — two of these drift within a week, and the failure is
 * silent: a filter that quietly disagrees with the count beside it.
 */
export function matchesFilter(pos, filter) {
  const p = String(pos ?? '').toUpperCase();
  if (!filter || filter === 'ALL') return true;
  // ⚠️ The FLEX PILL is a filter, not a slot — it means "flex-eligible", and
  // POOL_FILTERS offers exactly one. FLEX_POSITIONS is now derived from
  // slots.js rather than hardcoded, so this stays in step automatically.
  if (filter === 'FLEX') return FLEX_POSITIONS.has(p);
  return p === filter;
}

function toSet(taken) {
  if (taken instanceof Set) return taken;
  return new Set((taken ?? []).map(String));
}

/**
 * Everybody still available, best first.
 *
 * `ranking` is an ordered array of player ids — `assets/draft-ranking.json`, which
 * is value-over-replacement for a season, so the head of it is a real draft board
 * rather than a points leaderboard.
 *
 * ⚠️ `rank` IS THE ORIGINAL RANK, never the row's position in the filtered list.
 * Renumbering from 1 on every pick hides the only thing the number is for — how
 * far a player has slid past where he was supposed to go.
 */
export function availablePool({ ranking = [], taken = [], positionOf = () => null } = {}) {
  const takenSet = toSet(taken);
  const seen = new Set();
  const out = [];

  const list = Array.isArray(ranking) ? ranking : [];
  for (let i = 0; i < list.length; i += 1) {
    const id = String(list[i]);
    // ⚠️ Rank is claimed by the FIRST appearance. A duplicate in the ranking must
    // not produce two rows for one player, each offering a "Draft" button.
    if (seen.has(id)) continue;
    seen.add(id);
    if (takenSet.has(id)) continue;
    out.push({ id, pos: String(positionOf(id) ?? '').toUpperCase(), rank: i + 1 });
  }
  return out;
}

/**
 * Narrow a pool by position and by a name search.
 *
 * The search is a plain substring rather than the index's prefix-first ranking:
 * here the list is ALREADY ordered by draft value, and re-sorting it by how well
 * the name matched would put a replacement-level player above an elite one for
 * no better reason than spelling.
 */
export function filterPool(pool, { filter = 'ALL', query = '', nameOf = () => '' } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  return (pool ?? []).filter((entry) => {
    if (!matchesFilter(entry.pos, filter)) return false;
    if (!q) return true;
    return String(nameOf(entry.id) ?? '').toLowerCase().includes(q);
  });
}

/**
 * How many are left at each filter, for the badge on each tab.
 *
 * ⚠️ Counted from the WHOLE pool, never from the filtered view — a count that
 * changed when you clicked a tab would be describing the tab you are already on.
 */
export function poolCounts(pool) {
  const counts = {};
  for (const f of POOL_FILTERS) counts[f] = 0;
  for (const entry of pool ?? []) {
    for (const f of POOL_FILTERS) {
      if (matchesFilter(entry.pos, f)) counts[f] += 1;
    }
  }
  return counts;
}

/**
 * The starting slots a team has not filled yet.
 *
 * Consumes the roster greedily in slot order, which is why FLEX is resolved
 * last: a team holding one RB and slots ['RB','FLEX'] needs a FLEX, not an RB,
 * and checking FLEX first would report the wrong hole.
 */
export function unfilledSlots(slots = [], owned = []) {
  const pool = (owned ?? []).map((o) => String(o.pos ?? '').toUpperCase());
  const take = (accept) => {
    const i = pool.findIndex(accept);
    if (i === -1) return false;
    pool.splice(i, 1);
    return true;
  };

  const flexish = [];
  const out = [];
  for (const slot of slots ?? []) {
    if (isFlexish(slot)) { flexish.push(slot); continue; }
    if (!take((p) => p === slot)) out.push(slot);
  }
  for (const slot of flexish) {
    const accepts = new Set(eligiblePositions(slot));
    if (!take((p) => accepts.has(p))) out.push(slot);
  }
  return out;
}
