// rl-hub-versus.js — Broadcast versus panel
import { addBallHitPoint, restoreOverlayState, resetOverlayState } from './rl-hub-versus-overlay.js';
import * as state from './versus/state.js';
import { updateTicker, updateDemoFeed } from './versus/feed.js';
import { twitchCard } from './versus/stream.js';
import { barChart, ballSpeedCard, possessionCard, balanceCard, lastGoalCard } from './versus/panels.js';
import { applyTeamColors, timerCard, timerCardIdle } from './versus/scoreboard.js';
import { playerCard } from './versus/playercard.js';
import { playerPositionsCard, drawPlayerPositions } from './versus/field.js';

// Re-exported so rl-hub-main.js and the existing suite keep importing these from here.
// The public surface of this module must not change across the split.
export {
  formatTime, calcPossessionFromTouches, calcOffDef, calcShotAcc,
  normalizeBarPct, formatBallSpeed, ballSpeedColor,
} from './versus/calc.js';
export { setTwitchStreamer } from './versus/stream.js';
export { applyTeamColors } from './versus/scoreboard.js';

// ── Module state ──────────────────────────────────────────────────────────────

let _onHide = null;
export function setOnHideCallback(fn) { _onHide = fn; }

let _currentSenderId = null;
let _currentGameState = null;
let _shownAt = 0;
let _stalenessTimer = null;
let _expectedSlots  = 1;                            // set by active mode tab

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
    updateDemoFeed();
  }

  const GOAL_EVENTS = ['Goal', 'Aerial Goal', 'Bicycle Kick Goal'];
  if (GOAL_EVENTS.includes(event_name)) {
    state.setLastGoal(side, { scorer: player_name, time: _currentGameState?.time ?? null });
  }

  const TICKER_EVENTS = ['Goal', 'Aerial Goal', 'Bicycle Kick Goal', 'Save', 'Epic Save', 'Demolition', 'Demolish', 'Assist'];
  if (TICKER_EVENTS.includes(event_name)) {
    state.pushTicker({ event_name, player_name, team: side, ts: Date.now() });
    updateTicker();
  }

  if (_currentGameState) { _render(_currentGameState); restoreOverlayState(); drawPlayerPositions(); }
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
  drawPlayerPositions();
}

export function addBallHit(data) {
  addBallHitPoint(data);
}

// ── Render idle (no live match) ───────────────────────────────────────────────

function _renderIdle() {
  const panel = document.getElementById('versus-panel');
  if (!panel) return;

  const emptyCards = Array.from({ length: _expectedSlots }, () => '');
  const bIdle = emptyCards.map((_, i) => playerCard(null, 'blue', i)).join('');
  const oIdle = emptyCards.map((_, i) => playerCard(null, 'orange', i)).join('');

  panel.innerHTML = `<div class="vsb-root">
    <div class="vsb-broadcast">
      <img class="vsb-team-banner" src="https://app.dissent.chat/plugins/rl-hub/blue-team.png" alt="Blue Team">
      ${timerCardIdle()}
      <img class="vsb-team-banner" src="https://app.dissent.chat/plugins/rl-hub/red-team.png" alt="Orange Team">
      <div class="vsb-players-col">${bIdle}${barChart([], 'blue')}${balanceCard([], 'blue')}${lastGoalCard('blue', 'blue')}${playerPositionsCard('blue')}</div>
      <div class="vsb-center-stats">
        ${ballSpeedCard(null)}
        ${possessionCard()}
        <div class="vsb-tl-card">
          <div class="vsb-poss-title">GOAL TIMELINE</div>
          <div class="vsb-tl-track">
            <div id="vsb-goal-timeline"></div>
          </div>
        </div>
        ${twitchCard()}
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
      <div class="vsb-players-col">${oIdle}${barChart([], 'orange')}${balanceCard([], 'orange')}${lastGoalCard('orange', 'orange')}${playerPositionsCard('orange')}</div>
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

  const bCards = Array.from({ length: slots }, (_, i) => playerCard(bPlayers[i] ?? null, 'blue', i)).join('');
  const oCards = Array.from({ length: slots }, (_, i) => playerCard(oPlayers[i] ?? null, 'orange', i)).join('');

  panel.innerHTML = `<div class="vsb-root">
    <div class="vsb-broadcast">
      <img class="vsb-team-banner" src="https://app.dissent.chat/plugins/rl-hub/blue-team.png" alt="Blue Team">
      ${timerCard(gs)}
      <img class="vsb-team-banner" src="https://app.dissent.chat/plugins/rl-hub/red-team.png" alt="Orange Team">
      <div class="vsb-players-col">${bCards}${barChart(bPlayers, 'blue')}${balanceCard(bPlayers, 'blue')}${lastGoalCard('blue', 'blue')}${playerPositionsCard('blue')}</div>
      <div class="vsb-center-stats">
        ${ballSpeedCard(gs)}
        ${possessionCard()}
        <div class="vsb-tl-card">
          <div class="vsb-poss-title">GOAL TIMELINE</div>
          <div class="vsb-tl-track">
            <div id="vsb-goal-timeline"></div>
          </div>
        </div>
        ${twitchCard()}
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
      <div class="vsb-players-col">${oCards}${barChart(oPlayers, 'orange')}${balanceCard(oPlayers, 'orange')}${lastGoalCard('orange', 'orange')}${playerPositionsCard('orange')}</div>
    </div>
    <div class="vs-staleness" id="vs-staleness-footer">Updated just now</div>
  </div>`;

  updateTicker();
  updateDemoFeed();
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

