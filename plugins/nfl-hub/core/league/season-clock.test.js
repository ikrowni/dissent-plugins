import { describe, it, expect } from 'vitest';
import { shouldAdvance } from './season-clock.js';

const meta = (over = {}) => ({ season: 2026, currentWeek: 3, settings: {}, ...over });
// The real shape of Sleeper's /v1/state/nfl, season as a STRING.
const state = (over = {}) => ({ week: 5, season: '2026', season_type: 'regular', ...over });

describe('shouldAdvance', () => {
  it('advances when the live week is ahead', () => {
    expect(shouldAdvance(meta(), state())).toMatchObject({ advance: true, to: 5 });
  });

  it('advances a league that has never had a week', () => {
    const out = shouldAdvance(meta({ currentWeek: null }), state({ week: 1 }));
    expect(out).toMatchObject({ advance: true, to: 1 });
  });

  // ⚠️ Sleeper reports the season as a STRING. A === against a numeric league
  // season is always false, which would disable this entirely and look exactly
  // like the feature was never wired up.
  it('compares seasons numerically across the string/number boundary', () => {
    expect(shouldAdvance(meta({ season: 2026 }), state({ season: '2026' })).advance).toBe(true);
    expect(shouldAdvance(meta({ season: '2026' }), state({ season: 2026 })).advance).toBe(true);
  });

  it('refuses when the league is playing a different season', () => {
    const out = shouldAdvance(meta({ season: 2025 }), state({ season: '2026' }));
    expect(out.advance).toBe(false);
    expect(out.reason).toContain('not the live season');
  });

  // ⚠️ Preseason week 1 is not week 1.
  it('refuses outside the regular season and playoffs', () => {
    expect(shouldAdvance(meta(), state({ season_type: 'pre' })).advance).toBe(false);
    expect(shouldAdvance(meta(), state({ season_type: 'off' })).advance).toBe(false);
    expect(shouldAdvance(meta(), state({ season_type: 'post' })).advance).toBe(true);
  });

  // ⚠️ Going backwards would rescore a finished week against today's rosters.
  it('never goes backwards, and does nothing when already current', () => {
    expect(shouldAdvance(meta({ currentWeek: 9 }), state({ week: 5 })).advance).toBe(false);
    expect(shouldAdvance(meta({ currentWeek: 5 }), state({ week: 5 })).advance).toBe(false);
  });

  it('respects a commissioner holding the week', () => {
    const out = shouldAdvance(meta({ settings: { autoAdvanceWeek: false } }), state());
    expect(out.advance).toBe(false);
    expect(out.reason).toContain('auto-advance is off');
  });

  it('refuses a malformed or missing state rather than throwing', () => {
    expect(shouldAdvance(meta(), null).advance).toBe(false);
    expect(shouldAdvance(meta(), state({ week: 'soon' })).advance).toBe(false);
    expect(shouldAdvance(meta(), state({ week: 0 })).advance).toBe(false);
    expect(shouldAdvance(null, state()).advance).toBe(false);
  });

  // Every refusal must say why: "nothing happened" is the hardest outcome to
  // debug without a reason attached.
  it('always gives a reason', () => {
    for (const args of [
      [null, state()],
      [meta(), null],
      [meta({ season: 2020 }), state()],
      [meta({ currentWeek: 9 }), state()],
      [meta({ settings: { autoAdvanceWeek: false } }), state()],
      [meta(), state()],
    ]) {
      expect(shouldAdvance(...args).reason).toBeTruthy();
    }
  });
});
