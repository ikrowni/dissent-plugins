// Asserts the SHAPE of a real rl:live:update payload, captured from a live 1v1 on
// 2026-08-16. Player display names were replaced with placeholders; nothing else was
// altered.
//
// ⚠️ READ THIS BEFORE BUILDING ANYTHING POSITIONAL.
//
// The upstream is Rocket League's own Stats API ([TAGame.MatchStatsExporter_TA] in
// DefaultStatsAPI.ini, TCP 49123) — a match STATISTICS exporter. It does not carry
// positional telemetry, and it never did. rl_normalise.rs reads Location, bSupersonic,
// bOnWall and friends because it was written for the SOS/BakkesMod shape the retired
// companion daemon emitted; against the Stats API those keys are simply absent, and the
// json! macro fills them with zeros rather than failing.
//
// So every player arrives at location {0,0}, which plots the whole team on one dot at the
// centre of the canvas. That is not a rendering bug and no amount of plugin work fixes it.
//
// The position assertions below deliberately encode the BROKEN state. If one of them ever
// fails, positional data has started arriving — which means the field renderer in
// plan 2026-08-16-rl-hub-versus-2-field.md just became buildable. Update the test then,
// not before.
import { describe, it, expect } from 'vitest';
import fixture from './live-update.json';

describe('captured live-update payload — what works', () => {
  it('carries per-player accumulated stats', () => {
    const scorer = fixture.players.find((p) => p.goals > 0);
    expect(scorer).toBeDefined();
    expect(scorer.score).toBeGreaterThan(0);
    expect(scorer.touches).toBeGreaterThan(0);
  });

  it('carries real in-game team colours, not defaults', () => {
    expect(fixture.teams.blue.color_primary).toMatch(/^[0-9A-Fa-f]{6}$/);
    expect(fixture.teams.orange.color_primary).toMatch(/^[0-9A-Fa-f]{6}$/);
    expect(fixture.teams.blue.color_primary).not.toBe('1a6fdb');
  });

  it('carries team scores, arena and mode', () => {
    expect(fixture.teams.blue.score).toBe(1);
    expect(fixture.arena).toBeTruthy();
    expect(fixture.mode).toBeTruthy();
  });

  it('carries the state flags the screen switches on', () => {
    for (const k of ['has_winner', 'is_overtime', 'is_replay']) {
      expect(typeof fixture[k]).toBe('boolean');
    }
  });

  it('always constructs a location object, even with no data behind it', () => {
    for (const p of fixture.players) {
      expect(p.location).toBeDefined();
      expect(typeof p.location.x).toBe('number');
    }
  });
});

describe('captured live-update payload — what the Stats API does NOT provide', () => {
  it('has no player positions — every car sits at the origin', () => {
    const moved = fixture.players.filter((p) => p.location.x !== 0 || p.location.y !== 0);
    expect(moved).toHaveLength(0);
  });

  it('has no meaningful player speed', () => {
    for (const p of fixture.players) {
      expect(Math.abs(p.speed)).toBeLessThan(1);
    }
  });

  it('has no ball position at all', () => {
    expect(fixture.ball).not.toHaveProperty('location');
  });

  it('reports the ball as untouched by either team', () => {
    // 255 is the Stats API "nobody" sentinel, not a team index.
    expect(fixture.ball.team_num).toBe(255);
  });

  it('confirms the guard in refreshVersus can never skip a player', () => {
    // `if (!p.location) continue;` is dead code: json! always builds the object, so an
    // absent upstream field presents as a centred car rather than a skipped one. This is
    // why the position maps looked empty rather than erroring.
    for (const p of fixture.players) {
      expect(Boolean(p.location)).toBe(true);
    }
  });
});
