// rl-hub-versus.js — Broadcast versus panel
import { esc, mediaEmbed, getInitContext } from '../plugin-sdk.js';
import { addBallHitPoint, restoreOverlayState, resetOverlayState } from './rl-hub-versus-overlay.js';
import {
  formatTime, calcPossessionFromTouches, calcOffDef, calcShotAcc,
  normalizeBarPct, formatBallSpeed, ballSpeedColor,
} from './versus/calc.js';
import * as state from './versus/state.js';

// Re-exported so rl-hub-main.js and the existing suite keep importing these from here.
// The public surface of this module must not change across the split.
export {
  formatTime, calcPossessionFromTouches, calcOffDef, calcShotAcc,
  normalizeBarPct, formatBallSpeed, ballSpeedColor,
} from './versus/calc.js';

// ── Module state ──────────────────────────────────────────────────────────────

let _onHide = null;
export function setOnHideCallback(fn) { _onHide = fn; }
export function setTwitchStreamer(username) { _twitchUsername = username ?? ''; }

let _currentSenderId = null;
let _currentGameState = null;
let _shownAt = 0;
let _stalenessTimer = null;
let _expectedSlots  = 1;                            // set by active mode tab

let _twitchUsername = '';

// ── Public API ────────────────────────────────────────────────────────────────

export function initVersus() {
  _renderIdle();
}

export function setModeSlots(n) {
  _expectedSlots = n ?? 1;
  if (!_currentGameState) _renderIdle();
}

export function showVersus(senderId, gameState) {
  _currentSenderId = senderId;
  _currentGameState = gameState;
  _shownAt = Date.now();
  if (gameState.ball?.team_num === 0) state.bumpBallTouch('blue');
  else if (gameState.ball?.team_num === 1) state.bumpBallTouch('orange');
  _render(gameState);
}

export function resetMatchState() {
  state.resetAll();
  resetOverlayState();
}

export function hideVersus() {
  _stopStaleness();
  _currentSenderId  = null;
  _currentGameState = null;
  state.resetAll();
  _onHide?.();
  applyTeamColors({
    blue:   { color_primary: '1a6fdb', color_secondary: '60a5fa' },
    orange: { color_primary: 'f97316', color_secondary: 'fb923c' },
  });
  _renderIdle();
}

export function addFeedEvent({ event_name, player_name, team_num, victim_name, victim_team }) {
  const side = team_num === 0 ? 'blue' : 'orange';

  if (event_name === 'Demolition' || event_name === 'Demolish') {
    state.bumpDemo(player_name);
    state.pushDemoFeed({
      attacker: player_name, attacker_team: side,
      victim: victim_name ?? '?', victim_team: victim_team === 0 ? 'blue' : 'orange',
      ts: Date.now(),
    });
    _updateDemoFeed();
  }

  const GOAL_EVENTS = ['Goal', 'Aerial Goal', 'Bicycle Kick Goal'];
  if (GOAL_EVENTS.includes(event_name)) {
    state.setLastGoal(side, { scorer: player_name, time: _currentGameState?.time ?? null });
  }

  const TICKER_EVENTS = ['Goal', 'Aerial Goal', 'Bicycle Kick Goal', 'Save', 'Epic Save', 'Demolition', 'Demolish', 'Assist'];
  if (TICKER_EVENTS.includes(event_name)) {
    state.pushTicker({ event_name, player_name, team: side, ts: Date.now() });
    _updateTicker();
  }

  if (_currentGameState) { _render(_currentGameState); restoreOverlayState(); _drawPlayerPositions(); }
}

export function refreshVersus(liveGames) {
  const keys = Object.keys(liveGames);

  if (!_currentSenderId) {
    if (keys.length === 0) { _renderIdle(); return; }
    _currentSenderId = keys[0];
  }

  const entry = liveGames[_currentSenderId];
  if (!entry) {
    _currentSenderId = keys[0] ?? null;
    if (!_currentSenderId) { _stopStaleness(); _renderIdle(); return; }
  }

  const e = liveGames[_currentSenderId];
  // Collect player positions for heatmap
  for (const p of (e.gameState.players ?? [])) {
    if (!p.location) continue;
    state.pushPosition(p.name, p.location.x, p.location.y, p.team);
  }
  _currentGameState = e.gameState;
  _shownAt = e.receivedAt;
  if (e.gameState.ball?.team_num === 0) state.bumpBallTouch('blue');
  else if (e.gameState.ball?.team_num === 1) state.bumpBallTouch('orange');
  _render(e.gameState);
  restoreOverlayState();
  _drawPlayerPositions();
}

export function addBallHit(data) {
  addBallHitPoint(data);
}

export function applyTeamColors(teams) {
  const root = document.documentElement;
  const b = teams?.blue;
  const o = teams?.orange;
  if (b?.color_primary)   root.style.setProperty('--rl-blue',        `#${b.color_primary}`);
  if (b?.color_secondary) root.style.setProperty('--rl-blue-accent',  `#${b.color_secondary}`);
  if (o?.color_primary)   root.style.setProperty('--rl-orange',       `#${o.color_primary}`);
  if (o?.color_secondary) root.style.setProperty('--rl-orange-accent', `#${o.color_secondary}`);
}

function _updateTicker() {
  const el = document.getElementById('vsb-ticker');
  if (!el) return;
  if (state.tickerEvents().length === 0) {
    el.innerHTML = '<div class="vsb-demo-empty">No events yet</div>';
    return;
  }
  el.innerHTML = state.tickerEvents().map(e => {
    const icon = _tickerIcon(e.event_name);
    return `<div class="vsb-tick-row ${e.team}">
      <span class="vsb-tick-ico">${icon}</span>
      <span class="vsb-tick-name">${esc(e.player_name)}</span>
      <span class="vsb-tick-evt">${esc(e.event_name)}</span>
    </div>`;
  }).join('');
}

function _updateDemoFeed() {
  const el = document.getElementById('vsb-demo-feed');
  if (!el) return;
  el.innerHTML = state.demoFeed().map(d =>
    `<div class="vsb-demo-row">
      <span class="vsb-demo-name ${d.attacker_team}">${esc(d.attacker)}</span>
      <span class="vsb-demo-arrow">💥</span>
      <span class="vsb-demo-name ${d.victim_team}">${esc(d.victim)}</span>
    </div>`
  ).join('') || `<div class="vsb-demo-empty">No demos yet</div>`;
}

function _tickerIcon(eventName) {
  const map = {
    'Goal': '⚽', 'Aerial Goal': '🚀', 'Bicycle Kick Goal': '🚲',
    'Save': '🛡', 'Epic Save': '🦅', 'Demolition': '💥', 'Demolish': '💥', 'Assist': '🤝',
  };
  return map[eventName] ?? '📊';
}

function _twitchCard() {
  if (!_twitchUsername) {
    return `<div class="vsb-twitch-card vsb-twitch-idle">
      <span class="vsb-twitch-ico">📺</span>
      <span class="vsb-twitch-hint">Add your Twitch username in ⚙️ settings to enable the stream viewer</span>
    </div>`;
  }
  const safeUser = esc(_twitchUsername);
  return `<div class="vsb-heatmap-card vsb-twitch-outer" onclick="watchTwitch('${safeUser}')" role="button" title="Watch ${safeUser} on Twitch">
    <div class="vsb-twitch-screen">
      <div class="vsb-twitch-screen-center">
        <div class="vsb-twitch-playbtn">&#9654;</div>
      </div>
      <div class="vsb-twitch-bar">
        <span class="vsb-twitch-bar-icon">&#9654;</span>
        <span class="vsb-twitch-bar-icon">&#128266;</span>
        <div class="vsb-twitch-scrubber">
          <div class="vsb-twitch-track"></div>
          <div class="vsb-twitch-dot"></div>
        </div>
        <span class="vsb-twitch-bar-icon">&#x26F6;</span>
      </div>
    </div>
  </div>`;
}

function _playerPositionsCard(team) {
  const label = team === 'blue' ? 'BLUE POSITIONS' : 'ORANGE POSITIONS';
  return `<div class="vsb-posmap-card">
    <div class="vsb-poss-title">${label}</div>
    <canvas id="vsb-posmap-canvas-${team}" class="vsb-posmap-canvas" width="200" height="160"></canvas>
  </div>`;
}

function _drawPlayerPositions() {
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

  for (const positions of Object.values(state.playerPositions())) {
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

function _barChart(players, team) {
  const sum   = k => players.reduce((s, p) => s + (p[k] ?? 0), 0);
  const demos = players.reduce((s, p) => s + (state.demoCounts()[p.name] ?? 0), 0);

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

function _timerCard(gs) {
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

function _timerCardIdle() {
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

function _ballSpeedCard(gs) {
  const kmh = formatBallSpeed(gs?.ball?.speed ?? 0);
  const cls = ballSpeedColor(kmh);
  return `<div class="vsb-ball-speed-card">
    <div class="vsb-poss-title">BALL SPEED</div>
    <div class="vsb-ball-speed-num ${cls}">${kmh} <span class="vsb-ball-speed-unit">km/h</span></div>
  </div>`;
}

function _possessionCard() {
  const { blue: bPct, orange: oPct } = calcPossessionFromTouches(state.ballTouches().blue, state.ballTouches().orange);
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

function _balanceCard(players, team) {
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

function _lastGoalCard(side, team) {
  const g     = state.lastGoals()[side];
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

// ── Player card ───────────────────────────────────────────────────────────────

function _playerCard(p, team, slotIndex = 0) {
  const demo     = p?.demolished ?? false;
  const ss       = p?.supersonic ?? false;
  const boostPct = demo ? 0 : Math.min(100, Math.max(0, Math.round(p?.boost ?? 0)));
  const demos    = p ? (state.demoCounts()[p.name] ?? 0) : 0;
  const mbr      = p?.is_member ?? false;

  const cardCls = ['vsb-pcard', team, demo ? 'demo' : '', ss ? 'ss' : ''].filter(Boolean).join(' ');
  const slotLabel = `PLAYER ${slotIndex + 1}`;

  const header = !p
    ? `<div class="vsb-pcard-slot ${team}">${slotLabel}</div><div class="vsb-pcard-header"><span class="vsb-pname empty">—</span></div>`
    : `<div class="vsb-pcard-slot ${team}">${slotLabel}</div><div class="vsb-pcard-header">
        <span class="vsb-pname${mbr ? ' member' : ''}">${esc(p.name ?? '?')}</span>
        <span class="vsb-pscore">${p.score ?? 0}</span>
      </div>`;

  const badges = [
    p?.on_wall       ? `<span class="vsb-badge vsb-badge-wall">🧗 WALL</span>`   : '',
    p?.powersliding  ? `<span class="vsb-badge vsb-badge-slide">🌀 SLIDE</span>` : '',
  ].filter(Boolean).join('');
  const badgeRow = badges ? `<div class="vsb-badge-row">${badges}</div>` : '';

  const speedKmh = p ? Math.round((p.speed ?? 0) / 100 * 3.6) : 0;
  const speedRow = p ? `<div class="vsb-speed-row">
  <span class="vsb-speed-label${p?.supersonic ? ' active' : ''}">SPEED</span>
  <span class="vsb-speed-val">${speedKmh} <span class="vsb-speed-unit">km/h</span></span>
</div>` : '';

  const STATS = [
    { ico: '⚽', lbl: 'Goals',  val: p?.goals   ?? 0 },
    { ico: '🤝', lbl: 'Ast',    val: p?.assists  ?? 0 },
    { ico: '🛡', lbl: 'Saves',  val: p?.saves    ?? 0 },
    { ico: '🎯', lbl: 'Shots',  val: p?.shots    ?? 0 },
    { ico: '💥', lbl: 'Demos',  val: demos             },
    { ico: '🏐', lbl: 'Touch',  val: p?.touches  ?? 0 },
  ];
  const icons = STATS.map(s =>
    `<div class="vsb-si"><span class="vsb-si-ico">${s.ico}</span><span class="vsb-si-val">${s.val}</span><span class="vsb-si-lbl">${s.lbl}</span></div>`
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

// ── Render idle (no live match) ───────────────────────────────────────────────

function _renderIdle() {
  const panel = document.getElementById('versus-panel');
  if (!panel) return;

  const emptyCards = Array.from({ length: _expectedSlots }, () => '');
  const bIdle = emptyCards.map((_, i) => _playerCard(null, 'blue', i)).join('');
  const oIdle = emptyCards.map((_, i) => _playerCard(null, 'orange', i)).join('');

  panel.innerHTML = `<div class="vsb-root">
    <div class="vsb-broadcast">
      <img class="vsb-team-banner" src="https://app.dissent.chat/plugins/rl-hub/blue-team.png" alt="Blue Team">
      ${_timerCardIdle()}
      <img class="vsb-team-banner" src="https://app.dissent.chat/plugins/rl-hub/red-team.png" alt="Orange Team">
      <div class="vsb-players-col">${bIdle}${_barChart([], 'blue')}${_balanceCard([], 'blue')}${_lastGoalCard('blue', 'blue')}${_playerPositionsCard('blue')}</div>
      <div class="vsb-center-stats">
        ${_ballSpeedCard(null)}
        ${_possessionCard()}
        <div class="vsb-tl-card">
          <div class="vsb-poss-title">GOAL TIMELINE</div>
          <div class="vsb-tl-track">
            <div id="vsb-goal-timeline"></div>
          </div>
        </div>
        ${_twitchCard()}
        <div class="vsb-demo-card">
          <div class="vsb-poss-title">DEMOLITIONS</div>
          <div id="vsb-demo-feed"><div class="vsb-demo-empty">No demos yet</div></div>
        </div>
        <div class="vsb-ticker-card">
          <div class="vsb-poss-title">MATCH FEED</div>
          <div id="vsb-ticker"><div class="vsb-demo-empty">No events yet</div></div>
        </div>
        <div class="vsb-heatmap-card">
          <div class="vsb-poss-title">BALL HIT MAP</div>
          <canvas id="vsb-heatmap-canvas" class="vsb-heatmap-canvas" width="200" height="160"></canvas>
        </div>
      </div>
      <div class="vsb-players-col">${oIdle}${_barChart([], 'orange')}${_balanceCard([], 'orange')}${_lastGoalCard('orange', 'orange')}${_playerPositionsCard('orange')}</div>
    </div>
    <div class="vs-staleness" id="vs-staleness-footer">Waiting for a live match…</div>
  </div>`;
}

// ── Render live game ──────────────────────────────────────────────────────────

function _render(gs) {
  applyTeamColors(gs.teams);

  const panel = document.getElementById('versus-panel');
  if (!panel) return;

  const bPlayers = (gs.players ?? []).filter(p => p.team === 'blue');
  const oPlayers = (gs.players ?? []).filter(p => p.team === 'orange');
  const slots    = Math.max(bPlayers.length, oPlayers.length, _expectedSlots, 1);

  const bCards = Array.from({ length: slots }, (_, i) => _playerCard(bPlayers[i] ?? null, 'blue', i)).join('');
  const oCards = Array.from({ length: slots }, (_, i) => _playerCard(oPlayers[i] ?? null, 'orange', i)).join('');

  panel.innerHTML = `<div class="vsb-root">
    <div class="vsb-broadcast">
      <img class="vsb-team-banner" src="https://app.dissent.chat/plugins/rl-hub/blue-team.png" alt="Blue Team">
      ${_timerCard(gs)}
      <img class="vsb-team-banner" src="https://app.dissent.chat/plugins/rl-hub/red-team.png" alt="Orange Team">
      <div class="vsb-players-col">${bCards}${_barChart(bPlayers, 'blue')}${_balanceCard(bPlayers, 'blue')}${_lastGoalCard('blue', 'blue')}${_playerPositionsCard('blue')}</div>
      <div class="vsb-center-stats">
        ${_ballSpeedCard(gs)}
        ${_possessionCard()}
        <div class="vsb-tl-card">
          <div class="vsb-poss-title">GOAL TIMELINE</div>
          <div class="vsb-tl-track">
            <div id="vsb-goal-timeline"></div>
          </div>
        </div>
        ${_twitchCard()}
        <div class="vsb-demo-card">
          <div class="vsb-poss-title">DEMOLITIONS</div>
          <div id="vsb-demo-feed"><div class="vsb-demo-empty">No demos yet</div></div>
        </div>
        <div class="vsb-ticker-card">
          <div class="vsb-poss-title">MATCH FEED</div>
          <div id="vsb-ticker"><div class="vsb-demo-empty">No events yet</div></div>
        </div>
        <div class="vsb-heatmap-card">
          <div class="vsb-poss-title">BALL HIT MAP</div>
          <canvas id="vsb-heatmap-canvas" class="vsb-heatmap-canvas" width="200" height="160"></canvas>
        </div>
      </div>
      <div class="vsb-players-col">${oCards}${_barChart(oPlayers, 'orange')}${_balanceCard(oPlayers, 'orange')}${_lastGoalCard('orange', 'orange')}${_playerPositionsCard('orange')}</div>
    </div>
    <div class="vs-staleness" id="vs-staleness-footer">Updated just now</div>
  </div>`;

  _updateTicker();
  _updateDemoFeed();
  _startStaleness();
}

// ── Staleness ticker ──────────────────────────────────────────────────────────

function _startStaleness() {
  _stopStaleness();
  _stalenessTimer = setInterval(() => {
    const el = document.getElementById('vs-staleness-footer');
    if (!el) return;
    const ago = Math.floor((Date.now() - _shownAt) / 1000);
    if (ago < 2) {
      el.textContent = 'Updated just now';
      el.classList.remove('stale');
    } else {
      el.textContent = `Updated ${ago}s ago`;
      el.classList.toggle('stale', ago >= 8);
    }
  }, 1_000);
}

function _stopStaleness() {
  if (_stalenessTimer) { clearInterval(_stalenessTimer); _stalenessTimer = null; }
}

window.watchTwitch = (username) => {
  // parent= must be the raw hostname of the embedding app (Twitch requirement).
  const parent = getInitContext()?.hostHostname || 'app.dissent.chat';
  mediaEmbed(
    `https://player.twitch.tv/?channel=${encodeURIComponent(username)}&parent=${parent}&muted=false&autoplay=true`,
    `${username} on Twitch`,
  );
};
