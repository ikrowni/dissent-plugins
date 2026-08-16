// @vitest-environment jsdom
// ^ importing the orchestrator pulls in versus/stream.js, which assigns
//   window.watchTwitch at module scope. Without jsdom that throws on import.
//
// WHY THIS EXISTS. rl-hub-main.js imports eighteen names from rl-hub-versus.js. The module
// split moved every one of their implementations into versus/*, so the surface is now held
// together by re-export lines. Drop one and nothing fails until the plugin runs in a
// browser — no unit test touches those imports, and a missing export presents as a dead
// feature rather than an error anyone sees.
import { describe, it, expect } from 'vitest';
import * as versus from '../rl-hub-versus.js';

const REQUIRED = [
  'initVersus', 'showVersus', 'hideVersus', 'refreshVersus', 'resetMatchState',
  'setModeSlots', 'setOnHideCallback', 'setTwitchStreamer',
  'addFeedEvent', 'addBallHit', 'applyTeamColors',
  'formatTime', 'formatBallSpeed', 'ballSpeedColor',
  'calcPossessionFromTouches', 'calcOffDef', 'calcShotAcc', 'normalizeBarPct',
];

describe('rl-hub-versus public API', () => {
  it.each(REQUIRED)('still exports %s as a function', (name) => {
    expect(typeof versus[name]).toBe('function');
  });

  it('exports every name rl-hub-main.js imports', () => {
    expect(REQUIRED.every((n) => typeof versus[n] === 'function')).toBe(true);
  });
});
