import { describe, it, expect } from 'vitest';
import { trendingUrl, parseTrending, formatCount, loadTrending } from './trending.js';

// The shape Sleeper actually returns: an id and a count, nothing else.
const RAW = [
  { count: 52614, player_id: '13533' },
  { count: 25424, player_id: '13424' },
  { count: 9648, player_id: 'unknown-to-us' },
  { count: 8750, player_id: '5995' },
];
const INDEX = {
  13533: { n: 'Rookie One', p: 'WR', t: 'KC' },
  13424: { n: 'Rookie Two', p: 'RB', t: 'SF' },
  5995: { n: 'Veteran', p: 'TE', t: 'BUF' },
};

describe('trendingUrl', () => {
  it('builds the add and drop endpoints', () => {
    expect(trendingUrl('add')).toContain('/trending/add');
    expect(trendingUrl('drop')).toContain('/trending/drop');
  });

  it('defaults anything unrecognised to adds rather than a bad URL', () => {
    expect(trendingUrl('sideways')).toContain('/trending/add');
  });

  it('carries the lookback and limit', () => {
    const u = trendingUrl('add', { hours: 6, limit: 5 });
    expect(u).toContain('lookback_hours=6');
    expect(u).toContain('limit=5');
  });
});

describe('parseTrending', () => {
  it('joins ids to the local index', () => {
    const out = parseTrending(RAW, INDEX);
    expect(out[0].player.n).toBe('Rookie One');
    expect(out[0].count).toBe(52614);
  });

  // ⚠️ Sleeper sends NO name, position or team. A player the index does not know
  // would render as a bare id beside a transaction count, which is worse than
  // one fewer row.
  it('drops a player the index cannot name', () => {
    const out = parseTrending(RAW, INDEX);
    expect(out.map((r) => r.id)).not.toContain('unknown-to-us');
    expect(out).toHaveLength(3);
  });

  it('keeps Sleeper’s order, which is the trend', () => {
    expect(parseTrending(RAW, INDEX).map((r) => r.count)).toEqual([52614, 25424, 8750]);
  });

  it('honours the limit', () => {
    expect(parseTrending(RAW, INDEX, { limit: 2 })).toHaveLength(2);
  });

  it('rejects a zero or nonsense count rather than calling it a trend', () => {
    const odd = [
      { count: 0, player_id: '13533' },
      { count: -5, player_id: '13424' },
      { count: 'lots', player_id: '5995' },
    ];
    expect(parseTrending(odd, INDEX)).toEqual([]);
  });

  it('survives a malformed response instead of throwing', () => {
    expect(parseTrending(null, INDEX)).toEqual([]);
    expect(parseTrending({ nope: true }, INDEX)).toEqual([]);
    expect(parseTrending([{}], INDEX)).toEqual([]);
  });
});

describe('formatCount', () => {
  // ⚠️ Thousands are the normal case — 52,614 is a real top add — so the raw
  // number is noise in a narrow column.
  it('shortens thousands', () => {
    expect(formatCount(52614)).toBe('52.6k');
    expect(formatCount(1000)).toBe('1k');
  });

  it('leaves small numbers alone', () => {
    expect(formatCount(842)).toBe('842');
    expect(formatCount(0)).toBe('0');
  });

  it('does not throw on rubbish', () => {
    expect(formatCount(undefined)).toBe('0');
    expect(formatCount('x')).toBe('0');
  });
});

describe('loadTrending', () => {
  it('returns both directions', async () => {
    const out = await loadTrending(async (url) => (url.includes('drop') ? [RAW[1]] : RAW), INDEX);
    expect(out.adds.length).toBeGreaterThan(0);
    expect(out.drops).toHaveLength(1);
  });

  // ⚠️ Two independent requests, and the panel is useful with either. Losing
  // both because one failed would be the worst possible trade.
  it('keeps the direction that worked when the other fails', async () => {
    const out = await loadTrending(async (url) => {
      if (url.includes('drop')) throw new Error('upstream 503');
      return RAW;
    }, INDEX);
    expect(out.adds.length).toBeGreaterThan(0);
    expect(out.drops).toEqual([]);
  });

  it('returns empty arrays rather than throwing when both fail', async () => {
    const out = await loadTrending(async () => { throw new Error('offline'); }, INDEX);
    expect(out).toEqual({ adds: [], drops: [] });
  });
});
