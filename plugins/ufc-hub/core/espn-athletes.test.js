import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { athletesForEvent, headshotUrl, joinAthletes } from './espn-athletes.js';
import { parseEvent } from './ufc-cloudfront.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const month = fx('espn-month-202608.json');
const cf = parseEvent(fx('cf-event-upcoming.json'));

describe('athletesForEvent', () => {
  it('pulls every competitor on the card out of the month index', () => {
    const list = athletesForEvent(month, '600060621');
    expect(list).toHaveLength(24);
    expect(list[0]).toHaveProperty('espnId');
    expect(list[0]).toHaveProperty('name');
  });

  it('carries the country flag through', () => {
    const list = athletesForEvent(month, '600060621');
    expect(list.every((a) => typeof a.flag === 'string' && a.flag.length)).toBe(true);
  });

  it('returns an empty list for an unknown event, and never throws', () => {
    expect(athletesForEvent(month, 'nope')).toEqual([]);
    expect(athletesForEvent(null, '600060621')).toEqual([]);
  });
});

describe('headshotUrl', () => {
  it('builds the ESPN headshot path', () => {
    expect(headshotUrl('3068125'))
      .toBe('https://a.espncdn.com/i/headshots/mma/players/full/3068125.png');
  });

  it('returns null without an id, so a caller cannot build a 404', () => {
    expect(headshotUrl(null)).toBe(null);
    expect(headshotUrl('')).toBe(null);
  });
});

describe('joinAthletes', () => {
  const joined = joinAthletes(cf.fights, athletesForEvent(month, '600060621'));

  it('matches every fighter on the card', () => {
    const ids = cf.fights.flatMap((f) => f.fighters.map((x) => x.fighterId));
    const matched = ids.filter((id) => joined.get(id)?.espnId);
    expect(matched).toHaveLength(ids.length);
  });

  it('does not confuse two fighters who share a last name', () => {
    // ⚠️ THE REASON THE FIRST NAME IS LOAD-BEARING. The 2026-08-08 card carries
    // BOTH Ty Miller (4364) and Juliana Miller (3913). A last-name-only join gives
    // them the same headshot, which is the kind of bug nobody reports as a bug.
    const ty = joined.get(4364);
    const juliana = joined.get(3913);
    expect(ty?.espnId).toBeTruthy();
    expect(juliana?.espnId).toBeTruthy();
    expect(ty.espnId).not.toBe(juliana.espnId);
  });

  it('strips diacritics, so ESPN Medić matches CloudFront Medic', () => {
    const fights = [{ fighters: [{ fighterId: 1, firstName: 'Kaan', lastName: 'Medic' }] }];
    const hit = joinAthletes(fights, [{ espnId: '99', name: 'Kaan Medić', flag: null }]);
    expect(hit.get(1)?.espnId).toBe('99');
  });

  it('leaves a fighter unmatched rather than guessing', () => {
    const fights = [{ fighters: [{ fighterId: 7, firstName: 'Nobody', lastName: 'Here' }] }];
    expect(joinAthletes(fights, [{ espnId: '1', name: 'Someone Else' }]).size).toBe(0);
  });

  it('never throws on empty input', () => {
    expect(joinAthletes([], []).size).toBe(0);
    expect(joinAthletes(null, null).size).toBe(0);
  });
});
