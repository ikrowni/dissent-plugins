// views/fantasy-roster.js — the roster cross-referenced against live NFL.
//
// Every warning ends in a deep-link. Sleeper cannot be written to (spec §1.1), so the hub's
// job is to notice the problem and hand the user to the exact screen that fixes it.
import { esc, panel, stateMsg } from '../core/ui.js';
import { scoringKey, buildLineup, benchPoints } from '../core/fantasy.js';
import { gameContext } from '../core/fantasy-nfl.js';
import { deepLink } from '../core/sleeper.js';

/**
 * Problems worth interrupting someone about, for one starter.
 *
 * A player who has already scored is skipped entirely: the advice is moot once the points
 * are banked, and a red "ON BYE" badge next to 18.2 points reads as a bug, not a warning.
 */
export function warningsFor(row, nfl) {
  if (!row || !nfl) return [];
  if (row.played || (row.actual ?? 0) > 0) return [];

  const out = [];
  if (row.empty) {
    out.push({ kind: 'empty', detail: 'Empty starting slot' });
    return out;
  }
  const status = nfl.injuries?.[row.playerId];
  if (status) out.push({ kind: 'injury', detail: `Listed ${status}` });
  if (row.teamAbbr && (nfl.byeTeams ?? []).includes(row.teamAbbr)) {
    out.push({ kind: 'bye', detail: `${row.teamAbbr} on bye` });
  }
  return out;
}

const pts = (n) => (Math.round(Number(n ?? 0) * 100) / 100).toFixed(2);

const KIND_LABEL = { empty: 'EMPTY', injury: 'INJ', bye: 'BYE' };

function warnBadges(warns, leagueId, rosterId) {
  if (!warns.length) return '';
  const href = leagueId ? deepLink.roster(leagueId, rosterId) : null;
  return `<span class="froster-warn">${warns.map((w) => (
    href
      ? `<a class="badge redzone" target="_blank" rel="noopener noreferrer" href="${esc(href)}">`
        + `${esc(KIND_LABEL[w.kind] ?? '!')} · ${esc(w.detail)}</a>`
      : `<span class="badge redzone">${esc(KIND_LABEL[w.kind] ?? '!')} · ${esc(w.detail)}</span>`
  )).join('')}</span>`;
}

export function renderPanel(s) {
  const rosterId = Number(s?.session?.rosterId ?? 0);
  const leagueId = s?.session?.leagueId ?? null;
  const roster = (s?.rosters ?? []).find((r) => r.rosterId === rosterId) ?? null;
  const side = (s?.joined ?? [])
    .flatMap((m) => [m.home, m.away])
    .find((x) => x && x.rosterId === rosterId) ?? null;

  if (!roster || !side) {
    return stateMsg('Pick your team to see roster intelligence — use “Change league” above.');
  }

  const key = scoringKey(s.league);
  const rows = buildLineup(side, s.league, {
    projections: s.projections ?? {}, key, index: s.playerIndex ?? null,
  });
  const nfl = s.nfl ?? { byeTeams: [], injuries: {}, games: {} };

  const bench = benchPoints(roster);
  const benchNote = bench !== null && bench > 0
    ? `<div class="froster-bench">You left <b>${esc(pts(bench))}</b> on the bench `
      + 'against your optimal lineup.</div>'
    : '';

  const list = rows.map((r) => {
    const warns = warningsFor(r, nfl);
    const name = r.espnId
      ? `<button class="froster-name" data-act="player" data-player="${esc(r.espnId)}">`
        + `${esc(r.name)}</button>`
      : `<span class="froster-name">${esc(r.name)}</span>`;
    return `<div class="froster-row${warns.length ? ' warned' : ''}">`
      + `<span class="froster-slot">${esc(String(r.slot).replace(/_/g, ' '))}</span>`
      + name
      + `<span class="froster-meta">${esc([r.position, r.teamAbbr].filter(Boolean).join(' · '))}`
        + ` · ${esc(gameContext(r, nfl))}</span>`
      + `<span class="froster-pts num">${esc(pts(r.actual))}</span>`
      + `<span class="froster-proj num">proj ${esc(pts(r.projected))}</span>`
      + warnBadges(warns, leagueId, rosterId)
      + '</div>';
  }).join('');

  const right = leagueId
    ? '<a class="badge" target="_blank" rel="noopener noreferrer"'
      + ` href="${esc(deepLink.roster(leagueId, rosterId))}">Edit in Sleeper ↗</a>`
    : '';

  return panel({
    title: 'My roster',
    right,
    body: benchNote + `<div class="froster">${list}</div>`,
  });
}
