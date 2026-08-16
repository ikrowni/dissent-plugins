// rl-hub-versus.js — Broadcast versus panel (orchestrator)
//
// Owns lifecycle and the single state-driven render. Everything it draws lives in versus/*.
//
// ⚠️ There is no field canvas. The Stats API carries no positional data — see
// docs/superpowers/specs/2026-08-16-rl-hub-versus-broadcast-redesign.md §4a. versus/field.js
// still exists and is unused by this layout, kept ready if positions ever arrive.
import { addBallHitPoint, restoreOverlayState, resetOverlayState } from './rl-hub-versus-overlay.js';
import * as state from './versus/state.js';
import { updateTicker, updateDemoFeed } from './versus/feed.js';
import { twitchCard, twitchUsername } from './versus/stream.js';
import { barChart, ballSpeedCard, possessionCard, balanceCard, lastGoalCard } from './versus/panels.js';
import { applyTeamColors, rootClassFor, statusBar, matchHero } from './versus/scoreboard.js';
import { playerCard } from './versus/playercard.js';
import {
  screenState, centreShowsStream, centreShowsMatchHero, STATES,
} from './versus/screenstate.js';
import { emptyState } from './versus/emptystates.js';

// Re-exported so rl-hub-main.js and the existing suite keep importing these from here.
// The public surface of this module must not change.
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
let _expectedSlots = 1;      // set by active mode tab
let _clientOnline = false;   // set from rl:companion:online

/// The desktop telemetry client has announced itself. Without this every screen would
/// render "Desktop app required", including for spectators watching someone else's match.
export function setClientOnline(v) {
  _clientOnline = Boolean(v);
  if (!_currentGameState) _render();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initVersus() {
  _render();
}

export function setModeSlots(n) {
  _expectedSlots = n ?? 1;
  if (!_currentGameState) _render();
}

export function showVersus(senderId, gameState) {
  _currentSenderId = senderId;
  _currentGameState = gameState;
  _shownAt = Date.now();
  _clientOnline = true;
  if (gameState.ball?.team_num === 0) state.bumpBallTouch('blue');
  else if (gameState.ball?.team_num === 1) state.bumpBallTouch('orange');
  _render();
}

export function resetMatchState() {
  state.resetAll();
  resetOverlayState();
}

export function hideVersus() {
  _stopStaleness();
  _currentSenderId = null;
  _currentGameState = null;
  state.resetAll();
  _onHide?.();
  applyTeamColors({
    blue:   { color_primary: '1a6fdb', color_secondary: '60a5fa' },
    orange: { color_primary: 'f97316', color_secondary: 'fb923c' },
  });
  _render();
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

  if (_currentGameState) { _render(); restoreOverlayState(); }
}

export function refreshVersus(liveGames) {
  const keys = Object.keys(liveGames);

  if (!_currentSenderId) {
    if (keys.length === 0) { _currentGameState = null; _render(); return; }
    _currentSenderId = keys[0];
  }

  const entry = liveGames[_currentSenderId];
  if (!entry) {
    _currentSenderId = keys[0] ?? null;
    if (!_currentSenderId) { _stopStaleness(); _currentGameState = null; _render(); return; }
  }

  const e = liveGames[_currentSenderId];
  if (state.shouldAccumulate(e.gameState)) {
    for (const p of (e.gameState.players ?? [])) {
      if (!p.location) continue;
      state.pushPosition(p.name, p.location.x, p.location.y, p.team);
    }
  }
  _currentGameState = e.gameState;
  _shownAt = e.receivedAt;
  _clientOnline = true;
  if (e.gameState.ball?.team_num === 0) state.bumpBallTouch('blue');
  else if (e.gameState.ball?.team_num === 1) state.bumpBallTouch('orange');
  _render();
  restoreOverlayState();
}

export function addBallHit(data) {
  addBallHitPoint(data);
}

// ── Render ────────────────────────────────────────────────────────────────────

/// Exposed for tests: which screen the current inputs resolve to.
export function currentScreenState() {
  return screenState({
    isBroadcasting: _clientOnline,
    gameState: _currentGameState,
    msSinceFrame: _shownAt ? Date.now() - _shownAt : 0,
  });
}

/// Hosts for rl-hub-versus-overlay.js, which finds these by id and bails silently if they
/// are absent. Dropping them in the 2026-08-16 layout rewrite killed goal cards, crossbar
/// alerts and the pause indicator with no error anywhere — see overlay-contract.test.js.
function _overlayHosts() {
  return `<div id="vsb-flash-overlay" class="vsb-flash-overlay hidden"></div>
    <div id="vsb-paused-overlay" class="vsb-paused-overlay hidden">Paused</div>`;
}

function _centre(st, gs) {
  if (centreShowsStream(st, twitchUsername())) return twitchCard();
  if (centreShowsMatchHero(st, twitchUsername())) return matchHero(gs);
  return emptyState(st);
}

function _rail(players, team, slots) {
  const cards = Array.from({ length: slots }, (_, i) => playerCard(players[i] ?? null, team, i)).join('');
  return `<div class="vsb-rail">${cards}${barChart(players, team)}${balanceCard(players, team)}</div>`;
}

function _render() {
  const panel = document.getElementById('versus-panel');
  if (!panel) return;

  const gs = _currentGameState;
  const st = currentScreenState();
  if (gs) applyTeamColors(gs.teams);

  const showsMatch = st === STATES.LIVE || st === STATES.REPLAY || st === STATES.ENDED;

  if (!showsMatch) {
    panel.innerHTML = `<div class="${rootClassFor(gs)}">
      ${_overlayHosts()}
      <div class="vsb-band-top">${statusBar(gs)}</div>
      <div class="vsb-band-centre-only">${emptyState(st)}</div>
    </div>`;
    _stopStaleness();
    return;
  }

  const bPlayers = (gs.players ?? []).filter(p => p.team === 'blue');
  const oPlayers = (gs.players ?? []).filter(p => p.team === 'orange');
  const slots = Math.max(bPlayers.length, oPlayers.length, _expectedSlots, 1);

  panel.innerHTML = `<div class="${rootClassFor(gs)}">
    ${_overlayHosts()}
    <div class="vsb-band-top">${statusBar(gs)}</div>
    <div class="vsb-band-mid">
      ${_rail(bPlayers, 'blue', slots)}
      <div class="vsb-centre">${_centre(st, gs)}</div>
      ${_rail(oPlayers, 'orange', slots)}
    </div>
    <div class="vsb-band-bottom">
      <div class="vsb-panel">${ballSpeedCard(gs)}</div>
      <div class="vsb-panel">${possessionCard()}</div>
      <div class="vsb-panel">
        <div class="vsb-panel-title">Match feed</div>
        <div id="vsb-ticker"><div class="vsb-demo-empty">No events yet</div></div>
      </div>
      <div class="vsb-panel">
        <div class="vsb-panel-title">Demolitions</div>
        <div id="vsb-demo-feed"><div class="vsb-demo-empty">No demos yet</div></div>
      </div>
      <div class="vsb-panel">
        <div class="vsb-panel-title">Goal timeline</div>
        <div class="vsb-tl-track"><div id="vsb-goal-timeline"></div></div>
      </div>
      <div class="vsb-panel">
        <div class="vsb-panel-title">Fastest goal</div>
        <div id="vsb-fastest-goal" class="vsb-fg"><span class="vsb-fg-label">None yet</span></div>
      </div>
      <div class="vsb-panel">${lastGoalCard('blue', 'blue')}</div>
      <div class="vsb-panel">${lastGoalCard('orange', 'orange')}</div>
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
