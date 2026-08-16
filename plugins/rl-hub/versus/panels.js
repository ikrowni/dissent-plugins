// versus/panels.js — team totals, balance, ball speed, possession, last goal.

import { esc } from '../../plugin-sdk.js';
import {
  formatTime, formatBallSpeed, ballSpeedColor,
  calcPossessionFromTouches, calcOffDef, calcShotAcc, normalizeBarPct,
} from './calc.js';
import { demoCounts, ballTouches, lastGoals } from './state.js';

export function barChart(players, team) {
  const sum   = k => players.reduce((s, p) => s + (p[k] ?? 0), 0);
  const demos = players.reduce((s, p) => s + (demoCounts()[p.name] ?? 0), 0);

  const stats = [
    { lbl: 'Goals',   val: sum('goals')   },
    { lbl: 'Shots',   val: sum('shots')   },
    { lbl: 'Saves',   val: sum('saves')   },
    { lbl: 'Assists', val: sum('assists') },
    { lbl: 'Demos',   val: demos           },
  ];
  const maxVal = Math.max(...stats.map(s => s.val), 1);

  const rows = stats.map(({ lbl, val }) => {
    const pct = normalizeBarPct(val, maxVal);
    return `<div class="vsb-bc-row">
      <span class="vsb-bc-label">${lbl}</span>
      <div class="vsb-bc-track"><div class="vsb-bc-fill ${team}" style="width:${pct}%"></div></div>
      <span class="vsb-bc-val">${val}</span>
    </div>`;
  }).join('');

  return `<div class="vsb-barchart"><div class="vsb-bc-title">TEAM STATS</div>${rows}</div>`;
}

export function ballSpeedCard(gs) {
  const kmh = formatBallSpeed(gs?.ball?.speed ?? 0);
  const cls = ballSpeedColor(kmh);
  return `<div class="vsb-ball-speed-card">
    <div class="vsb-poss-title">BALL SPEED</div>
    <div class="vsb-ball-speed-num ${cls}">${kmh} <span class="vsb-ball-speed-unit">km/h</span></div>
  </div>`;
}

export function possessionCard() {
  const { blue: bPct, orange: oPct } = calcPossessionFromTouches(ballTouches().blue, ballTouches().orange);
  return `<div class="vsb-poss-card">
    <div class="vsb-poss-title">BALL CONTROL</div>
    <div class="vsb-poss-bar">
      <div class="vsb-poss-blue"   style="width:${bPct}%"></div>
      <div class="vsb-poss-orange" style="width:${oPct}%"></div>
    </div>
    <div class="vsb-poss-labels">
      <span class="vsb-poss-pct blue">${bPct}%</span>
      <span class="vsb-poss-pct orange">${oPct}%</span>
    </div>
  </div>`;
}

export function balanceCard(players, team) {
  const { off, def } = calcOffDef(players);
  const acc          = calcShotAcc(players);
  const label        = team === 'blue' ? 'BLUE BALANCE' : 'ORANGE BALANCE';
  return `<div class="vsb-bal-card ${team}">
    <div class="vsb-bal-title">${label}</div>
    <div class="vsb-bal-bar"><div class="vsb-bal-fill ${team}" style="width:${off}%"></div></div>
    <div class="vsb-bal-stat"><span>Off/Def</span><span class="vsb-bal-val">${off}/${def}</span></div>
    <div class="vsb-bal-stat"><span>Shot Acc.</span><span class="vsb-bal-val">${acc}%</span></div>
  </div>`;
}

export function lastGoalCard(side, team) {
  const g     = lastGoals()[side];
  const title = `LAST GOAL — ${team.toUpperCase()}`;
  if (!g) {
    return `<div class="vsb-goal-card ${team}">
      <div class="vsb-goal-title">${title}</div>
      <div class="vsb-goal-scorer empty">—</div>
    </div>`;
  }
  const timeStr = g.time != null ? formatTime(g.time) : '—';
  return `<div class="vsb-goal-card ${team}">
    <div class="vsb-goal-title">${title}</div>
    <div class="vsb-goal-scorer">${esc(g.scorer)}</div>
    <div class="vsb-goal-meta">
      <span>Speed: <strong>—</strong></span>
      <span>@ <strong>${timeStr}</strong></span>
    </div>
  </div>`;
}
