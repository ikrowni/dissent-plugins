import { describe, it, expect } from 'vitest';
import { finalityVerdict, backstopKickoffEstimate, BACKSTOP_MS } from './week-finality.js';

const H = 3_600_000;
// Week 4, 2026: last kickoff Monday Sep 28 20:15 EDT = 00:15 UTC Tue Sep 29.
const LAST = Date.UTC(2026, 8, 29, 0, 15);
const TUE_9_ET = Date.UTC(2026, 8, 29, 13); // 09:00 EDT
const games = (completed) => [
  { kickoff: Date.UTC(2026, 8, 25, 0, 15), completed: true },
  { kickoff: LAST, completed },
];

describe('finalityVerdict', () => {
  it('does not lock before 09:00 ET the next morning, even with every game complete', () => {
    const v = finalityVerdict({ games: games(true), now: TUE_9_ET - 1 });
    expect(v.lock).toBe(false);
    expect(v.lockAt).toBe(TUE_9_ET);
  });

  it('locks at 09:00 ET the morning after the last game once every game is complete', () => {
    expect(finalityVerdict({ games: games(true), now: TUE_9_ET })).toMatchObject({ lock: true, reason: 'all-games-complete' });
  });

  it('waits on an unfinished game', () => {
    const v = finalityVerdict({ games: games(false), now: TUE_9_ET + 2 * H });
    expect(v.lock).toBe(false);
    expect(v.reason).toMatch(/not complete/);
  });

  it('the backstop locks 3 days after the last kickoff regardless', () => {
    expect(finalityVerdict({ games: games(false), now: LAST + BACKSTOP_MS }))
      .toMatchObject({ lock: true, reason: 'backstop' });
  });

  it('a week checked long after it finished is "all-games-complete", not "backstop"', () => {
    expect(finalityVerdict({ games: games(true), now: LAST + 10 * BACKSTOP_MS }))
      .toMatchObject({ lock: true, reason: 'all-games-complete' });
  });

  it('with no games known, only a supplied backstop estimate can lock', () => {
    expect(finalityVerdict({ games: [], now: LAST + BACKSTOP_MS }).lock).toBe(false);
    expect(finalityVerdict({ games: [], now: LAST + BACKSTOP_MS, lastKickoffEstimate: LAST }))
      .toMatchObject({ lock: true, reason: 'backstop' });
  });
});

describe('backstopKickoffEstimate', () => {
  it('is the first Monday on or after season start + 7 days per week (season start is a Wednesday)', () => {
    // 2026-09-09 is a Wednesday; week 1 → Monday 2026-09-14; week 4 → Monday 2026-10-05.
    expect(new Date(backstopKickoffEstimate('2026-09-09', 1)).toISOString().slice(0, 10)).toBe('2026-09-14');
    expect(new Date(backstopKickoffEstimate('2026-09-09', 4)).toISOString().slice(0, 10)).toBe('2026-10-05');
  });
});
