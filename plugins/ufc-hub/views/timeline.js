// views/timeline.js — the play-by-play, and the counts derived from it.
//
// ⚠️ These are TRACKED ACTIONS, not official UFC statistics. No measured source carries
// strike-level data, so the header says "tracked actions" and nothing here may be labelled
// "significant strikes".
import { esc, panel, stateMsg } from '../core/ui.js';
import { actionCounts } from '../core/fight-timeline.js';
import { renderPbp } from './pbp.js';

const nameOf = (id, names) => names?.[id] ?? (id != null ? `Fighter ${id}` : '');

function countsBlock(events, names) {
  const counts = actionCounts(events);
  const ids = Object.keys(counts);
  if (!ids.length) return '';

  const rows = ids.map((id) => {
    const c = counts[id];
    // takedownAttempts counts attempts ONLY, so "landed of total" adds the two.
    const total = c.takedowns + c.takedownAttempts;
    return '<tr>'
      + `<td class="tl-who">${esc(nameOf(id, names))}</td>`
      + `<td class="num">${esc(c.takedowns)}/${esc(total)}</td>`
      + `<td class="num">${esc(c.knockdowns)}</td>`
      + `<td class="num">${esc(c.submissionAttempts)}</td>`
      + `<td class="num">${esc(c.reversals)}</td>`
      + '</tr>';
  }).join('');

  return '<div class="tl-counts"><table>'
    + '<thead><tr><th>Tracked actions</th><th>TD</th><th>KD</th><th>SUB</th><th>REV</th></tr></thead>'
    + `<tbody>${rows}</tbody></table>`
    + '<p class="tl-note">Tracked actions from UFC’s live feed — not official statistics.</p>'
    + '</div>';
}

export function renderPanel(s) {
  const events = s?.events ?? [];
  if (!events.length) return stateMsg('No play-by-play for this fight yet.');

  const body = countsBlock(events, s?.fighterNames)
    + renderPbp(events, s?.fighterNames ?? {});

  return panel({ title: 'Play-by-play', body });
}
