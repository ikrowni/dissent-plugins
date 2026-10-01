import { describe, it, expect } from 'vitest';
import { scoreboardUrl, gamesFromScoreboard } from './espn-week.js';

describe('espn-week', () => {
  it('builds the regular-season scoreboard URL', () => {
    expect(scoreboardUrl(2026, 4)).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=4&dates=2026');
  });

  it('maps events to kickoff + completed (shape verified live 2026-10-01, week 3: 16 events)', () => {
    const payload = { events: [
      { date: '2026-09-25T00:15Z', status: { type: { completed: true, name: 'STATUS_FINAL' } } },
      { date: '2026-09-29T00:15Z', status: { type: { completed: false, name: 'STATUS_IN_PROGRESS' } } },
    ] };
    expect(gamesFromScoreboard(payload)).toEqual([
      { kickoff: Date.UTC(2026, 8, 25, 0, 15), completed: true },
      { kickoff: Date.UTC(2026, 8, 29, 0, 15), completed: false },
    ]);
  });

  it('returns null for anything that is not a scoreboard, so the caller retries', () => {
    expect(gamesFromScoreboard(null)).toBeNull();
    expect(gamesFromScoreboard({})).toBeNull();
    expect(gamesFromScoreboard({ events: [] })).toBeNull();
  });
});
