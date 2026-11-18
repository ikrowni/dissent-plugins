// core/lineup-cells.js — the bye and projection cells, rendered once.
//
// ⚠️ THREE SURFACES SHOW THESE TWO NUMBERS: My Roster, an expanded matchup
// lineup, and both trade tables. They were written twice before this module
// existed and had already drifted — one put Proj before Bye and the other the
// reverse, so the same two columns read in a different order depending on which
// tab you were on. Two copies of a cell is two chances to render an unknown as
// 0, which is the one mistake these cells must never make.
//
// ⚠️ MARKUP LIVES HERE, DATA DOES NOT. The caller supplies season, week and the
// league's scoring map; this module has no view state of its own.

import { esc } from './ui.js';
import { byeWeekFor } from './draft-ranking.js';
import { projectedThisWeek } from './weekly-projections.js';

/**
 * The two column headers, so every table names them the same way.
 *
 * ⚠️ THE TITLES ARE THE CONTRACT. "Proj" is THIS WEEK, scored with the league's
 * own rules — not a season total and not Sleeper's default PPR. A column whose
 * tooltip describes a different quantity than the cells hold is worse than an
 * unlabelled column, and that has already happened once here.
 */
export function byeProjHead() {
  return '<th class="num" title="The week this player\'s NFL team does not play">Bye</th>'
    + '<th class="num" title="Projected points for this week, scored with this league\'s own rules">Proj</th>';
}

/**
 * The two cells for one player.
 *
 * ⚠️ AN UNKNOWN VALUE IS A DASH, NEVER A ZERO, in both columns. 0 is a real
 * projection for somebody not expected to play, and week 0 is not a bye — so a
 * 0 in either cell is a confident statement that happens to be false.
 *
 * `week` is the week being LOOKED AT, which is not always the league's current
 * one: a matchup browsed back to week 6 must show week 6's projection.
 */
export function byeProjCells(playerId, { team, season, week, scoring } = {}) {
  const bye = byeWeekFor(team);
  const proj = projectedThisWeek(playerId, { season, week, scoring });
  const wk = Number(week);
  const onBye = bye !== null && Number.isFinite(wk) && bye === wk;
  const pastBye = bye !== null && Number.isFinite(wk) && bye < wk;

  return `<td class="num bye ${onBye ? 'on-bye' : ''} ${pastBye ? 'past' : ''}">${
    bye === null ? '<span class="muted">—</span>' : esc(String(bye))}</td>
    <td class="num proj">${
  proj === null ? '<span class="muted">—</span>' : esc(proj.toFixed(1))}</td>`;
}

/** Whether this player is on bye in the week being looked at. */
export function isOnBye(team, week) {
  const bye = byeWeekFor(team);
  return bye !== null && Number.isFinite(Number(week)) && bye === Number(week);
}
