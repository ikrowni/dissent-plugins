// views/fantasy-moves.js — the league transactions feed.
//
// 19.5% of the live fixture league's transactions have status "failed" (57 of 292). A feed
// that renders those identically to completed ones tells members that players joined
// rosters they never joined, so `succeeded` drives both the styling and the wording.
import { esc, panel, stateMsg } from '../core/ui.js';
import { deepLink } from '../core/sleeper.js';

const playerName = (id, names) => names?.[id] ?? `Player ${id}`;
const teamName = (id, teams) => teams?.[id] ?? `Roster ${id}`;

export function describeMove(t, names, teams) {
  const parts = [];

  for (const x of t.transfers ?? []) {
    parts.push(`${playerName(x.playerId, names)}: `
      + `${teamName(x.fromRosterId, teams)} → ${teamName(x.toRosterId, teams)}`);
  }
  for (const a of t.adds ?? []) {
    parts.push(`${teamName(a.rosterId, teams)} adds ${playerName(a.playerId, names)}`);
  }
  for (const d of t.drops ?? []) {
    parts.push(`${teamName(d.rosterId, teams)} drops ${playerName(d.playerId, names)}`);
  }
  for (const p of t.picks ?? []) {
    parts.push(`${p.season} Round ${p.round}: `
      + `${teamName(p.fromRosterId, teams)} → ${teamName(p.toRosterId, teams)}`);
  }

  return parts.join(' · ') || 'No roster change';
}

function item(t, s) {
  const cls = t.succeeded ? 'mv-ok' : 'mv-failed';
  const bid = t.faabBid ? ` <span class="mv-faab">$${esc(t.faabBid)}</span>` : '';
  const note = !t.succeeded && t.note ? `<div class="mv-note">${esc(t.note)}</div>` : '';

  return `<li class="mv-item ${cls}">`
    + `<span class="mv-type">${esc(t.type ?? 'move')}</span>`
    + `<span class="mv-body">${esc(describeMove(t, s.playerNames, s.rosterNames))}</span>`
    + bid
    + (t.succeeded ? '' : '<span class="mv-flag">failed</span>')
    + note
    + '</li>';
}

/**
 * Handoffs for the two things this tab shows the RESULTS of but cannot do.
 *
 * ⚠️ Sleeper's public API is read-only by their own documentation — no token, no write
 * endpoints — so a trade or a waiver claim cannot be made here at any effort level. This
 * tab is a history; without these it is a history with no way to add to it.
 *
 * `deepLink.trade` and `deepLink.players` existed in core/sleeper.js and were covered by
 * tests, but no view ever rendered them — the same dead end `deepLink.draft` had.
 */
function handoffs(leagueId) {
  if (!leagueId) return '';
  return '<div class="mv-actions">'
    + `<a class="mv-open" href="${esc(deepLink.trade(leagueId))}"`
    + ' target="_blank" rel="noopener noreferrer">Propose a trade in Sleeper &#8599;</a>'
    + `<a class="mv-open" href="${esc(deepLink.players(leagueId))}"`
    + ' target="_blank" rel="noopener noreferrer">Add or drop in Sleeper &#8599;</a>'
    + '</div>';
}

export function renderPanel(s) {
  const weeks = s?.moves ?? [];
  const leagueId = s?.session?.leagueId ?? null;
  // Even with no history the handoffs belong here — a quiet league is exactly when
  // someone wants to make the first move.
  if (!weeks.length) {
    return stateMsg('No transactions in this league yet.') + handoffs(leagueId);
  }

  const body = weeks.map((w) => (
    `<section class="mv-week"><h3>Week ${esc(w.week)}</h3>`
    + `<ul class="mv-list">${w.items.map((t) => item(t, s)).join('')}</ul></section>`
  )).join('');

  const total = weeks.reduce((n, w) => n + w.items.length, 0);
  return panel({
    title: 'Transactions',
    right: `<span class="kicker">${esc(total)} moves</span>`,
    body: handoffs(leagueId) + body,
  });
}
