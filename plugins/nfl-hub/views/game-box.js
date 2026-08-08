// views/game-box.js — team stat comparison + player box score.
//
// Both read the game SUMMARY payload. Its boxscore nesting varies with game state
// (empty pregame, partial in-progress), so every accessor is defensive and each
// renderer degrades to its own empty state rather than throwing.
import { esc, stateMsg, cmpRow } from '../core/ui.js';

/** Stats worth comparing side by side, in broadcast order. Names verified against the
 *  real summary payload on 2026-08-08. */
const WANTED = [
  ['totalYards', 'Total yards'],
  ['firstDowns', 'First downs'],
  ['thirdDownEff', 'Third down'],
  ['totalDrives', 'Drives'],
  ['possessionTime', 'Time of poss.'],
  ['turnovers', 'Turnovers'],
  ['totalPenaltiesYards', 'Penalties'],
];

export function parseTeamStats(summary) {
  const teams = summary?.boxscore?.teams ?? [];
  if (teams.length < 2) return [];

  const statsOf = (team) => {
    const m = new Map();
    for (const s of team?.statistics ?? []) m.set(s.name, s.displayValue ?? s.value);
    return m;
  };

  // Keyed on homeAway, which the payload carries explicitly. Index order happens to
  // be away-first in every fixture seen, but relying on that would silently swap both
  // columns if ESPN ever reordered them.
  const homeTeam = teams.find((t) => t.homeAway === 'home') ?? teams[1];
  const awayTeam = teams.find((t) => t.homeAway === 'away') ?? teams[0];
  const home = statsOf(homeTeam);
  const away = statsOf(awayTeam);

  const out = [];
  for (const [key, label] of WANTED) {
    if (!away.has(key) && !home.has(key)) continue;
    out.push({ label, away: away.get(key) ?? '—', home: home.get(key) ?? '—' });
  }
  return out;
}

export function renderComparison(rows, teams) {
  const list = rows ?? [];
  const head = '<div class="mod"><div class="mod-head"><span class="t">Team comparison</span></div>';
  if (!list.length) {
    return `${head}<div class="mod-body">`
      + `${stateMsg('Team stats are not available yet.')}</div></div>`;
  }
  const homeCol = teams?.home?.primary ?? '#5b8dd9';
  const awayCol = teams?.away?.primary ?? '#e0596c';
  // cmpRow coerces for the bar width and keeps the original string for display, which
  // is what lets a stat like "18:04" render as itself without NaN in the width.
  const body = list.map((r) => cmpRow(r.label, r.away, r.home, awayCol, homeCol)).join('');
  return `${head}<div class="mod-body"><div class="cmp">${body}</div></div></div>`;
}

export function renderBoxScore(summary) {
  const blocks = summary?.boxscore?.players ?? [];
  const head = '<div class="mod"><div class="mod-head"><span class="t">Box score</span></div>';
  const empty = `${head}<div class="mod-body">${stateMsg('No box score yet.')}</div></div>`;
  if (!blocks.length) return empty;

  let body = '';
  for (const block of blocks) {
    const abbr = block.team?.abbreviation ?? '';
    for (const cat of block.statistics ?? []) {
      const labels = cat.labels ?? [];
      const rows = (cat.athletes ?? []).map((a) => (
        `<tr><td>${esc(a.athlete?.displayName ?? '')}</td>`
        + (a.stats ?? []).map((s) => `<td class="num">${esc(s)}</td>`).join('')
        + '</tr>'
      )).join('');
      // A category with no athletes would render as a header with no body.
      if (!rows) continue;
      body += '<div style="padding:10px 12px">'
        + `<div class="kicker" style="margin-bottom:6px">${esc(abbr)} · ${esc(cat.name ?? '')}</div>`
        + '<table class="grid"><thead><tr><th>Player</th>'
        + labels.map((l) => `<th>${esc(l)}</th>`).join('')
        + `</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  }

  if (!body) return empty;
  return `${head}<div class="mod-body" style="padding:0">${body}</div></div>`;
}
