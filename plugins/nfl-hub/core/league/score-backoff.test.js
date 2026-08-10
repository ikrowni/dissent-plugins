import { describe, it, expect } from 'vitest';
import { fingerprintOf, isDue, nextBackoff, BASE_MS, CAP_MS } from './score-backoff.js';

const week = (totals) => Object.fromEntries(
  Object.entries(totals).map(([t, total]) => [t, { total, rows: [{ slot: 'QB', playerId: 'p1', points: total }] }]),
);

describe('fingerprintOf', () => {
  it('is stable for the same totals', () => {
    expect(fingerprintOf(week({ t1: 101.5, t2: 88.2 })))
      .toBe(fingerprintOf(week({ t1: 101.5, t2: 88.2 })));
  });

  it('ignores key order', () => {
    const a = fingerprintOf({ t2: { total: 5 }, t1: { total: 9 } });
    const b = fingerprintOf({ t1: { total: 9 }, t2: { total: 5 } });
    expect(a).toBe(b);
  });

  it('changes when any total moves', () => {
    expect(fingerprintOf(week({ t1: 101.5, t2: 88.2 })))
      .not.toBe(fingerprintOf(week({ t1: 101.6, t2: 88.2 })));
  });

  // ⚠️ TOTALS ONLY. Hashing the whole record would change whenever a lineup row
  // was reordered between identical scores, resetting the backoff constantly and
  // defeating the whole mechanism.
  it('does not change when only the rows are reordered', () => {
    const a = { t1: { total: 10, rows: [{ slot: 'QB' }, { slot: 'RB' }] } };
    const b = { t1: { total: 10, rows: [{ slot: 'RB' }, { slot: 'QB' }] } };
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  it('handles an empty week without throwing', () => {
    expect(fingerprintOf({})).toBe('');
    expect(fingerprintOf(undefined)).toBe('');
  });

  it('treats a missing total as zero rather than undefined', () => {
    expect(fingerprintOf({ t1: {} })).toBe('t1:0');
  });
});

describe('isDue', () => {
  // ⚠️ The backoff may only ever delay a REFRESH. A week nobody has scored must
  // always run, or a league that goes quiet never gets its first score at all.
  it('is always due when the week has never been scored', () => {
    expect(isDue(null)).toBe(true);
    expect(isDue(undefined)).toBe(true);
    expect(isDue({})).toBe(true);
  });

  it('is not due before the interval elapses', () => {
    expect(isDue({ nextScoreAt: 1000 }, 999)).toBe(false);
  });

  it('is due exactly on the boundary', () => {
    expect(isDue({ nextScoreAt: 1000 }, 1000)).toBe(true);
  });

  it('tolerates a record written before this mechanism existed', () => {
    expect(isDue({ scoredAt: 5, teams: {} })).toBe(true);
  });
});

describe('nextBackoff', () => {
  const fp = 't1:10|t2:20';

  it('starts at the base interval for a first score', () => {
    expect(nextBackoff(null, fp, 0).wait).toBe(BASE_MS);
  });

  it('doubles while nothing changes', () => {
    const a = nextBackoff({ fingerprint: fp, quietRuns: 0 }, fp, 0);
    expect(a.wait).toBe(BASE_MS * 2);
    const b = nextBackoff({ fingerprint: fp, quietRuns: 1 }, fp, 0);
    expect(b.wait).toBe(BASE_MS * 4);
  });

  // ⚠️ THE PROPERTY THAT KEEPS LIVE SCORING LIVE. One changed total must drop it
  // straight back to every tick, not step down gradually.
  it('snaps back to the base the moment anything changes', () => {
    const out = nextBackoff({ fingerprint: fp, quietRuns: 8 }, 't1:11|t2:20', 0);
    expect(out.wait).toBe(BASE_MS);
    expect(out.quietRuns).toBe(0);
  });

  it('never exceeds the cap', () => {
    let prev = { fingerprint: fp, quietRuns: 0 };
    for (let i = 0; i < 20; i += 1) {
      const out = nextBackoff(prev, fp, 0);
      expect(out.wait).toBeLessThanOrEqual(CAP_MS);
      prev = { fingerprint: fp, quietRuns: out.quietRuns };
    }
  });

  it('reaches the cap within a few quiet passes', () => {
    let prev = null;
    let passes = 0;
    let out = nextBackoff(prev, fp, 0);
    while (out.wait < CAP_MS && passes < 20) {
      prev = { fingerprint: fp, quietRuns: out.quietRuns };
      out = nextBackoff(prev, fp, 0);
      passes += 1;
    }
    expect(out.wait).toBe(CAP_MS);
    expect(passes).toBeLessThanOrEqual(3);
  });

  it('reports the absolute time the next pass is due', () => {
    expect(nextBackoff(null, fp, 1_000_000).nextScoreAt).toBe(1_000_000 + BASE_MS);
  });

  // The saving this whole thing exists for, stated as a number.
  it('cuts a quiet day from 288 passes to 72', () => {
    const perDay = (24 * 60 * 60 * 1000) / CAP_MS;
    expect(perDay).toBe(72);
    expect((24 * 60 * 60 * 1000) / BASE_MS).toBe(288);
  });
});
