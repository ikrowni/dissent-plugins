// views/schedule.js — the month pager. Past and future, DWCS and Road To UFC included.
//
// Replaces "only ever the next event", which is what made every finished card
// unreachable: the hub built its index from the CURRENT month alone, so on the 1st of a
// month every result from the month before vanished, including a card that ran two days
// earlier.
//
// Render-only: returns an HTML string, emits data-act, and holds no state.
import { esc, panel, stateMsg } from '../core/ui.js';
import { monthLabel, eventPhase, sortByDate } from '../core/schedule.js';
import { fmtDateTime } from '../core/format.js';

const PHASE_LABEL = { past: 'Final', live: 'Live', upcoming: 'Upcoming' };

function row(e, selectedId) {
  const phase = eventPhase(e);
  const isOpen = String(e.id) === String(selectedId);
  return `<button class="sch-row is-${esc(phase)}${isOpen ? ' is-open' : ''}"`
    + ` data-act="pick-event" data-event="${esc(e.id)}">`
    + '<span class="sch-when">'
      + `<b>${esc(fmtDateTime(e.startTime))}</b>`
      + `<i class="sch-phase">${esc(PHASE_LABEL[phase])}</i>`
    + '</span>'
    + `<span class="sch-name">${esc(e.name)}</span>`
    + '<span class="sch-meta">'
      + (e.fightCount ? `<span class="num">${esc(e.fightCount)} fights</span>` : '')
    + '</span>'
    + '</button>';
}

/**
 * @param s { monthKey, events, selectedId, loading }
 */
export function renderPanel(s) {
  const key = s?.monthKey;
  const events = sortByDate(s?.events);

  const pager = '<div class="sch-pager">'
    + '<button class="sch-nav" data-act="month" data-delta="-1"'
    + ' aria-label="Previous month">&larr;</button>'
    + `<h3>${esc(monthLabel(key))}</h3>`
    + '<button class="sch-nav" data-act="month" data-delta="1"'
    + ' aria-label="Next month">&rarr;</button>'
    + '</div>';

  // A month with no card is normal — the UFC does not run every week of the year — so
  // it reads as an empty month, not as an error.
  const body = s?.loading
    ? stateMsg('Loading the schedule…', { spinner: true })
    : (events.length
      ? `<div class="sch-list">${events.map((e) => row(e, s.selectedId)).join('')}</div>`
      : stateMsg('No events this month.'));

  return panel({ title: 'Schedule', body: pager + body, flush: true });
}
