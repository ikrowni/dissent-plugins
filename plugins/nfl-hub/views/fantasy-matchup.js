// views/fantasy-matchup.js — my matchup, rendered as a broadcast scorebug.
//
// Pure render: renderPanel(state) -> html string. The section shell (views/fantasy.js) owns
// the data and the events; this module only draws.
import { esc, panel, stateMsg } from '../core/ui.js';
import { scoringKey, buildLineup, sideTotals, winProbability } from '../core/fantasy.js';
import { gameContext } from '../core/fantasy-nfl.js';
import { deepLink, headshotUrl } from '../core/sleeper.js';
import { imageUrl } from '../../plugin-sdk.js';

/** The matchup containing `rosterId`, normalised so `me` is always this user's side. */
export function findMyMatchup(joined, rosterId) {
  if (!joined || !rosterId) return null;
  for (const m of joined) {
    if (m.home?.rosterId === rosterId) return { ...m, me: m.home, opp: m.away };
    if (m.away?.rosterId === rosterId) return { ...m, me: m.away, opp: m.home };
  }
  return null;
}

const pts = (n) => (Math.round(Number(n ?? 0) * 100) / 100).toFixed(2);
const slotLabel = (s) => String(s ?? '').replace(/_/g, ' ');

function cell(r, side, s) {
  if (!r || r.empty) return `<span class="flineup-p empty ${side}">—</span>`;

  const name = r.espnId
    ? `<button class="flineup-name" data-act="player" data-player="${esc(r.espnId)}">`
      + `${esc(r.name)}</button>`
    : `<span class="flineup-name">${esc(r.name)}</span>`;

  // loading="lazy" is load-bearing, not decoration: these are ~99 KB each through the
  // metered node image proxy, and a 24-row matchup would otherwise pull ~2.4 MB up front.
  const shot = r.playerId
    ? `<img class="flineup-shot" src="${esc(imageUrl(headshotUrl(r.playerId)))}" alt=""`
      + ' loading="lazy" width="28" height="28">'
    : '';

  const ctx = gameContext(r, s?.nfl ?? null);

  return `<span class="flineup-p ${side}${r.played ? ' played' : ''}">`
    + shot
    + `<span class="flineup-txt">${name}`
      + `<span class="flineup-meta">${esc([r.position, r.teamAbbr].filter(Boolean).join(' · '))}`
      + `<span class="flineup-ctx">${esc(ctx)}</span></span></span>`
    + `<span class="flineup-pts num">${esc(pts(r.actual))}</span>`
    + `<span class="flineup-proj num">${esc(pts(r.projected))}</span>`
    + '</span>';
}

function lineupRow(mine, theirs, slot, s) {
  return '<div class="flineup-row">'
    + cell(mine, 'l', s)
    + `<span class="flineup-slot">${esc(slotLabel(slot))}</span>`
    + cell(theirs, 'r', s)
    + '</div>';
}

function scorebug(m, meT, oppT, wp) {
  const sideBox = (side, t, key, cls) => (
    `<div class="fmatch-side ${cls}">`
    + `<div class="fmatch-team">${esc(side?.teamName ?? '—')}</div>`
    + `<div class="fmatch-rec">${esc(side?.record ?? '')}</div>`
    + `<div class="fmatch-score num" data-score="${esc(key)}">${esc(pts(t.actual))}</div>`
    + `<div class="fmatch-proj num">proj ${esc(pts(t.projectedFinal))}</div>`
    + '</div>'
  );
  return '<div class="fmatch-bug">'
    + sideBox(m.me, meT, 'me', 'l')
    + '<div class="fmatch-mid">'
      + `<div class="fmatch-wp">${esc(wp)}% <span>to win</span></div>`
      + `<div class="fmatch-wp-bar"><i style="width:${esc(wp)}%"></i></div>`
      + `<div class="fmatch-left">${esc(pts(meT.remaining))} vs `
        + `${esc(pts(oppT.remaining))} left</div>`
    + '</div>'
    + sideBox(m.opp, oppT, 'opp', 'r')
    + '</div>';
}

export function renderPanel(s) {
  const rosterId = Number(s?.session?.state?.rosterId ?? 0);
  const m = findMyMatchup(s?.joined, rosterId);
  if (!m) {
    return stateMsg('No matchup found for your team this week. '
      + 'If you picked the wrong team, use “Change league” above.');
  }

  const key = scoringKey(s.league);
  const opts = { projections: s.projections ?? {}, key, index: s.playerIndex ?? null };
  const mineRows = buildLineup(m.me, s.league, opts);
  const theirRows = buildLineup(m.opp, s.league, opts);
  const meT = sideTotals(m.me, mineRows);
  const oppT = sideTotals(m.opp, theirRows);
  const wp = winProbability(meT, oppT);

  const slots = s.league?.starterSlots ?? [];
  const body = scorebug(m, meT, oppT, wp)
    + '<div class="flineup">'
      + '<div class="flineup-row head">'
        + '<span class="flineup-p l">You</span>'
        + '<span class="flineup-slot">Slot</span>'
        + `<span class="flineup-p r">${esc(m.opp?.teamName ?? 'Opponent')}</span>`
      + '</div>'
      + slots.map((slot, i) => lineupRow(mineRows[i], theirRows[i], slot, s)).join('')
    + '</div>';

  const leagueId = s?.session?.state?.leagueId;
  // Sleeper is read-only (spec §1.1) — a lineup change is a handoff, never an edit here.
  const right = leagueId
    ? '<a class="badge" target="_blank" rel="noopener noreferrer"'
      + ` href="${esc(deepLink.matchup(leagueId, s.week))}">Open in Sleeper ↗</a>`
    : '';

  return panel({ title: `Week ${esc(s.week ?? '')} matchup`, right, body });
}
