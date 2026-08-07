// @vitest-environment jsdom
// ^ these modules touch window/document at import time. Added 2026-08-07 when the
// repo gained a test runner; without it every test here dies on "window is not defined".
import { describe, it, expect, beforeEach } from 'vitest';
import { formatGoalSpeed, getFastestGoal, addGoalEvent, resetOverlayState, addBallHitPoint, getHitPoints } from './rl-hub-versus-overlay.js';

describe('formatGoalSpeed', () => {
  it('rounds a km/h value (input already in km/h from SOS)', () => expect(formatGoalSpeed(200)).toBe(200));
  it('converts 0 to 0',               () => expect(formatGoalSpeed(0)).toBe(0));
});

describe('ball hit accumulation', () => {
  beforeEach(() => resetOverlayState());

  it('stores hit location', () => {
    addBallHitPoint({ location: { X: 100, Y: 200, Z: 50 }, team_num: 0 });
    expect(getHitPoints().length).toBe(1);
    expect(getHitPoints()[0]).toEqual({ x: 100, y: 200, team: 0 });
  });

  it('caps at 200 points', () => {
    for (let i = 0; i < 250; i++) {
      addBallHitPoint({ location: { X: i, Y: i, Z: 0 }, team_num: 0 });
    }
    expect(getHitPoints().length).toBe(200);
  });

  it('clears on resetOverlayState', () => {
    addBallHitPoint({ location: { X: 0, Y: 0, Z: 0 }, team_num: 0 });
    resetOverlayState();
    expect(getHitPoints().length).toBe(0);
  });
});

describe('getFastestGoal', () => {
  beforeEach(() => resetOverlayState());

  it('returns null before any goals', () => expect(getFastestGoal()).toBeNull());

  it('tracks fastest goal after multiple goals', () => {
    addGoalEvent({ scorer: 'Alice', scorer_team: 0, goal_speed: 1500, assister: null, match_time: 200 });
    addGoalEvent({ scorer: 'Bob',   scorer_team: 1, goal_speed: 2200, assister: null, match_time: 150 });
    expect(getFastestGoal().scorer).toBe('Bob');
    expect(getFastestGoal().goal_speed).toBe(2200);
  });

  it('clears on resetOverlayState', () => {
    addGoalEvent({ scorer: 'Alice', scorer_team: 0, goal_speed: 1500, assister: null, match_time: 200 });
    resetOverlayState();
    expect(getFastestGoal()).toBeNull();
  });
});
