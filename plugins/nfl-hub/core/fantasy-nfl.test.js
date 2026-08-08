import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseScoreboard } from './espn-game.js';
import { buildNflContext, gameContext } from './fantasy-nfl.js';

const sb = parseScoreboard(JSON.parse(
  readFileSync(new URL('../tests/fixtures/scoreboard-2025-wk1.json', import.meta.url), 'utf8')));

describe('buildNflContext', () => {
  const ctx = buildNflContext(sb.games, []);

  it('indexes every playing team by abbreviation, both sides of each game', () => {
    expect(Object.keys(ctx.games).length).toBe(sb.games.length * 2);
    const g = sb.games[0];
    expect(ctx.games[g.home.abbr]).toBeDefined();
    expect(ctx.games[g.away.abbr]).toBeDefined();
  });

  it('records each team’s own margin, so "up 7" is from that team’s point of view', () => {
    const g = sb.games.find((x) => x.home.score !== x.away.score) ?? sb.games[0];
    const h = ctx.games[g.home.abbr];
    const a = ctx.games[g.away.abbr];
    expect(h.margin).toBe(-a.margin);
  });

  it('treats every team NOT on the slate as on bye', () => {
    const playing = new Set(sb.games.flatMap((g) => [g.home.abbr, g.away.abbr]));
    for (const abbr of ctx.byeTeams) expect(playing.has(abbr)).toBe(false);
    expect(ctx.byeTeams.length).toBe(32 - playing.size);
  });

  it('keys injuries by sleeper player id', () => {
    const c = buildNflContext(sb.games, [{ sleeperId: '99', status: 'Out' }]);
    expect(c.injuries['99']).toBe('Out');
  });

  it('survives no scoreboard at all — the whole league reads as bye, never as a crash', () => {
    const c = buildNflContext(null, null);
    expect(c.games).toEqual({});
    expect(c.byeTeams.length).toBe(32);
    expect(c.injuries).toEqual({});
  });
});

describe('gameContext', () => {
  const live = {
    games: { TB: { state: 'in', period: 3, clock: '4:20', margin: 7 } },
    byeTeams: ['NYJ'], injuries: {},
  };

  it('reads out the quarter and the margin for a live game', () => {
    const t = gameContext({ teamAbbr: 'TB' }, live);
    expect(t).toContain('Q3');
    expect(t).toMatch(/up 7/i);
  });

  it('says "down" when the team is behind', () => {
    const c = { games: { TB: { state: 'in', period: 2, clock: '0:30', margin: -3 } }, byeTeams: [], injuries: {} };
    expect(gameContext({ teamAbbr: 'TB' }, c)).toMatch(/down 3/i);
  });

  it('says "tied" rather than "up 0"', () => {
    const c = { games: { TB: { state: 'in', period: 1, clock: '9:00', margin: 0 } }, byeTeams: [], injuries: {} };
    expect(gameContext({ teamAbbr: 'TB' }, c)).toMatch(/tied/i);
  });

  it('reports final and pre-game states', () => {
    const c = {
      games: { TB: { state: 'post', margin: 4 }, KC: { state: 'pre', margin: 0 } },
      byeTeams: [], injuries: {},
    };
    expect(gameContext({ teamAbbr: 'TB' }, c)).toMatch(/final/i);
    expect(gameContext({ teamAbbr: 'KC' }, c)).toMatch(/scheduled/i);
  });

  it('labels overtime rather than "Q5"', () => {
    const c = { games: { TB: { state: 'in', period: 5, clock: '2:00', margin: 3 } }, byeTeams: [], injuries: {} };
    expect(gameContext({ teamAbbr: 'TB' }, c)).toContain('OT');
  });

  it('says BYE for a team with no game', () => {
    expect(gameContext({ teamAbbr: 'NYJ' }, live)).toMatch(/bye/i);
  });

  it('returns an em dash for an unknown or missing team rather than throwing', () => {
    expect(gameContext({ teamAbbr: null }, live)).toBe('—');
    expect(gameContext(null, live)).toBe('—');
    expect(gameContext({ teamAbbr: 'TB' }, null)).toBe('—');
  });
});
