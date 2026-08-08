import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  fightState, hasResult, liveClock, roundProgress, roundsFromRuleSet,
} from './fight-state.js';
import { parseEvent } from './ufc-cloudfront.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const upcoming = parseEvent(fx('cf-event-upcoming.json'));
const final = parseEvent(fx('cf-event-final.json'));

describe('hasResult', () => {
  it('is FALSE for an upcoming fight, whose Result object exists but is hollow', () => {
    // CloudFront emits a Result key on every fight. All 12 upcoming fights on this
    // card therefore have a truthy `.result` full of nulls — the trap that made
    // views/card.js 1.0.0 render an empty result line on every scheduled bout.
    expect(upcoming.fights.every((f) => f.result)).toBe(true);
    expect(upcoming.fights.some((f) => hasResult(f))).toBe(false);
  });

  it('is true for a decided fight', () => {
    expect(hasResult(final.fights[0])).toBe(true);
  });

  it('never throws on nothing', () => {
    expect(hasResult(null)).toBe(false);
    expect(hasResult({})).toBe(false);
  });
});

describe('fightState', () => {
  it('is "pre" for a fight on an upcoming card', () => {
    expect(fightState(upcoming.fights[0], upcoming)).toBe('pre');
  });

  it('is "post" for a fight with a result', () => {
    expect(fightState(final.fights[0], final)).toBe('post');
  });

  it('is "in" for the fight LiveFightId points at', () => {
    const ev = { ...upcoming, liveFightId: upcoming.fights[0].fightId };
    expect(fightState(upcoming.fights[0], ev)).toBe('in');
  });

  it('prefers a result over a stale LiveFightId', () => {
    // The event document has been seen carrying a LiveFightId after the bout ended.
    const ev = { ...final, liveFightId: final.fights[0].fightId };
    expect(fightState(final.fights[0], ev)).toBe('post');
  });

  it('never throws on nothing', () => {
    expect(fightState(null, null)).toBe('pre');
  });
});

describe('liveClock', () => {
  it('reads the round and elapsed time off the event', () => {
    const ev = { liveRound: 3, liveRoundElapsed: '0:49' };
    expect(liveClock(ev)).toEqual({ round: 3, clock: '0:49' });
  });

  it('is null when nothing is live', () => {
    expect(liveClock({ liveRound: null })).toBe(null);
    expect(liveClock(null)).toBe(null);
  });
});

describe('roundProgress', () => {
  it('marks earlier rounds done, the current one live, the rest pending', () => {
    expect(roundProgress(3, 5)).toEqual(['done', 'done', 'now', 'pending', 'pending']);
  });

  it('defaults to three rounds when the rule set is unknown', () => {
    expect(roundProgress(1, null)).toHaveLength(3);
  });
});

describe('roundsFromRuleSet', () => {
  it('reads the round count off the description', () => {
    expect(roundsFromRuleSet('5 Rnd (5-5-5-5-5)')).toBe(5);
    expect(roundsFromRuleSet('3 Rnd (5-5-5)')).toBe(3);
  });

  it('is null when the shape is unfamiliar', () => {
    expect(roundsFromRuleSet('')).toBe(null);
    expect(roundsFromRuleSet(null)).toBe(null);
  });
});
