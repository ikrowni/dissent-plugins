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

  it('floors the shorter bar so a small gap is still visible', () => {
    // Reach differs by inches. A bar proportional to zero renders 76" and 70.5" as
    // two near-identical full-width strips, which shows the reader nothing.
    const html = tapeRow('Reach', 76, 70.5, (v) => `${v}"`);
    const widths = [...html.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(50);
    expect(Math.min(...widths)).toBeLessThan(100);
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

  it('renders a headshot when the join has the fighter', () => {
    const withCut = new Map([[upcoming.fights[0].red.fighterId, { espnId: '3068125' }]]);
    const html = renderVersus(upcoming.fights[0], upcoming, withCut);
    expect(html).toContain('mma/players/full/3068125.png');
  });

  it('renders without headshots when the athlete join is empty', () => {
    const html = renderVersus(upcoming.fights[0], upcoming, new Map());
    expect(html).toContain('Tale of the tape');
    // Asserting on the URL, not the class: `class="vs-cut vs-cut-red"` never matches
    // a `<img class="vs-cut"` substring, so that assertion would pass either way.
    expect(html).not.toContain('mma/players/full/');
  });

  it('never throws on nothing', () => {
    expect(() => renderVersus(null, null, new Map())).not.toThrow();
  });
});
