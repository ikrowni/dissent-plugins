import { describe, it, expect } from 'vitest';
import { athleteUrl, eventPageSlug, eventPageUrl } from './ufc-links.js';

describe('athleteUrl', () => {
  it('upgrades the CloudFront link to https and lowercases the slug', () => {
    // ⚠️ CloudFront gives `http://www.ufc.com/athlete/Mateusz-Gamrot`. That works,
    // but costs TWO redirect hops (http->https, then capitalised->lowercase) out of
    // a THREE-hop budget the proxy enforces. Normalising spends none of it.
    expect(athleteUrl('http://www.ufc.com/athlete/Mateusz-Gamrot'))
      .toBe('https://www.ufc.com/athlete/mateusz-gamrot');
  });

  it('keeps the host on www.ufc.com, which is the granted host', () => {
    // hostAllowed is an EXACT match, never a suffix: `ufc.com` is a DIFFERENT host
    // from `www.ufc.com` and is not granted.
    expect(athleteUrl('http://ufc.com/athlete/x')).toBe('https://www.ufc.com/athlete/x');
  });

  it('is null for anything that is not a ufc.com athlete link', () => {
    expect(athleteUrl('https://espn.com/mma/fighter/_/id/1')).toBe(null);
    expect(athleteUrl('')).toBe(null);
    expect(athleteUrl(null)).toBe(null);
  });
});

describe('eventPageSlug', () => {
  it('builds a fight-night slug from the date', () => {
    expect(eventPageSlug('UFC Fight Night: Gamrot vs. Salkilld', '2026-08-08T21:00Z'))
      .toBe('ufc-fight-night-august-08-2026');
  });

  it('builds a numbered-event slug from the number, not the date', () => {
    expect(eventPageSlug('UFC 330: Makhachev vs. Machado Garry', '2026-08-15T21:00Z'))
      .toBe('ufc-330');
  });

  it('is null when it can do neither, rather than guessing', () => {
    expect(eventPageSlug("Dana White's Contender Series: Season 10, Week 1", null)).toBe(null);
    expect(eventPageSlug(null, null)).toBe(null);
  });
});

describe('eventPageUrl', () => {
  it('is a www.ufc.com url', () => {
    expect(eventPageUrl('UFC 330: x', '2026-08-15T21:00Z'))
      .toBe('https://www.ufc.com/event/ufc-330');
  });
  it('is null without a slug', () => {
    expect(eventPageUrl(null, null)).toBe(null);
  });
});
