// views/fantasy-bracket.js — the playoff bracket.
//
// A side is either a roster id or a forward reference to the match that will produce it.
// Unresolved sides print "Winner of M3" rather than "TBD", because TBD everywhere loses the
// structure that makes a bracket worth drawing before it is played.
import { esc, panel, stateMsg } from '../core/ui.js';
import { sideLabel } from '../core/sleeper-bracket.js';

const PLACEMENT = { 1: 'Championship', 3: 'Third place', 5: 'Fifth place' };

function side(rosterId, from, winner, names) {
  const won = rosterId != null && rosterId === winner;
  return `<div class="bk-side${won ? ' bk-won' : ''}">`
    + `${esc(sideLabel(rosterId, from, names))}</div>`;
}

function match(m, names) {
  const tag = PLACEMENT[m.placement];
  return '<div class="bk-match">'
    + (tag ? `<div class="bk-tag">${esc(tag)}</div>` : '')
    + side(m.team1, m.team1From, m.winner, names)
    + side(m.team2, m.team2From, m.winner, names)
    + '</div>';
}

export function renderPanel(s) {
  const rounds = s?.bracketRounds ?? [];
  if (!rounds.length) return stateMsg('The playoff bracket is not set yet.');

  const body = '<div class="bk-grid">' + rounds.map((r) => (
    `<div class="bk-round"><h3>Round ${esc(r.round)}</h3>`
    + r.matches.map((m) => match(m, s.rosterNames)).join('')
    + '</div>'
  )).join('') + '</div>';

  return panel({
    title: s?.bracketKind === 'losers' ? 'Consolation bracket' : 'Playoff bracket',
    body,
  });
}
