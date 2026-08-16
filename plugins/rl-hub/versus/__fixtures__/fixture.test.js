// Asserts the SHAPE of a real rl:live:update payload, captured mid-play from a live 1v1 on
// 2026-08-16. Player display names were replaced with placeholders; nothing else altered.
//
// ⚠️ THIS FRAME IS DELIBERATELY MID-PLAY, NOT PAUSED.
//
// The first capture was taken during a post-goal pause, where Rocket League stops the
// clock, resets the ball to stationary and untouched (team_num 255), and both cars sit
// still. Read on its own it looks like ball speed, player speed and the match clock are all
// dead — and that reading was wrong. Every one of them works. A fixture frozen from a
// paused frame would have encoded four false "known broken" facts.
//
// ⚠️ WHAT IS ACTUALLY MISSING: player position, and only that.
//
// The upstream is Rocket League's own Stats API ([TAGame.MatchStatsExporter_TA] in
// DefaultStatsAPI.ini, TCP 49123). rl_normalise.rs reads Location because it was written
// for the SOS/BakkesMod shape the retired companion emitted; the Stats API has no such key,
// so the json! macro fills it with zeros rather than failing. Every player arrives at
// {0,0}, which would plot the whole team on one dot at the centre of a field canvas.
//
// The position assertions below encode that BROKEN state on purpose. If one ever fails,
// positional data has started arriving and the field renderer in
// 2026-08-16-rl-hub-versus-2-field.md became buildable. Update the test then, not before.
import { describe, it, expect } from 'vitest';
import fixture from './live-update.json';

describe('captured live-update payload — what works', () => {
  it('carries a live, non-zero ball speed', () => {
    expect(fixture.ball.speed).toBeGreaterThan(0);
  });

  it('attributes the last ball touch to a real team, not the nobody sentinel', () => {
    expect(fixture.ball.team_num).not.toBe(255);
    expect([0, 1]).toContain(fixture.ball.team_num);
  });

  it('carries a running match clock', () => {
    expect(fixture.time).toBeGreaterThan(0);
  });

  it('carries real per-player speed for a moving car', () => {
    const moving = fixture.players.filter((p) => p.speed > 1);
    expect(moving.length).toBeGreaterThan(0);
  });

  it('carries per-player accumulated stats', () => {
    const scoring = fixture.players.find((p) => p.score > 0);
    expect(scoring).toBeDefined();
    expect(scoring.touches).toBeGreaterThan(0);
  });

  it('carries boost as a real percentage', () => {
    const boosted = fixture.players.find((p) => p.boost > 0);
    expect(boosted.boost).toBeLessThanOrEqual(100);
  });

  it('carries real in-game team colours, not the hardcoded defaults', () => {
    expect(fixture.teams.blue.color_primary).toMatch(/^[0-9A-Fa-f]{6}$/);
    expect(fixture.teams.blue.color_primary).not.toBe('1a6fdb');
  });

  it('carries arena, mode and the state flags the screen switches on', () => {
    expect(fixture.arena).toBeTruthy();
    expect(fixture.mode).toBeTruthy();
    for (const k of ['has_winner', 'is_overtime', 'is_replay']) {
      expect(typeof fixture[k]).toBe('boolean');
    }
  });
});

describe('captured live-update payload — the one real gap', () => {
  it('has no player positions — every car sits at the origin', () => {
    const moved = fixture.players.filter((p) => p.location.x !== 0 || p.location.y !== 0);
    expect(moved).toHaveLength(0);
  });

  it('has no ball position', () => {
    expect(fixture.ball).not.toHaveProperty('location');
  });

  it('still always constructs a location object, so the guard can never skip a player', () => {
    // `if (!p.location) continue;` in refreshVersus is dead code: json! builds the object
    // unconditionally, so an absent upstream field presents as a centred car rather than a
    // skipped one. That is why the old position maps looked empty instead of erroring.
    for (const p of fixture.players) {
      expect(Boolean(p.location)).toBe(true);
      expect(typeof p.location.x).toBe('number');
    }
  });
});
