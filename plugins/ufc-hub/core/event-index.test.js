import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMonthIndex, monthKey } from './ufc-espn.js';
import { normaliseEventName, matchEvent, nearestEvent } from './event-index.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const index = parseMonthIndex(fx('espn-month-202608.json'));

describe('parseMonthIndex', () => {
  it('parses every event in the month', () => {
    expect(index).toHaveLength(8);
  });

  it('reads id, date and name', () => {
    expect(index[0]).toMatchObject({
      id: '600059339',
      date: '2026-08-01',
      name: 'UFC Fight Night: Medić vs. Rodriguez',
    });
  });

  it('counts the fights on each event', () => {
    expect(index[1].fightCount).toBe(12);
  });

  it('carries the completed state through', () => {
    expect(['pre', 'in', 'post']).toContain(index[0].state);
  });

  it('never throws on a malformed payload', () => {
    expect(parseMonthIndex(null)).toEqual([]);
    expect(parseMonthIndex({})).toEqual([]);
  });
});

describe('monthKey', () => {
  it('formats a date as ESPN expects', () => {
    expect(monthKey(new Date('2026-08-08T00:00:00Z'))).toBe('202608');
    expect(monthKey(new Date('2026-12-01T00:00:00Z'))).toBe('202612');
  });
});

describe('normaliseEventName', () => {
  it('strips diacritics, so ESPN Medić matches CloudFront Medic', () => {
    expect(normaliseEventName('UFC Fight Night: Medić vs. Rodriguez'))
      .toBe(normaliseEventName('UFC Fight Night: Medic vs. Rodriguez'));
  });

  it('folds "vs." and "vs" together', () => {
    expect(normaliseEventName('UFC Fight Night: Gamrot vs Salkilld'))
      .toBe(normaliseEventName('UFC Fight Night: Gamrot vs. Salkilld'));
  });

  it('folds an ampersand to "and"', () => {
    expect(normaliseEventName('A & B')).toBe(normaliseEventName('A and B'));
  });

  it('returns an empty string for nothing', () => {
    expect(normaliseEventName(null)).toBe('');
  });
});

describe('matchEvent', () => {
  // ⚠️ DATE IS PRIMARY. Measured across 40 events over nine months: no two UFC events
  // share a date. The name is a confirmation only — ESPN calls an event
  // "Dana White's Contender Series: Season 10, Week 1" where CloudFront calls it
  // "DWCS 10.1", so a name-first join loses every DWCS and Road To UFC card.
  const candidates = [
    { eventId: 1321, startTime: '2026-08-01T14:00Z', name: 'UFC Fight Night: Medic vs. Rodriguez' },
    { eventId: 1324, startTime: '2026-08-08T21:00Z', name: 'UFC Fight Night: Gamrot vs. Salkilld' },
    { eventId: 1328, startTime: '2026-08-11T23:00Z', name: 'DWCS 10.1' },
  ];

  it('matches on date alone when exactly one candidate shares it', () => {
    const hit = matchEvent({ date: '2026-08-08', name: 'UFC Fight Night: Gamrot vs Salkilld' }, candidates);
    expect(hit.eventId).toBe(1324);
  });

  it('matches a DWCS event whose names do NOT agree', () => {
    const hit = matchEvent(
      { date: '2026-08-11', name: "Dana White's Contender Series: Season 10, Week 1" },
      candidates,
    );
    expect(hit.eventId).toBe(1328);
  });

  it('matches across a diacritic difference', () => {
    const hit = matchEvent({ date: '2026-08-01', name: 'UFC Fight Night: Medić vs. Rodriguez' }, candidates);
    expect(hit.eventId).toBe(1321);
  });

  it('uses the name to break a tie when two candidates share a date', () => {
    const two = [
      { eventId: 900, startTime: '2026-08-08T18:00Z', name: 'Road To UFC 5.1' },
      { eventId: 901, startTime: '2026-08-08T21:00Z', name: 'UFC Fight Night: Gamrot vs. Salkilld' },
    ];
    const hit = matchEvent({ date: '2026-08-08', name: 'UFC Fight Night: Gamrot vs Salkilld' }, two);
    expect(hit.eventId).toBe(901);
  });

  it('matches across a midnight-UTC straddle, where the DATE STRINGS DISAGREE', () => {
    // Live data, 2026-08-08: ESPN dates DWCS 10.3 as 2026-08-25T23:00Z while CloudFront
    // stamps it 2026-08-26T00:00Z — one hour apart, opposite sides of midnight UTC. A
    // bare YYYY-MM-DD join drops this event entirely.
    const cf = [{ eventId: 1330, startTime: '2026-08-26T00:00Z', name: 'DWCS 10.3' }];
    const hit = matchEvent(
      {
        date: '2026-08-25',
        startTime: '2026-08-25T23:00Z',
        name: "Dana White's Contender Series: Season 10, Week 3",
      },
      cf,
    );
    expect(hit.eventId).toBe(1330);
  });

  it('does not match an event a week away', () => {
    const cf = [{ eventId: 1330, startTime: '2026-09-02T00:00Z', name: 'DWCS 10.4' }];
    expect(matchEvent({ date: '2026-08-25', startTime: '2026-08-25T23:00Z', name: 'x' }, cf))
      .toBe(null);
  });

  it('returns null when no candidate shares the date', () => {
    expect(matchEvent({ date: '2027-01-01', name: 'x' }, candidates)).toBe(null);
  });

  it('returns null for empty inputs rather than throwing', () => {
    expect(matchEvent(null, candidates)).toBe(null);
    expect(matchEvent({ date: '2026-08-08' }, [])).toBe(null);
  });
});

describe('nearestEvent', () => {
  it('prefers the next upcoming event', () => {
    const hit = nearestEvent(index, new Date('2026-08-06T00:00:00Z'));
    expect(hit.date).toBe('2026-08-08');
  });

  it('falls back to the most recent past event when none are upcoming', () => {
    const hit = nearestEvent(index, new Date('2027-01-01T00:00:00Z'));
    expect(hit.date).toBe(index[index.length - 1].date);
  });

  it('returns null for an empty index', () => {
    expect(nearestEvent([], new Date())).toBe(null);
  });

  it('holds the card once it has started, instead of jumping to the next one', () => {
    // The Aug 8 card starts 21:00Z. One minute in, the old code returned the
    // Aug 11 DWCS event, which made the live state unreachable.
    const hit = nearestEvent(index, new Date('2026-08-08T21:01:00Z'));
    expect(hit.date).toBe('2026-08-08');
  });

  it('still holds the card mid main-card', () => {
    const hit = nearestEvent(index, new Date('2026-08-09T01:30:00Z'));
    expect(hit.date).toBe('2026-08-08');
  });

  it('holds a finished card long enough to read the results', () => {
    const hit = nearestEvent(index, new Date('2026-08-09T18:00:00Z'));
    expect(hit.date).toBe('2026-08-08');
  });

  it('moves on once the results have had their day', () => {
    const hit = nearestEvent(index, new Date('2026-08-10T12:00:00Z'));
    expect(hit.date).toBe('2026-08-11');
  });

  it('never holds a card past the next card start time', () => {
    // Aug 15 21:00Z + runtime + grace would reach past Aug 18 23:00Z, so the
    // hold has to be truncated or the hub would sit on a stale card.
    const hit = nearestEvent(index, new Date('2026-08-19T00:00:00Z'));
    expect(hit.date).toBe('2026-08-18');
  });
});
