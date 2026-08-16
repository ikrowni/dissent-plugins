import { describe, it, expect } from 'vitest';
import { screenState, centreShowsStream, centreShowsMatchHero, STATES, STALE_AFTER_MS } from './screenstate.js';

const live = { players: [{ name: 'a' }], time: 120 };

describe('screenState', () => {
  it('reports no broadcast when nobody is sending to the channel', () => {
    expect(screenState({ isBroadcasting: false })).toBe(STATES.NO_BROADCAST);
  });

  it('reports game closed when someone is broadcasting but no match is running', () => {
    expect(screenState({ isBroadcasting: true, gameState: null })).toBe(STATES.GAME_CLOSED);
  });

  it('reports pre-match when a game exists with no players yet', () => {
    expect(screenState({ isBroadcasting: true, gameState: { players: [] } })).toBe(STATES.PRE_MATCH);
  });

  it('reports live during normal play', () => {
    expect(screenState({ isBroadcasting: true, gameState: live })).toBe(STATES.LIVE);
  });

  it('reports replay when the replay flag is set', () => {
    expect(screenState({ isBroadcasting: true, gameState: { ...live, is_replay: true } }))
      .toBe(STATES.REPLAY);
  });

  it('reports ended when a winner exists', () => {
    expect(screenState({ isBroadcasting: true, gameState: { ...live, has_winner: true } }))
      .toBe(STATES.ENDED);
  });

  it('reports stale past the threshold', () => {
    expect(screenState({ isBroadcasting: true, gameState: live, msSinceFrame: STALE_AFTER_MS + 1 }))
      .toBe(STATES.STALE);
  });

  it('stays live just under the threshold', () => {
    expect(screenState({ isBroadcasting: true, gameState: live, msSinceFrame: STALE_AFTER_MS - 1 }))
      .toBe(STATES.LIVE);
  });

  it('prefers ended over replay', () => {
    expect(screenState({ isBroadcasting: true, gameState: { ...live, is_replay: true, has_winner: true } }))
      .toBe(STATES.ENDED);
  });

  it('prefers ended over stale — a finished match is not a broken feed', () => {
    expect(screenState({ isBroadcasting: true, gameState: { ...live, has_winner: true }, msSinceFrame: 99999 }))
      .toBe(STATES.ENDED);
  });

  it('prefers stale over live', () => {
    expect(screenState({ isBroadcasting: true, gameState: live, msSinceFrame: 99999 }))
      .toBe(STATES.STALE);
  });
});

describe('centre band selection', () => {
  it('shows the stream when live with a twitch username', () => {
    expect(centreShowsStream(STATES.LIVE, 'someone')).toBe(true);
    expect(centreShowsMatchHero(STATES.LIVE, 'someone')).toBe(false);
  });

  it('shows the match hero when live without one', () => {
    expect(centreShowsMatchHero(STATES.LIVE, '')).toBe(true);
    expect(centreShowsStream(STATES.LIVE, '')).toBe(false);
  });

  it('keeps the stream during a replay', () => {
    expect(centreShowsStream(STATES.REPLAY, 'someone')).toBe(true);
  });

  it('shows neither in a non-live state, so the empty state owns the centre', () => {
    for (const s of [STATES.NO_BROADCAST, STATES.GAME_CLOSED, STATES.PRE_MATCH, STATES.ENDED, STATES.STALE]) {
      expect(centreShowsStream(s, 'someone')).toBe(false);
      expect(centreShowsMatchHero(s, '')).toBe(false);
    }
  });
});
