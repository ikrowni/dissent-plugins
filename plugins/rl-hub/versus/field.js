// versus/field.js — the positional field canvas.
//
// Lifted verbatim from rl-hub-versus.js so the module split stays behaviour-free.
// Plan 2 replaces these internals with the tactical field renderer.

import { playerPositions } from './state.js';

export function playerPositionsCard(team) {
  const label = team === 'blue' ? 'BLUE POSITIONS' : 'ORANGE POSITIONS';
  return `<div class="vsb-posmap-card">
    <div class="vsb-poss-title">${label}</div>
    <canvas id="vsb-posmap-canvas-${team}" class="vsb-posmap-canvas" width="200" height="160"></canvas>
  </div>`;
}

export function drawPlayerPositions() {
  _drawTeamPositions('blue');
  _drawTeamPositions('orange');
}

function _drawTeamPositions(team) {
  const canvas = document.getElementById(`vsb-posmap-canvas-${team}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Tinted field background for this team
  ctx.fillStyle = team === 'blue' ? 'rgba(59,130,246,.06)' : 'rgba(249,115,22,.06)';
  ctx.fillRect(2, 2, W - 4, H - 4);

  // Field outline
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // Midfield line (vertical; blue half on left)
  ctx.beginPath();
  ctx.moveTo(W / 2, 2);
  ctx.lineTo(W / 2, H - 2);
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.stroke();

  const COLORS = team === 'blue'
    ? ['rgba(59,130,246,.65)', 'rgba(96,165,250,.65)', 'rgba(147,197,253,.65)']
    : ['rgba(249,115,22,.65)', 'rgba(251,146,60,.65)', 'rgba(253,186,116,.65)'];
  let colorIdx = 0;

  for (const positions of Object.values(playerPositions())) {
    if (!positions.length || positions[0].team !== team) continue;
    const color = COLORS[colorIdx++ % COLORS.length];
    for (const pos of positions) {
      // RL Y (field length, -5120 to +5120): high Y = blue goal → left of canvas
      const cx = 2 + ((5120 - pos.y) / 10240) * (W - 4);
      // RL X (field width, -4096 to +4096) → vertical axis
      const cy = 2 + ((pos.x + 4096) / 8192) * (H - 4);
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
}
