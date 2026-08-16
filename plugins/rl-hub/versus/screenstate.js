// versus/screenstate.js — which of the seven screens to render.
//
// WHY THIS EXISTS. The old versus screen had exactly two modes: "live" and "idle", where
// idle meant a full broadcast layout with every number rendered as 0. That reads as broken
// software rather than as an idle screen, and it was the single biggest reason the panel
// looked dead. Each state now gets its own treatment and none of them shows a zero.
//
// ⚠️ STALE cannot be derived from the live-games map. rl-hub-main.js DELETES an entry once
// it is older than LIVE_STALENESS_MS, so a stopped feed presents as "no game" rather than
// as a stale one. Callers must pass msSinceFrame from their own last-render timestamp.

export const STATES = {
  NO_CLIENT: 'no-client',
  GAME_CLOSED: 'game-closed',
  PRE_MATCH: 'pre-match',
  LIVE: 'live',
  REPLAY: 'replay',
  ENDED: 'ended',
  STALE: 'stale',
};

// Matches LIVE_STALENESS_MS in rl-hub-main.js. If that changes, change this.
export const STALE_AFTER_MS = 15000;

export function screenState({ hasClient, gameState, msSinceFrame = 0 }) {
  if (!hasClient) return STATES.NO_CLIENT;
  if (!gameState) return STATES.GAME_CLOSED;
  if (gameState.has_winner) return STATES.ENDED;
  if (msSinceFrame > STALE_AFTER_MS) return STATES.STALE;
  if (gameState.is_replay) return STATES.REPLAY;
  if (!gameState.players || gameState.players.length === 0) return STATES.PRE_MATCH;
  return STATES.LIVE;
}

/// True when the centre band should show the match hero rather than the stream card.
export function centreShowsStream(state, twitchUsername) {
  return (state === STATES.LIVE || state === STATES.REPLAY) && Boolean(twitchUsername);
}

export function centreShowsMatchHero(state, twitchUsername) {
  return (state === STATES.LIVE || state === STATES.REPLAY) && !twitchUsername;
}
