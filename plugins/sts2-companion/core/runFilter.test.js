import { describe, it, expect } from 'vitest';
import { countsForStats, MIN_FLOORS } from './runFilter.js';

const run = (over) => ({ floors: 20, game_mode: 'standard', ...over });

describe('countsForStats', () => {
  it(`drops runs that never got past floor ${MIN_FLOORS - 1} — started and left`, () => {
    expect(countsForStats(run({ floors: 0 }))).toBe(false);
    expect(countsForStats(run({ floors: 1 }))).toBe(false);
    expect(countsForStats(run({ floors: 2 }))).toBe(true);
  });

  it('drops custom games, keeps standard and daily', () => {
    expect(countsForStats(run({ game_mode: 'custom' }))).toBe(false);
    expect(countsForStats(run({ game_mode: 'standard' }))).toBe(true);
    expect(countsForStats(run({ game_mode: 'daily' }))).toBe(true);
  });

  it('reads a digest\'s field names too', () => {
    expect(countsForStats({ floors: 1, gameMode: 'standard' })).toBe(false);
    expect(countsForStats({ floors: 9, gameMode: 'custom' })).toBe(false);
    expect(countsForStats({ floors: 9, gameMode: 'standard' })).toBe(true);
  });
});
