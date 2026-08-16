// versus/state.js — everything that accumulates across a match.
// Owns reset semantics so no other module has to remember the full list.
//
// Push directions are deliberate and match what the renderers expect:
//   ticker + demo feed  newest FIRST (unshift/pop) — they render top-down as a feed
//   player positions    newest LAST  (push/shift)  — it is a trail, drawn in order

export const MAX_TICKER_EVENTS = 4;
export const MAX_DEMO_FEED = 3;
export const MAX_PLAYER_POSITIONS = 400;

let _demoCounts = {};                            // { [playerName]: count }
let _lastGoals = { blue: null, orange: null };   // { scorer, time } | null
let _ballTouches = { blue: 0, orange: 0 };       // tick counts from ball.team_num
let _tickerEvents = [];                          // Array<{ event_name, player_name, team, ts }>
let _demoFeed = [];                              // Array<{ attacker, attacker_team, victim, victim_team, ts }>
let _playerPositions = {};                       // { [playerName]: Array<{ x, y, team }> }

export const demoCounts = () => _demoCounts;
export const lastGoals = () => _lastGoals;
export const ballTouches = () => _ballTouches;
export const tickerEvents = () => _tickerEvents;
export const demoFeed = () => _demoFeed;
export const playerPositions = () => _playerPositions;

export function bumpDemo(name) {
  _demoCounts[name] = (_demoCounts[name] ?? 0) + 1;
}

export function setLastGoal(side, goal) {
  _lastGoals[side] = goal;
}

export function bumpBallTouch(side) {
  _ballTouches[side]++;
}

export function pushTicker(entry) {
  _tickerEvents.unshift(entry);
  if (_tickerEvents.length > MAX_TICKER_EVENTS) _tickerEvents.pop();
}

export function pushDemoFeed(entry) {
  _demoFeed.unshift(entry);
  if (_demoFeed.length > MAX_DEMO_FEED) _demoFeed.pop();
}

export function pushPosition(name, x, y, team) {
  if (!_playerPositions[name]) _playerPositions[name] = [];
  _playerPositions[name].push({ x, y, team });
  if (_playerPositions[name].length > MAX_PLAYER_POSITIONS) _playerPositions[name].shift();
}

export function resetAll() {
  _demoCounts = {};
  _lastGoals = { blue: null, orange: null };
  _ballTouches = { blue: 0, orange: 0 };
  _tickerEvents = [];
  _demoFeed = [];
  _playerPositions = {};
}
