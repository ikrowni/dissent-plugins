import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderVersus, tapeRow } from './versus.js';
import { parseEvent } from '../core/ufc-cloudfront.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const upcoming = parseEvent(fx('cf-event-upcoming.json'));
const final = parseEvent(fx('cf-event-final.json'));
const athletes = new Map();   // no join available in this test; views must cope

describe('tapeRow', () => {
  it('gives the larger value the longer bar', () => {
    const html = tapeRow('Reach', 76, 70.5, (v) => `${v}"`);
    const [red, blue] = [...html.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(red).toBeGreaterThan(blue);
  });

  it('gives equal values equal bars', () => {
    const html = tapeRow('Reach', 76, 76, (v) => `${v}"`);
    const [red, blue] = [...html.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(red).toBe(blue);
  });

  it('keeps the bar PROPORTIONAL — it must not exaggerate a small gap', () => {
    // ⚠️ REGRESSION GUARD. A previous version floored the shorter bar at 55%, so 71"
    // against 75" — a 5% difference — drew one bar at half and the other full, which
    // reads as nearly double. The bar must stay proportional to the value.
    const html = tapeRow('Reach', 75, 71, (v) => `${v}"`);
    const [red, blue] = [...html.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(red).toBe(100);
    expect(blue).toBeCloseTo(94.7, 0);
  });

  it('carries the gap in an advantage chip, on the longer side only', () => {
    const html = tapeRow('Reach', 75, 71, (v) => `${v}"`);
    expect(html).toContain('+4&quot;');   // esc() escapes the inch mark
    expect((html.match(/vs-adv/g) ?? [])).toHaveLength(1);
    // The chip belongs to the fighter who actually has the advantage.
    const redIdx = html.indexOf('vs-red');
    const blueIdx = html.indexOf('vs-blue');
    expect(html.indexOf('vs-adv')).toBeGreaterThan(redIdx);
    expect(html.indexOf('vs-adv')).toBeLessThan(blueIdx);
  });

  it('shows no advantage chip when the two are equal', () => {
    expect(tapeRow('Reach', 76, 76, (v) => `${v}"`)).not.toContain('vs-adv');
  });

  it('renders a fractional gap without a misleading rounding', () => {
    expect(tapeRow('Reach', 76, 70.5, (v) => `${v}"`)).toContain('+5.5&quot;');
  });
});

describe('renderVersus', () => {
  it('renders an upcoming fight without a result block', () => {
    const html = renderVersus(upcoming.fights[0], upcoming, athletes);
    expect(html).toContain('Tale of the tape');
    expect(html).not.toContain('vs-result');
    expect(html).not.toContain('vs-livebar');
  });

  it('renders a finished fight with the method and the scorecards', () => {
    const html = renderVersus(final.fights[0], final, athletes);
    expect(html).toContain('vs-result');
    expect(html).toContain('Decision - Unanimous');
    expect(html).toContain('D&#39;amato');     // judge name, escaped
  });

  it('renders a live fight with the round strip and no result', () => {
    const ev = { ...upcoming, liveFightId: upcoming.fights[0].fightId, liveRound: 2,
      liveRoundElapsed: '3:12' };
    const html = renderVersus(upcoming.fights[0], ev, athletes);
    expect(html).toContain('vs-livebar');
    expect(html).toContain('R2');
    expect(html).not.toContain('vs-result');
  });

  it('labels the counts "tracked actions", never "statistics"', () => {
    const html = renderVersus(final.fights[0], final, athletes);
    expect(html.toLowerCase()).toContain('tracked actions');
    expect(html.toLowerCase()).not.toContain('significant strikes');
  });

  it('routes the cutout through the node image proxy', () => {
    // The raw URL survives in both the proxied and unproxied output, so asserting on
    // it cannot tell a working build from one the CSP is blocking.
    const withCut = new Map([[upcoming.fights[0].red.fighterId, { espnId: '3068125' }]]);
    const html = renderVersus(upcoming.fights[0], upcoming, withCut);
    expect(html).toContain('/api/v1/plugins/image?url=');
    expect(html).not.toContain('src="https://a.espncdn.com');
  });

  it('renders without headshots when the athlete join is empty', () => {
    const html = renderVersus(upcoming.fights[0], upcoming, new Map());
    expect(html).toContain('Tale of the tape');
    expect(html).not.toContain('/api/v1/plugins/image');
  });

  it('never throws on nothing', () => {
    expect(() => renderVersus(null, null, new Map())).not.toThrow();
  });
});

describe('official artwork', () => {
  const art = { art: 'https://ufc.com/x-EVENT-ART.jpg',
    renders: { GAMROTMATEUSZ: { url: 'https://ufc.com/GAMROT_MATEUSZ_L_08-08.png', side: 'L' } } };

  it('uses the official art on the MAIN EVENT', () => {
    const main = upcoming.fights.find((f) => f.order === 1);
    const html = renderVersus(main, upcoming, athletes, null, art);
    expect(html).toContain('vs-hero-art');
    expect(html).toContain(encodeURIComponent('x-EVENT-ART.jpg'));
  });

  it('does NOT use it on an undercard bout', () => {
    // ⚠️ There is one piece of art per EVENT and it shows the headliner. On any other
    // fight it is a picture of two people who are not fighting.
    const under = upcoming.fights.find((f) => f.order !== 1);
    const html = renderVersus(under, upcoming, athletes, null, art);
    expect(html).not.toContain('vs-hero-art');
    expect(html).toContain('vs-hero');       // composed hero instead
  });

  it('falls back to the composed hero when artwork is unavailable', () => {
    const main = upcoming.fights.find((f) => f.order === 1);
    const html = renderVersus(main, upcoming, athletes, null, null);
    expect(html).not.toContain('vs-hero-art');
    expect(html).toContain('vs-hero');
  });

  it('routes the artwork through the image proxy', () => {
    const main = upcoming.fights.find((f) => f.order === 1);
    const html = renderVersus(main, upcoming, athletes, null, art);
    expect(html).toContain('/api/v1/plugins/image?url=');
    expect(html).not.toContain('src="https://ufc.com');
  });
});

describe('market link', () => {
  const market = { slug: 'ufc-x-2026-08-08', names: ['A', 'B'], prob: {},
    byFighter: {}, rounds: [], distance: null, ko: null, sub: null };

  it('offers the market page, opened safely', () => {
    const f = upcoming.fights[0];
    const html = renderVersus(f, upcoming, athletes, market);
    expect(html).toContain('polymarket.com/event/ufc-x-2026-08-08');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('adds no referral parameter to the outbound link', () => {
    const f = upcoming.fights[0];
    const html = renderVersus(f, upcoming, athletes, market);
    expect(html).not.toMatch(/polymarket\.com\/event\/[^"]*[?&]/);
  });

  it('shows no link when there is no market', () => {
    const f = upcoming.fights[0];
    expect(renderVersus(f, upcoming, athletes, null)).not.toContain('mk-link');
  });
});
