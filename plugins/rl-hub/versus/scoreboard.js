// versus/scoreboard.js — the match status bar and the centre match hero.
//
// Band split, so the car marks appear exactly once:
//   top band     compact status — clock, mode, arena, live/replay/final/OT
//   centre band  the match hero — car marks at 120px, the big scores, last goal
//
// The hero renders only when the broadcaster has no Twitch username; with one, the stream
// card takes the centre. See versus/screenstate.js.

import { esc } from '../../plugin-sdk.js';
import { formatTime } from './calc.js';
import { lastGoals } from './state.js';

export function applyTeamColors(teams) {
  const root = document.documentElement;
  const b = teams?.blue;
  const o = teams?.orange;
  if (b?.color_primary)   root.style.setProperty('--rl-blue',        `#${b.color_primary}`);
  if (b?.color_secondary) root.style.setProperty('--rl-blue-accent',  `#${b.color_secondary}`);
  if (o?.color_primary)   root.style.setProperty('--rl-orange',       `#${o.color_primary}`);
  if (o?.color_secondary) root.style.setProperty('--rl-orange-accent', `#${o.color_secondary}`);
}

export function rootClassFor(gs) {
  return gs && gs.is_overtime ? 'vsb-root vsb-ot' : 'vsb-root';
}

function statusPill(gs) {
  if (gs?.has_winner) return `<span class="vsb-pill vsb-final">Final</span>`;
  if (gs?.is_replay)  return `<span class="vsb-pill vsb-replay">Replay</span>`;
  if (gs?.is_overtime) return `<span class="vsb-pill vsb-ot-pill">Overtime</span>`;
  return `<span class="vsb-pill vsb-live">Live</span>`;
}

export function statusBar(gs) {
  if (!gs) {
    return `<div class="vsb-statusbar">
      <span class="vsb-pill vsb-waiting">Waiting</span>
      <span class="vsb-clock">--:--</span>
      <span class="vsb-meta">No match</span>
    </div>`;
  }
  const clock = gs.is_overtime ? '+' + formatTime(gs.time ?? 0) : formatTime(gs.time ?? 0);
  const meta = [gs.mode, gs.arena].filter(Boolean).map(esc).join(' · ');
  return `<div class="vsb-statusbar">
    ${statusPill(gs)}
    <span class="vsb-clock">${esc(clock)}</span>
    <span class="vsb-meta">${meta || '—'}</span>
  </div>`;
}

function mark(team) {
  return `<img class="vsb-mark" src="assets/octane-${team}.png"
       width="120" height="120" alt="" aria-hidden="true" loading="lazy">`;
}

function lastGoalLine() {
  const b = lastGoals().blue;
  const o = lastGoals().orange;
  const latest = [b && { ...b, team: 'blue' }, o && { ...o, team: 'orange' }]
    .filter(Boolean)
    .sort((x, y) => (y.time ?? 0) - (x.time ?? 0))[0];
  if (!latest) return `<div class="vsb-hero-lastgoal empty">No goals yet</div>`;
  const when = latest.time != null ? formatTime(latest.time) : '—';
  return `<div class="vsb-hero-lastgoal">
    <span class="vsb-hero-lastgoal-label">Last goal</span>
    <span class="vsb-hero-lastgoal-name ${latest.team}">${esc(latest.scorer)}</span>
    <span class="vsb-hero-lastgoal-time">${esc(when)}</span>
  </div>`;
}

export function matchHero(gs) {
  const b = gs?.teams?.blue?.score ?? 0;
  const o = gs?.teams?.orange?.score ?? 0;
  return `<div class="vsb-hero">
    <div class="vsb-hero-side blue">
      ${mark('blue')}
      <span class="vsb-hero-score blue${b > o ? ' winning' : ''}">${b}</span>
    </div>
    <div class="vsb-hero-sep">vs</div>
    <div class="vsb-hero-side orange">
      <span class="vsb-hero-score orange${o > b ? ' winning' : ''}">${o}</span>
      ${mark('orange')}
    </div>
    ${lastGoalLine()}
  </div>`;
}
