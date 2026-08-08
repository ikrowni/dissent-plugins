// views/fantasy-power.js — power rankings, luck, and playoff odds.
//
// All-play answers "how good is this team really", head-to-head answers "how has the
// schedule treated them", and the gap between the two is luck. All three are shown side by
// side rather than folded into one composite score, because a composite is unarguable in a
// league chat and every weight in it would be invented.
import { esc, panel, stateMsg } from '../core/ui.js';

const pct = (n) => `${Math.round((Number(n) || 0) * 1000) / 10}%`;
const one = (n) => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);

/** One win either side of expectation is ordinary noise, not luck. */
export function luckLabel(luck) {
  const n = Number(luck) || 0;
  if (n >= 1) return 'Lucky';
  if (n <= -1) return 'Unlucky';
  return 'Neutral';
}

function row(r, s) {
  const name = s.users?.[s.rosterOwner?.[r.rosterId]]?.teamName ?? `Roster ${r.rosterId}`;
  const ap = r.allPlay ?? { wins: 0, losses: 0 };
  const label = luckLabel(r.luck);
  const odds = s.odds?.[r.rosterId];

  return '<tr class="pw-row">'
    + `<td class="pw-rank num">${esc(r.rank)}</td>`
    + `<td class="pw-team">${esc(name)}</td>`
    + `<td class="num">${esc(r.wins)}-${esc(r.losses)}</td>`
    + `<td class="num">${esc(ap.wins)}-${esc(ap.losses)}</td>`
    + `<td class="num">${esc(pct(r.allPlayPct))}</td>`
    + `<td class="pw-luck ${esc(label.toLowerCase())}">${esc(label)} ${esc(one(r.luck))}</td>`
    + `<td class="num">${esc(pct(r.efficiency))}</td>`
    + `<td class="pw-odds num">${odds === undefined ? '—' : esc(`${odds}%`)}</td>`
    + '</tr>';
}

export function renderPanel(s) {
  const rows = s?.power ?? [];
  if (!rows.length) {
    return stateMsg('Not enough weeks have been played to rank this league yet.');
  }

  const head = '<tr>'
    + '<th>#</th><th>Team</th><th>Record</th><th>All-play</th><th>AP%</th>'
    + '<th>Luck</th><th>Efficiency</th><th>Playoffs</th>'
    + '</tr>';

  const body = `<table class="pw-table"><thead>${head}</thead>`
    + `<tbody>${rows.map((r) => row(r, s)).join('')}</tbody></table>`
    + (s?.odds
      ? '<p class="pw-note">Playoff odds from 5,000 simulated seasons of the remaining schedule.</p>'
      : '<p class="pw-note">Simulating the rest of the season…</p>');

  return panel({
    title: 'Power rankings',
    right: '<span class="kicker">Ranked by all-play</span>',
    body,
  });
}
