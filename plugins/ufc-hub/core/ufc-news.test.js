import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNews, relevantTo, cardAthleteIds, relativeTime } from './ufc-news.js';

const feed = parseNews(JSON.parse(readFileSync(
  new URL('../tests/fixtures/espn-news.json', import.meta.url), 'utf8')));

describe('parseNews', () => {
  it('reads the feed', () => {
    expect(feed.length).toBeGreaterThan(0);
    expect(feed[0].headline).toBeTruthy();
  });

  it('carries a readable link, an image and a timestamp', () => {
    const a = feed.find((x) => x.link && x.image);
    expect(a.link).toMatch(/^https?:\/\//);
    expect(a.image).toMatch(/^https?:\/\//);
    expect(a.published).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('carries the ESPN athlete ids, which is what makes card matching possible', () => {
    const withIds = feed.filter((a) => a.athleteIds.length);
    expect(withIds.length).toBeGreaterThan(0);
    expect(withIds[0].athleteIds.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('carries the premium flag, so a paywall can be announced', () => {
    expect(feed.every((a) => typeof a.premium === 'boolean')).toBe(true);
  });

  it('drops an article with no headline rather than rendering a blank row', () => {
    expect(parseNews({ articles: [{ id: 1 }, { id: 2, headline: 'Real' }] }))
      .toHaveLength(1);
  });

  it('never throws on a malformed payload', () => {
    expect(parseNews(null)).toEqual([]);
    expect(parseNews({})).toEqual([]);
    expect(parseNews({ articles: 'nope' })).toEqual([]);
  });
});

describe('relevantTo', () => {
  it('matches an article by athlete id', () => {
    const target = feed.find((a) => a.athleteIds.length);
    const hits = relevantTo(feed, [target.athleteIds[0]]);
    expect(hits).toContain(target);
  });

  it('returns EMPTY for a card nobody wrote about, which is the normal case', () => {
    // ⚠️ Measured across all of August 2026: only 2 of 8 cards had any news match at
    // all, and a full Fight Night had none. An empty result is not a failure and the
    // view must not render it as one.
    expect(relevantTo(feed, [999999999])).toEqual([]);
  });

  it('returns empty rather than everything when given no ids', () => {
    expect(relevantTo(feed, [])).toEqual([]);
    expect(relevantTo(feed, null)).toEqual([]);
  });
});

describe('cardAthleteIds', () => {
  it('pulls numeric ids out of the espn-athletes join, which stores them as strings', () => {
    const join = new Map([[1, { espnId: '3332412' }], [2, { espnId: '4021217' }]]);
    expect(cardAthleteIds(join)).toEqual([3332412, 4021217]);
  });

  it('skips an unmatched fighter rather than emitting NaN', () => {
    const join = new Map([[1, { espnId: null }], [2, { espnId: '123' }]]);
    expect(cardAthleteIds(join)).toEqual([123]);
  });

  it('never throws on nothing', () => {
    expect(cardAthleteIds(null)).toEqual([]);
    expect(cardAthleteIds(new Map())).toEqual([]);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-08-08T12:00:00Z');
  it('reads relatively', () => {
    expect(relativeTime('2026-08-08T11:30:00Z', now)).toBe('30m ago');
    expect(relativeTime('2026-08-08T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-08-05T12:00:00Z', now)).toBe('3d ago');
  });
  it('is empty for an unparseable date rather than "NaN ago"', () => {
    expect(relativeTime('nonsense', now)).toBe('');
    expect(relativeTime(null, now)).toBe('');
  });
});
