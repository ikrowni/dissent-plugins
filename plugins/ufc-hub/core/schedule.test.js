import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shiftMonth, monthLabel, monthOf, eventPhase, sortByDate } from './schedule.js';
import { parseMonthIndex } from './ufc-espn.js';

const index = parseMonthIndex(JSON.parse(readFileSync(
  new URL('../tests/fixtures/espn-month-202608.json', import.meta.url), 'utf8')));

describe('shiftMonth', () => {
  it('walks forwards and backwards within a year', () => {
    expect(shiftMonth('202608', 1)).toBe('202609');
    expect(shiftMonth('202608', -1)).toBe('202607');
  });

  it('rolls the year over in both directions', () => {
    expect(shiftMonth('202612', 1)).toBe('202701');
    expect(shiftMonth('202601', -1)).toBe('202512');
    expect(shiftMonth('202601', -13)).toBe('202412');
  });

  it('does not skip a month the way Date arithmetic would', () => {
    // ⚠️ `new Date(2026, 0 + 1, 31)` is 3 March, not 28 February — a pager built on
    // Date month arithmetic from a day-31 date skips February entirely. This works on
    // the key, not on a Date, so there is no day to overflow.
    expect(shiftMonth('202601', 1)).toBe('202602');
    expect(shiftMonth('202603', -1)).toBe('202602');
  });

  it('is null for a malformed key rather than producing a plausible wrong one', () => {
    expect(shiftMonth('2026', 1)).toBe(null);
    expect(shiftMonth('202613', 1)).toBe(null);
    expect(shiftMonth(null, 1)).toBe(null);
  });
});

describe('monthLabel', () => {
  it('reads as a human month', () => {
    expect(monthLabel('202608')).toBe('August 2026');
    expect(monthLabel('202512')).toBe('December 2025');
  });
  it('is empty for a malformed key', () => {
    expect(monthLabel('nope')).toBe('');
  });
});

describe('monthOf', () => {
  it('derives the month key from an event start time', () => {
    expect(monthOf('2026-08-08T21:00Z')).toBe('202608');
  });
  it('uses UTC, so a late-evening card does not land in the next month', () => {
    expect(monthOf('2026-08-31T23:00Z')).toBe('202608');
  });
  it('is null for nothing', () => {
    expect(monthOf('nonsense')).toBe(null);
  });
});

describe('eventPhase', () => {
  const ev = { startTime: '2026-08-08T21:00Z' };

  it('is upcoming before the first bell', () => {
    expect(eventPhase(ev, new Date('2026-08-08T20:00:00Z'))).toBe('upcoming');
  });

  it('is live while the card is running', () => {
    expect(eventPhase(ev, new Date('2026-08-09T01:00:00Z'))).toBe('live');
  });

  it('is past once the card is over', () => {
    expect(eventPhase(ev, new Date('2026-08-09T12:00:00Z'))).toBe('past');
  });

  it('never throws on a missing date', () => {
    expect(eventPhase({}, new Date())).toBe('upcoming');
    expect(eventPhase(null, new Date())).toBe('upcoming');
  });
});

describe('sortByDate', () => {
  it('puts a real month in chronological order', () => {
    const sorted = sortByDate(index);
    const times = sorted.map((e) => new Date(e.startTime).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(sorted[0].date).toBe('2026-08-01');
  });

  it('does not mutate its input', () => {
    const before = index.map((e) => e.date);
    sortByDate(index);
    expect(index.map((e) => e.date)).toEqual(before);
  });

  it('never throws on nothing', () => {
    expect(sortByDate(null)).toEqual([]);
  });
});
