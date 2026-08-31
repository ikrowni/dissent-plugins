// ⚠️ THIS FILE PINS A NON-UTC TIMEZONE, AND THAT IS LOAD-BEARING. The VPS and
// the CI runner both sit at UTC, where local time and UTC are the same clock —
// so the round-trip test below passes with the bug it exists to catch fully
// present. Verified: restoring the `toISOString().slice(0,16)` implementation
// leaves every test green under TZ=UTC and fails three of them under this one.
//
// Set BEFORE importing anything that touches Date, and chosen for a zone with a
// non-zero offset that also observes DST, so a September draft and a January
// one do not share an offset.
process.env.TZ = 'America/New_York';

import { describe, it, expect } from 'vitest';
import {
  toLocalInputValue, fromLocalInputValue, relativeTo, formatDraftTime,
} from './draft-schedule.js';

it('runs under a timezone where local and UTC actually differ', () => {
  expect(new Date(2026, 8, 6).getTimezoneOffset()).not.toBe(0);
});

const MIN = 60000, HOUR = 3600000, DAY = 86400000;

describe('datetime-local round trip', () => {
  // ⚠️ THE BUG THIS GUARDS. `toISOString().slice(0,16)` is UTC, but a
  // datetime-local input is read as LOCAL — so a commissioner outside UTC would
  // have walked the draft by their offset every time they opened the settings
  // form and pressed Save, without ever touching the field.
  it('survives a save that does not touch the field', () => {
    const original = new Date(2026, 8, 6, 20, 0).getTime(); // 6 Sep 2026, 8pm local
    let value = original;
    for (let i = 0; i < 5; i++) value = fromLocalInputValue(toLocalInputValue(value));
    expect(value).toBe(original);
  });

  it('reads the input as local time, not as UTC', () => {
    const ms = fromLocalInputValue('2026-09-06T20:00');
    const d = new Date(ms);
    expect(d.getHours()).toBe(20);
    expect(d.getDate()).toBe(6);
  });

  it('renders local wall-clock digits, not UTC ones', () => {
    const ms = new Date(2026, 8, 6, 20, 30).getTime();
    expect(toLocalInputValue(ms)).toBe('2026-09-06T20:30');
  });

  // An empty field means "not scheduled", which must clear the setting rather
  // than store 0 — epoch 0 renders as a draft that happened in 1970.
  it('treats an empty field as no schedule', () => {
    for (const v of ['', '   ', null, undefined]) expect(fromLocalInputValue(v)).toBe(null);
  });

  it('refuses a value it cannot parse instead of storing NaN', () => {
    expect(fromLocalInputValue('not a date')).toBe(null);
  });

  it('renders nothing for an unset time', () => {
    for (const v of [null, undefined, NaN]) expect(toLocalInputValue(v)).toBe('');
  });
});

describe('relativeTo', () => {
  const now = Date.UTC(2026, 8, 1, 12, 0);

  it('counts forward in the largest sensible unit', () => {
    expect(relativeTo(now + 6 * DAY, now)).toBe('in 6 days');
    expect(relativeTo(now + 1 * DAY, now)).toBe('in 1 day');
    expect(relativeTo(now + 3 * HOUR, now)).toBe('in 3 hours');
    expect(relativeTo(now + 20 * MIN, now)).toBe('in 20 minutes');
  });

  it('counts backward once the time has passed', () => {
    expect(relativeTo(now - 2 * HOUR, now)).toBe('2 hours ago');
    expect(relativeTo(now - 3 * DAY, now)).toBe('3 days ago');
  });

  it('says "starting now" inside the last minute rather than "in 0 minutes"', () => {
    expect(relativeTo(now + 30000, now)).toBe('starting now');
    expect(relativeTo(now, now)).toBe('starting now');
    expect(relativeTo(now - 30000, now)).toBe('started just now');
  });

  it('is empty rather than throwing for an unset time', () => {
    expect(relativeTo(null, now)).toBe('');
  });
});

describe('formatDraftTime', () => {
  const now = Date.UTC(2026, 8, 1, 12, 0);

  it('returns null for an unset time so callers render nothing', () => {
    for (const v of [null, undefined, NaN, 'soon']) expect(formatDraftTime(v, now)).toBe(null);
  });

  // ⚠️ Without the zone, two managers comparing screenshots see two different
  // times for one draft and cannot tell which of them is wrong.
  it('names the timezone in the absolute time', () => {
    const out = formatDraftTime(now + DAY, now, 'en-US');
    expect(out.absolute).toMatch(/[A-Z]{2,5}|GMT/);
    expect(out.absolute.length).toBeGreaterThan(10);
  });

  it('carries both halves, because neither is enough alone', () => {
    const out = formatDraftTime(now + 2 * DAY, now, 'en-US');
    expect(out.relative).toBe('in 2 days');
    expect(out.absolute).toMatch(/Sep/);
  });

  it('flags a time that has already passed', () => {
    expect(formatDraftTime(now - HOUR, now).past).toBe(true);
    expect(formatDraftTime(now + HOUR, now).past).toBe(false);
  });
});
