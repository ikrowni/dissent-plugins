import {
  describe, it, expect, beforeEach, vi, afterEach,
} from 'vitest';
import {
  loadWeekProjections, projectedThisWeek, setWeekProjections, resetProjections,
} from './weekly-projections.js';
import { PPR_SCORING, HALF_PPR_SCORING, STANDARD_SCORING } from './league/scoring.js';
import { setFetcher } from './http.js';

beforeEach(resetProjections);
afterEach(() => setFetcher(null));

const line = { pass_yd: 300, pass_td: 2, rec: 4, rec_yd: 50, rush_yd: 20 };

describe('projectedThisWeek', () => {
  beforeEach(() => setWeekProjections(2026, 1, { 96: line }));
  const at = (scoring, week = 1) => projectedThisWeek('96', { season: 2026, week, scoring });

  // 🔴 THE RULE THIS MODULE EXISTS UNDER. Sleeper's own `pts_ppr` is ITS default
  // scoring and knows nothing about a league's settings, so the projection is
  // scored from RAW STATS through the league's weight map — the same function
  // that scores the real week. A league that plays half-PPR must not be shown
  // full-PPR projections beside its own scores.
  it('scores with the league’s own rules, not Sleeper’s', () => {
    const ppr = at(PPR_SCORING);
    const half = at(HALF_PPR_SCORING);
    const std = at(STANDARD_SCORING);
    expect(ppr).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(std);
    // Exactly the reception weight times four catches, nothing else.
    expect(ppr - half).toBeCloseTo(2, 5);
    expect(half - std).toBeCloseTo(2, 5);
  });

  // ⚠️ null, never 0 — 0 is a real projection for somebody not expected to play.
  it('is null for a player with no projection', () => {
    expect(at(PPR_SCORING, 1)).not.toBe(null);
    expect(projectedThisWeek('999', { season: 2026, week: 1, scoring: PPR_SCORING })).toBe(null);
  });

  it('is null for a week that is not loaded', () => {
    expect(at(PPR_SCORING, 9)).toBe(null);
  });

  it('is null without a scoring map rather than scoring as zero', () => {
    expect(at(null)).toBe(null);
    expect(at('ppr')).toBe(null);
  });
});

describe('loadWeekProjections', () => {
  it('fetches one week and caches it', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: JSON.stringify({ 96: line }) }));
    setFetcher(fetcher);
    await loadWeekProjections(2026, 3);
    await loadWeekProjections(2026, 3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/projections/nfl/regular/2026/3');
    expect(projectedThisWeek('96', { season: 2026, week: 3, scoring: PPR_SCORING }))
      .toBeGreaterThan(0);
  });

  // The roster and a matchup lineup mount together; without sharing they would
  // each pull half a megabyte.
  it('shares one request between concurrent callers', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: JSON.stringify({ 96: line }) }));
    setFetcher(fetcher);
    await Promise.all([loadWeekProjections(2026, 4), loadWeekProjections(2026, 4)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // ⚠️ It feeds ONE COLUMN. A dead upstream must cost that column, not the tab.
  it('resolves null on failure instead of throwing', async () => {
    setFetcher(async () => ({ status: 500, body: 'nope' }));
    await expect(loadWeekProjections(2026, 5)).resolves.toBe(null);
  });

  // ⚠️ A FAILURE IS NOT CACHED — caching it makes one blip permanent for the
  // session, on a column somebody will look at again in a minute.
  it('retries after a failure rather than remembering it', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ status: 500, body: 'nope' })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ 96: line }) });
    setFetcher(fetcher);
    expect(await loadWeekProjections(2026, 6)).toBe(null);
    expect(await loadWeekProjections(2026, 6)).not.toBe(null);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refuses a nonsense week without fetching', async () => {
    const fetcher = vi.fn();
    setFetcher(fetcher);
    for (const w of [0, -1, 1.5, null, 'soon']) {
      expect(await loadWeekProjections(2026, w)).toBe(null);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
