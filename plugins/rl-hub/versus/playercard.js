// versus/playercard.js — one player's card: name, score, boost, speed, stat icons.

import { esc } from '../../plugin-sdk.js';
import { demoCounts } from './state.js';

export function playerCard(p, team, slotIndex = 0) {
  const demo     = p?.demolished ?? false;
  const ss       = p?.supersonic ?? false;
  const boostPct = demo ? 0 : Math.min(100, Math.max(0, Math.round(p?.boost ?? 0)));
  const demos    = p ? (demoCounts()[p.name] ?? 0) : 0;
  const mbr      = p?.is_member ?? false;

  const cardCls = ['vsb-pcard', team, demo ? 'demo' : '', ss ? 'ss' : ''].filter(Boolean).join(' ');
  const slotLabel = `PLAYER ${slotIndex + 1}`;

  const header = !p
    ? `<div class="vsb-pcard-slot ${team}">${slotLabel}</div><div class="vsb-pcard-header"><span class="vsb-pname empty">—</span></div>`
    : `<div class="vsb-pcard-slot ${team}">${slotLabel}</div><div class="vsb-pcard-header">
        <span class="vsb-pname${mbr ? ' member' : ''}">${esc(p.name ?? '?')}</span>
        <span class="vsb-pscore">${p.score ?? 0}</span>
      </div>`;

  // No emoji. They render at different sizes and weights on every platform and read as
  // amateur against a broadcast layout.
  const badges = [
    p?.on_wall      ? `<span class="vsb-badge">Wall</span>`  : '',
    p?.powersliding ? `<span class="vsb-badge">Slide</span>` : '',
    p?.supersonic   ? `<span class="vsb-badge vsb-badge-ss">Supersonic</span>` : '',
  ].filter(Boolean).join('');
  const badgeRow = badges ? `<div class="vsb-badge-row">${badges}</div>` : '';

  const speedKmh = p ? Math.round((p.speed ?? 0) / 100 * 3.6) : 0;
  const speedRow = p ? `<div class="vsb-speed-row">
  <span class="vsb-speed-label${p?.supersonic ? ' active' : ''}">SPEED</span>
  <span class="vsb-speed-val">${speedKmh} <span class="vsb-speed-unit">km/h</span></span>
</div>` : '';

  const STATS = [
    { lbl: 'Goals', val: p?.goals   ?? 0 },
    { lbl: 'Ast',   val: p?.assists ?? 0 },
    { lbl: 'Saves', val: p?.saves   ?? 0 },
    { lbl: 'Shots', val: p?.shots   ?? 0 },
    { lbl: 'Demos', val: demos            },
    { lbl: 'Touch', val: p?.touches ?? 0 },
  ];
  const icons = STATS.map(s =>
    `<div class="vsb-si"><span class="vsb-si-val">${s.val}</span><span class="vsb-si-lbl">${s.lbl}</span></div>`
  ).join('');

  return `<div class="${cardCls}">
    ${header}
    ${badgeRow}
    <div class="vsb-boost-row">
      <span class="vsb-boost-label${p?.boosting ? ' active' : ''}">BOOST</span>
      <div class="vsb-boost-track"><div class="vsb-boost-fill ${team}" style="width:${boostPct}%"></div></div>
      <span class="vsb-boost-val">${boostPct}</span>
    </div>
    ${speedRow}
    <div class="vsb-stat-icons">${icons}</div>
  </div>`;
}
