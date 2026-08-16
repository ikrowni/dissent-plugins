// versus/scoreboard.js — clock, scores, arena, and the live/replay/final pill.

import { esc } from '../../plugin-sdk.js';
import { formatTime } from './calc.js';

export function applyTeamColors(teams) {
  const root = document.documentElement;
  const b = teams?.blue;
  const o = teams?.orange;
  if (b?.color_primary)   root.style.setProperty('--rl-blue',        `#${b.color_primary}`);
  if (b?.color_secondary) root.style.setProperty('--rl-blue-accent',  `#${b.color_secondary}`);
  if (o?.color_primary)   root.style.setProperty('--rl-orange',       `#${o.color_primary}`);
  if (o?.color_secondary) root.style.setProperty('--rl-orange-accent', `#${o.color_secondary}`);
}

export function timerCard(gs) {
  const bScore = gs.teams?.blue?.score   ?? 0;
  const oScore = gs.teams?.orange?.score ?? 0;
  const pillCls  = gs.has_winner ? 'vsb-final' : gs.is_replay ? 'vsb-replay' : 'vsb-live';
  const pillText = gs.has_winner ? 'FINAL'     : gs.is_replay ? 'REPLAY'     : 'LIVE';
  const timeHTML = gs.is_overtime
    ? `<span class="vsb-ot-tag">OT</span>`
    : `<span class="vsb-time">${esc(formatTime(gs.time ?? 0))}</span>`;

  return `<div class="vsb-timer-card">
    <div class="vsb-scores-row">
      <span class="vsb-big-score blue${bScore > oScore ? ' winning' : ''}">${bScore}</span>
      <div class="vsb-timer-mid">
        <span class="vsb-pill ${pillCls}">${pillText}</span>
        ${timeHTML}
      </div>
      <span class="vsb-big-score orange${oScore > bScore ? ' winning' : ''}">${oScore}</span>
    </div>
    <div class="vsb-arena-name">${esc(gs.arena ?? '—')}</div>
  </div>`;
}

export function timerCardIdle() {
  return `<div class="vsb-timer-card">
    <div class="vsb-scores-row">
      <span class="vsb-big-score blue idle">—</span>
      <div class="vsb-timer-mid">
        <span class="vsb-pill vsb-waiting">WAITING</span>
        <span class="vsb-time">--:--</span>
      </div>
      <span class="vsb-big-score orange idle">—</span>
    </div>
    <div class="vsb-arena-name">—</div>
  </div>`;
}
