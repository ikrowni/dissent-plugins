import { describe, it, expect, vi, afterEach } from 'vitest';
import { setFetcher, resetFetcher, getJson, HttpError } from './http.js';
import { urls } from './espn-client.js';

afterEach(() => { resetFetcher(); });

describe('urls', () => {
  it('builds a current-week scoreboard url with no params', () => {
    expect(urls.scoreboard({})).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  });

  it('builds a specific week url', () => {
    expect(urls.scoreboard({ season: 2025, seasonType: 2, week: 1 })).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2025&seasontype=2&week=1');
  });

  it('builds core-api game urls with the doubled competition id', () => {
    expect(urls.plays('401772510')).toBe(
      'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401772510/competitions/401772510/plays?limit=400');
    expect(urls.drives('401772510')).toContain('/competitions/401772510/drives');
    expect(urls.probabilities('401772510')).toContain('/probabilities?limit=200');
  });

  it('builds standings at level=3, not the empty site endpoint', () => {
    const u = urls.standings(2025);
    expect(u).toBe(
      'https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?season=2025&level=3');
    // The site.api variant returns 86 bytes at HTTP 200 — never use it.
    expect(u).not.toBe('https://site.api.espn.com/apis/site/v2/sports/football/nfl/standings');
  });

  it('builds the team roster url with roster enabled, since that carries injuries', () => {
    expect(urls.teamRoster(21)).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/21?enable=roster');
  });

  it('exposes no league-wide injuries builder, because that payload is 8.95 MB', () => {
    expect(urls.injuries).toBeUndefined();
    expect(JSON.stringify(Object.keys(urls))).not.toContain('injuries');
  });

  it('resizes headshots through the combiner, never the raw path', () => {
    const u = urls.headshot(3139477);
    expect(u).toContain('combiner');
    expect(u).toContain('w=200');
    expect(u).not.toMatch(/^https:\/\/a\.espncdn\.com\/i\/headshots/);
  });
});

describe('getJson', () => {
  it('routes through the injected fetcher and returns parsed json', async () => {
    const fake = vi.fn().mockResolvedValue({ ok: true, status: 200, body: '{"a":1}' });
    setFetcher(fake);
    await expect(getJson('https://x/y')).resolves.toEqual({ a: 1 });
    expect(fake).toHaveBeenCalledWith('https://x/y');
  });

  it('accepts an already-parsed body, since the host may hand back an object', async () => {
    setFetcher(vi.fn().mockResolvedValue({ ok: true, status: 200, body: { a: 2 } }));
    await expect(getJson('https://x/y')).resolves.toEqual({ a: 2 });
  });

  it('throws HttpError carrying the status on a non-2xx', async () => {
    setFetcher(vi.fn().mockResolvedValue({ ok: false, status: 503, body: '' }));
    await expect(getJson('https://x/y')).rejects.toThrow(HttpError);
    await expect(getJson('https://x/y')).rejects.toMatchObject({ status: 503 });
  });

  it('throws HttpError rather than a SyntaxError on unparseable json', async () => {
    setFetcher(vi.fn().mockResolvedValue({ ok: true, status: 200, body: 'not json' }));
    await expect(getJson('https://x/y')).rejects.toThrow(HttpError);
  });

  it('wraps a transport rejection as HttpError with status 0', async () => {
    setFetcher(vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(getJson('https://x/y')).rejects.toMatchObject({ status: 0 });
  });
});
