// views/game-drive.js — drive chart + play-by-play, both control-room density.
//
// The drive chart is the single highest-value graphic in Game Center: it turns a score
// into a narrative at a glance. Each block is one possession, coloured by outcome.
import { esc, stateMsg } from '../core/ui.js';
import { fmtClock } from '../core/format.js';

const TURNOVER = /INT|FUMBLE|DOWNS|INTERCEPT|TURNOVER|SAFETY/i;
const END = /END|HALF|GAME|CLOCK|SUSPENDED/i;

/** Map a drive result to its block colour class. ESPN's casing is inconsistent. */
export function driveClass(drive) {
  const r = String(drive?.result ?? '').toUpperCase().trim();
  if (!r) return 'end';
  if (r === 'TD' || r.includes('TOUCHDOWN')) return 'td';
  if (r === 'FG' || r.includes('FIELD GOAL')) return 'fg';
  if (r.includes('PUNT')) return 'punt';
  if (TURNOVER.test(r)) return 'turnover';
  if (END.test(r)) return 'end';
  // Missed FG, blocked kick and similar are neither a score nor a turnover.
  return 'end';
}

const LEGEND = [
  ['td', 'Touchdown'], ['fg', 'Field goal'], ['punt', 'Punt'],
  ['turnover', 'Turnover'], ['end', 'Other'],
];

export function renderDriveChart(drives, { selectedId = null } = {}) {
  const list = drives ?? [];
  const body = list.length
    ? `<div class="drives">${list.map((d) => {
      const label = [d.teamAbbr, d.resultText ?? d.result, d.description]
        .filter(Boolean).join(' — ');
      return `<button class="${driveClass(d)}" data-act="drive" data-drive="${esc(d.id)}"`
        + ` aria-current="${String(d.id === selectedId)}" aria-label="${esc(label)}"`
        + ` title="${esc(label)}"></button>`;
    }).join('')}</div>`
      + `<div class="drive-legend">${LEGEND.map(([c, t]) => (
        `<span><i class="${c}"></i>${esc(t)}</span>`
      )).join('')}</div>`
    : stateMsg('No drives yet.');

  return '<div class="mod"><div class="mod-head"><span class="t">Drive chart</span>'
    + `<span class="v">${list.length} drive${list.length === 1 ? '' : 's'}</span></div>`
    + `<div class="mod-body">${body}</div></div>`;
}

export function renderPlayByPlay(plays, { limit = 40 } = {}) {
  const all = plays ?? [];
  const list = all.slice(0, limit);
  const head = '<div class="mod"><div class="mod-head"><span class="t">Play by play</span>';

  if (!list.length) {
    return `${head}</div><div class="mod-body">${stateMsg('No plays yet.')}</div></div>`;
  }

  const rows = list.map((p) => {
    const cls = p.scoring ? ' score' : p.isTurnover ? ' turnover' : '';
    const tag = p.scoring
      ? `<span class="tag">${esc(p.scoreValue >= 6 ? 'TD' : 'SCORE')}</span>`
      : p.isTurnover ? '<span class="tag">TO</span>' : '';
    return `<div class="row${cls}"><span class="tk">${esc(fmtClock(p.period, p.clock))}</span>`
      + `${tag}<span class="txt">${esc(p.text)}</span></div>`;
  }).join('');

  return `${head}<span class="v">${list.length} of ${all.length}</span></div>`
    + `<div class="mod-body"><div class="pbp">${rows}</div></div></div>`;
}
