// rl-hub-versus-overlay.js — transient overlays: goal card, crossbar alert, paused banner

// ── State ─────────────────────────────────────────────────────────────────────

let _fastestGoal = null;   // { scorer, scorer_team, goal_speed, assister, match_time }
let _goalTimeline = [];    // Array<{ scorer, scorer_team, match_time }>
let _overlayTimer = null;

const MAX_HIT_POINTS = 200;
let _hitPoints = [];  // Array<{ x, y, team }>

// ── Exports ───────────────────────────────────────────────────────────────────

export function resetOverlayState() {
  _fastestGoal  = null;
  _goalTimeline = [];
  _hitPoints    = [];
  if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
  _clearOverlay();
  _drawHeatmap();
}

export function addBallHitPoint(data) {
  // data: { location: { X, Y, Z }, team_num }
  const loc = data.location ?? {};
  _hitPoints.push({ x: loc.X ?? 0, y: loc.Y ?? 0, team: data.team_num ?? 0 });
  if (_hitPoints.length > MAX_HIT_POINTS) _hitPoints.shift();
  // Don't redraw here — restoreOverlayState() redraws after each render (every ~1s)
}

export function getHitPoints() {
  return _hitPoints.slice();
}

export function formatGoalSpeed(kmh) {
  return Math.round(kmh);
}

export function getFastestGoal() {
  return _fastestGoal;
}

export function addGoalEvent(data) {
  // { scorer, scorer_team, goal_speed, assister, match_time, ts }
  const { scorer, scorer_team, goal_speed, assister, match_time } = data;

  _goalTimeline.push({ scorer, scorer_team, match_time });

  if (!_fastestGoal || goal_speed > _fastestGoal.goal_speed) {
    _fastestGoal = { scorer, scorer_team, goal_speed, assister, match_time };
  }

  _showGoalCard(data);
  _updateGoalTimeline();
  _updateFastestGoal();
}

export function showCrossbarAlert(data) {
  // { ball_speed, last_toucher, last_toucher_team }
  // CrossbarHit.BallSpeed is in cm/s; divide by 100 then multiply by 3.6 to get km/h
  const kmh = Math.round((data.ball_speed ?? 0) / 100 * 3.6);
  _showOverlay(`<div class="vsb-overlay-crossbar">
    <div class="vsb-overlay-title">💥 CROSSBAR!</div>
    <div class="vsb-overlay-sub">${esc(data.last_toucher ?? '?')} · ${kmh} km/h</div>
  </div>`, 2500);
}

export function setPaused(paused) {
  const el = document.getElementById('vsb-paused-overlay');
  if (!el) return;
  el.classList.toggle('hidden', !paused);
}

export function restoreOverlayState() {
  _updateGoalTimeline();
  _updateFastestGoal();
  _drawHeatmap();
}

// ── Internals ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _showGoalCard(data) {
  const { scorer, scorer_team, goal_speed, assister } = data;
  const kmh      = formatGoalSpeed(goal_speed ?? 0);
  const teamCls  = scorer_team === 0 ? 'blue' : 'orange';
  const teamName = scorer_team === 0 ? 'BLUE' : 'ORANGE';
  const assistHtml = assister
    ? `<div class="vsb-overlay-assist">Assist: ${esc(assister)}</div>`
    : '';

  _showOverlay(`<div class="vsb-overlay-goal ${teamCls}">
    <div class="vsb-overlay-team">${teamName} GOAL</div>
    <div class="vsb-overlay-scorer">${esc(scorer)}</div>
    ${assistHtml}
    <div class="vsb-overlay-speed">${kmh} <span class="vsb-overlay-unit">km/h</span></div>
  </div>`, 4000);
}

function _showOverlay(html, durationMs) {
  const el = document.getElementById('vsb-flash-overlay');
  if (!el) return;
  if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
  el.innerHTML = html;
  el.classList.remove('hidden');
  _overlayTimer = setTimeout(() => { el.classList.add('hidden'); el.innerHTML = ''; }, durationMs);
}

function _clearOverlay() {
  const el = document.getElementById('vsb-flash-overlay');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

function _updateGoalTimeline() {
  const el = document.getElementById('vsb-goal-timeline');
  if (!el) return;
  const MATCH_DURATION = 300; // seconds
  const marks = _goalTimeline.map(g => {
    const pct = Math.max(0, Math.min(100, Math.round((1 - g.match_time / MATCH_DURATION) * 100)));
    const cls = g.scorer_team === 0 ? 'blue' : 'orange';
    return `<div class="vsb-tl-mark ${cls}" style="left:${pct}%" title="${esc(g.scorer)}"></div>`;
  }).join('');
  el.innerHTML = marks;
}

function _updateFastestGoal() {
  const el = document.getElementById('vsb-fastest-goal');
  if (!el || !_fastestGoal) return;
  const kmh     = formatGoalSpeed(_fastestGoal.goal_speed);
  const teamCls = _fastestGoal.scorer_team === 0 ? 'blue' : 'orange';
  el.innerHTML = `<span class="vsb-fg-label">FASTEST GOAL</span>
    <span class="vsb-fg-name ${teamCls}">${esc(_fastestGoal.scorer)}</span>
    <span class="vsb-fg-speed">${kmh} km/h</span>`;
}

function _drawHeatmap() {
  const canvas = document.getElementById('vsb-heatmap-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;   // 200
  const H = canvas.height;  // 160

  ctx.clearRect(0, 0, W, H);

  // Team half backgrounds (blue left, orange right)
  ctx.fillStyle = 'rgba(59,130,246,.06)';
  ctx.fillRect(2, 2, W / 2 - 2, H - 4);
  ctx.fillStyle = 'rgba(249,115,22,.06)';
  ctx.fillRect(W / 2, 2, W / 2 - 2, H - 4);

  // Field outline
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // Midfield line (vertical)
  ctx.beginPath();
  ctx.moveTo(W / 2, 2);
  ctx.lineTo(W / 2, H - 2);
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.stroke();

  // RL Y (-5120 to +5120) = field length → canvas X axis (high Y = blue goal = left)
  // RL X (-4096 to +4096) = field width  → canvas Y axis
  for (const p of _hitPoints) {
    const cx = 2 + ((5120 - p.y) / 10240) * (W - 4);
    const cy = 2 + ((p.x + 4096) / 8192) * (H - 4);
    const color = p.team === 0 ? 'rgba(59,130,246,.65)' : 'rgba(249,115,22,.65)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}
