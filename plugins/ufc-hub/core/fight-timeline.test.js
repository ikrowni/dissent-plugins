import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEvent } from './ufc-cloudfront.js';
import { parseTracking, actionCounts, isSignificant } from './fight-timeline.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const final = parseEvent(fx('cf-event-final.json'));
const fight = final.fights[0];
const events = parseTracking(fight.tracking);

describe('parseTracking', () => {
  it('parses every tracked action on a fight', () => {
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBe(fight.tracking.length);
  });

  it('normalises each action', () => {
    const e = events[0];
    expect(e).toHaveProperty('actionId');
    expect(e).toHaveProperty('type');
    expect(e).toHaveProperty('fighterId');
    expect(e).toHaveProperty('round');
    expect(e).toHaveProperty('clock');
    expect(e).toHaveProperty('timestamp');
  });

  it('counts 360 tracked actions across the whole card', () => {
    const total = final.fights.reduce((n, f) => n + parseTracking(f.tracking).length, 0);
    expect(total).toBe(360);
  });

  it('never throws on a null or malformed payload', () => {
    expect(parseTracking(null)).toEqual([]);
    expect(parseTracking('nonsense')).toEqual([]);
    expect(parseTracking([{}])).toHaveLength(1);
    expect(parseTracking([{}])[0].type).toBe(null);
  });
});

describe('isSignificant', () => {
  it('treats a knockdown and a takedown as significant', () => {
    expect(isSignificant('knockdown')).toBe(true);
    expect(isSignificant('takedown')).toBe(true);
    expect(isSignificant('submission_attempt')).toBe(true);
  });

  it('treats bookkeeping actions as not significant', () => {
    expect(isSignificant('walkout')).toBe(false);
    expect(isSignificant('tale_of_the_tape')).toBe(false);
    expect(isSignificant('round_start')).toBe(false);
    expect(isSignificant(null)).toBe(false);
  });
});

describe('actionCounts', () => {
  it('counts takedowns landed and attempted per fighter', () => {
    const all = final.fights.flatMap((f) => parseTracking(f.tracking));
    const counts = actionCounts(all);
    const ids = Object.keys(counts);
    expect(ids.length).toBeGreaterThan(0);
    const totalTd = ids.reduce((n, id) => n + counts[id].takedowns, 0);
    const totalAtt = ids.reduce((n, id) => n + counts[id].takedownAttempts, 0);
    expect(totalTd).toBe(46);
    expect(totalAtt).toBe(106);
  });

  it('counts knockdowns, submission attempts and reversals', () => {
    const all = final.fights.flatMap((f) => parseTracking(f.tracking));
    const counts = actionCounts(all);
    const sum = (k) => Object.values(counts).reduce((n, c) => n + c[k], 0);
    expect(sum('knockdowns')).toBe(4);
    expect(sum('submissionAttempts')).toBe(15);
    expect(sum('reversals')).toBe(4);
  });

  it('ignores actions with no fighter attached', () => {
    const counts = actionCounts(parseTracking([
      { ActionId: 1, Type: 'round_start', FighterId: null },
    ]));
    expect(counts).toEqual({});
  });

  it('returns {} for no actions', () => {
    expect(actionCounts([])).toEqual({});
  });
});
