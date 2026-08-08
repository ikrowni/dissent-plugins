// views/fantasy-draft.js — the draft board.
//
// Cheapest surface in the hub: each pick carries its player's name, position and team
// INLINE in `metadata`, so no player-index join and no second fetch. Each pick also carries
// its own round and draft_slot, so the grid is addressed directly and snake ordering is
// never reconstructed.
import { esc, panel, stateMsg } from '../core/ui.js';

function cell(p) {
  if (!p) return '<td class="dr-cell dr-empty"></td>';
  return '<td class="dr-cell">'
    + `<span class="dr-pick num">${esc(p.pickNo ?? '')}</span>`
    + `<span class="dr-name">${esc(p.name)}</span>`
    + `<span class="dr-meta">${esc(p.position)}${p.team ? ` · ${esc(p.team)}` : ''}</span>`
    + (p.isKeeper ? '<span class="dr-keeper">K</span>' : '')
    + '</td>';
}

export function renderPanel(s) {
  const board = s?.board;
  if (!board?.rounds?.length) return stateMsg('No draft has been held in this league yet.');

  const head = '<tr><th></th>'
    + board.slots.map((slot) => {
      const rid = board.slotRoster?.[slot];
      const name = s.rosterNames?.[rid] ?? `Slot ${slot}`;
      return `<th class="dr-head">${esc(name)}</th>`;
    }).join('')
    + '</tr>';

  const rows = board.rounds.map((r) => (
    `<tr class="dr-round"><th class="dr-rno">R${esc(r.round)}</th>`
    + r.cells.map(cell).join('')
    + '</tr>'
  )).join('');

  const kicker = s.draft
    ? `${esc(s.draft.season ?? '')} · ${esc(s.draft.type ?? '')} · ${esc(s.draft.rounds ?? '')} rounds`
    : '';

  return panel({
    title: 'Draft board',
    right: `<span class="kicker">${kicker}</span>`,
    body: `<div class="dr-scroll"><table class="dr-table"><thead>${head}</thead>`
      + `<tbody>${rows}</tbody></table></div>`,
  });
}
