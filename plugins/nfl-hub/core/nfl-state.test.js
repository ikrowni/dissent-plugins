import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseState, stateUrl } from './nfl-state.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const fixture = (n) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));

describe('parseState', () => {
  it('flattens the state payload', () => {
    const s = parseState({
      week: 1, season: '2026', season_type: 'pre', display_week: 1,
      season_start_date: '2026-08-06',
    });
    expect(s).toEqual({
      week: 1, displayWeek: 1, season: 2026, seasonType: 'pre',
      isPreseason: true, isRegular: false, seasonStart: '2026-08-06',
    });
  });

  it('marks the regular season', () => {
    expect(parseState({ season: '2026', season_type: 'regular', week: 4 }).isRegular).toBe(true);
  });

  it('parses the recorded fixture', () => {
    const s = parseState(fixture('sleeper-state.json'));
    expect(s.season).toBeGreaterThan(2020);
    expect(typeof s.week).toBe('number');
  });

  it('returns null for junk', () => {
    expect(parseState(null)).toBeNull();
  });

  /**
   * ⚠️ ONE DELIBERATE DIVERGENCE from the version this replaced. The old `num`
   * was `Number(v)` with no finite check, so an unparseable week produced **NaN**
   * — and `NaN ?? 1` is NaN, because `??` only catches null and undefined. The
   * fallback therefore never fired on the one input it existed for, and the hub
   * would have carried `week: NaN` into every view that prints it.
   */
  it('falls back rather than carrying NaN out of a junk payload', () => {
    const s = parseState({ week: 'soon', season: 'next', season_type: 'pre' });
    expect(s.week).toBe(1);
    expect(s.displayWeek).toBe(1);
    expect(s.season).toBeNull();
  });
});

describe('the state endpoint', () => {
  // ⚠️ The one Sleeper URL the hub still calls. server/ops-scoring.js hits the
  // same host for live stat lines, so this is not an extra dependency.
  it('points at Sleeper’s unauthenticated state endpoint', () => {
    expect(stateUrl()).toBe('https://api.sleeper.app/v1/state/nfl');
  });
});
