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

/**
 * The draft picker.
 *
 * Exists because a viewer has more than one draft and the hub used to show whichever
 * came first. Mocks are labelled: they sit behind leagues the user's league list does
 * not return, so without a label the list reads as duplicates of the same league name —
 * this account genuinely has two drafts both called "Happy Hour", one real and one mock.
 */
function picker(s) {
  const drafts = s?.drafts ?? [];
  if (drafts.length < 2) return '';
  return `<div class="dr-picker">${drafts.map((d) => {
    const on = d.draftId === s.draftId;
    const when = d.startTime ? new Date(d.startTime).toLocaleDateString() : '';
    return `<button class="dr-tab${on ? ' is-on' : ''}" data-act="draft-pick"`
      + ` data-draft="${esc(d.draftId)}">`
      + `<span class="dr-tab-name">${esc(d.name ?? d.draftId)}</span>`
      + `<span class="dr-tab-meta">${esc(when)}`
      + (d.teams ? ` · ${esc(d.teams)} teams` : '')
      + (d.isMock ? ' · <b>Mock</b>' : '')
      + (d.status && d.status !== 'complete' ? ` · ${esc(d.status)}` : '')
      + '</span></button>';
  }).join('')}</div>`;
}

export function renderPanel(s) {
  const board = s?.board;
  if (!board?.rounds?.length) {
    // ⚠️ Say WHICH draft is empty. "No draft in this league" was wrong and confusing
    // once mocks are listed — the tab may be showing a pre-draft league while three
    // completed mocks sit in the picker right above the message.
    const chosen = (s?.drafts ?? []).find((d) => d.draftId === s?.draftId);
    return picker(s) + stateMsg(chosen
      ? `${chosen.name ?? 'This draft'} has no picks yet (${chosen.status ?? 'not started'}).`
      : 'No draft found for this account yet.');
  }

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
    body: picker(s)
      + `<div class="dr-scroll"><table class="dr-table"><thead>${head}</thead>`
      + `<tbody>${rows}</tbody></table></div>`,
  });
}
