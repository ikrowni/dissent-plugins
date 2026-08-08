// views/fantasy-matchups.js — every matchup in the league as a compact scorebug.
import { esc, panel, stateMsg } from '../core/ui.js';
import { scoringKey, buildLineup, sideTotals, winProbability } from '../core/fantasy.js';

/** Byes have no opponent and a margin of 0, which would always win "closest". */
const contested = (list) => (list ?? []).filter((m) => m.home && m.away);

export function closestGame(list) {
  const c = contested(list);
  if (!c.length) return null;
  return c.reduce((best, m) => (m.margin < best.margin ? m : best));
}

export function biggestBlowout(list) {
  const c = contested(list);
  if (!c.length) return null;
  return c.reduce((best, m) => (m.margin > best.margin ? m : best));
}

const pts = (n) => (Math.round(Number(n ?? 0) * 100) / 100).toFixed(2);

function card(m, s, { mine, tag }) {
  const key = scoringKey(s.league);
  const opts = { projections: s.projections ?? {}, key, index: s.playerIndex ?? null };
  const hT = sideTotals(m.home, buildLineup(m.home, s.league, opts));
  const aT = m.away ? sideTotals(m.away, buildLineup(m.away, s.league, opts)) : null;
  const wp = aT ? winProbability(hT, aT) : 100;

  const row = (side, t, lead) => (
    `<div class="fmini-side${lead ? ' lead' : ''}">`
    + `<span class="fmini-team">${esc(side?.teamName ?? '—')}</span>`
    + `<span class="fmini-rec">${esc(side?.record ?? '')}</span>`
    + `<span class="fmini-score num">${esc(pts(t?.actual ?? 0))}</span>`
    + `<span class="fmini-proj num">${esc(pts(t?.projectedFinal ?? 0))}</span>`
    + '</div>'
  );

  return `<div class="fmini${mine ? ' mine' : ''}">`
    + (tag ? `<div class="fmini-tag">${esc(tag)}</div>` : '')
    + row(m.home, hT, m.leaderRosterId === m.home?.rosterId)
    + (m.away ? row(m.away, aT, m.leaderRosterId === m.away.rosterId)
      : '<div class="fmini-side"><span class="fmini-team">Bye</span></div>')
    + `<div class="fmini-bar"><i style="width:${esc(wp)}%"></i></div>`
    + '</div>';
}

export function renderPanel(s) {
  const list = s?.joined ?? [];
  if (!list.length) return stateMsg('No matchups for this week yet.');

  const mine = Number(s?.session?.state?.rosterId ?? 0);
  const close = closestGame(list);
  const blow = biggestBlowout(list);

  const body = '<div class="fmini-grid">' + list.map((m) => {
    const isMine = m.home?.rosterId === mine || m.away?.rosterId === mine;
    let tag = '';
    if (close && m.matchupId === close.matchupId) tag = 'Closest game';
    else if (blow && m.matchupId === blow.matchupId) tag = 'Blowout';
    return card(m, s, { mine: isMine, tag });
  }).join('') + '</div>';

  return panel({
    title: `Week ${esc(s.week ?? '')} around the league`,
    right: `<span class="kicker">${list.length} matchups</span>`,
    body,
  });
}
