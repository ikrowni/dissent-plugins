// tests/integration.test.js — the card rendered end to end, with the REAL athlete join.
//
// The unit tests each pass an empty or hand-built Map, which is exactly the shape of
// double that hides a join bug: every one of them would still pass if joinAthletes
// matched nothing at all. This drives the real ESPN month fixture through the real
// join into the real view and counts what comes out the other side.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEvent } from '../core/ufc-cloudfront.js';
import { athletesForEvent, joinAthletes } from '../core/espn-athletes.js';
import { renderPanel } from '../views/card.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

const event = parseEvent(fx('cf-event-upcoming.json'));
const athletes = joinAthletes(
  event.fights,
  athletesForEvent(fx('espn-month-202608.json'), '600060621'),
);

describe('card rendered with the real join', () => {
  it('gives all 24 fighters a DISTINCT headshot', () => {
    // Distinct, not just present: a last-name-only join would give the two Millers
    // the same image and a count of 24 non-unique URLs would still look correct.
    const html = renderPanel({ event, athletes });
    // Matched through the PROXY path. Counting raw espncdn URLs passes even when
    // every one of them is being blocked by the plugin CSP in production.
    const mugs = html.match(/\/api\/v1\/plugins\/image\?url=[^"]*headshots[^"]*/g) ?? [];
    expect(mugs).toHaveLength(24);
    expect(new Set(mugs).size).toBe(24);
    expect(html).not.toContain('src="https://a.espncdn.com');
  });

  it('gives all 24 fighters a country flag', () => {
    const html = renderPanel({ event, athletes });
    expect((html.match(/class="flag"/g) ?? [])).toHaveLength(24);
  });

  it('renders no result line anywhere on an upcoming card', () => {
    const html = renderPanel({ event, athletes });
    expect(html).not.toContain('fresult');
  });

  it('opens one versus screen with a complete tale of the tape', () => {
    const html = renderPanel({ event, athletes, openFight: event.fights[0].fightId });
    expect(html).toContain('Tale of the tape');
    expect((html.match(/class="vs-row/g) ?? [])).toHaveLength(6);
    expect((html.match(/class="vs-hero"/g) ?? [])).toHaveLength(1);
    // Both cutouts resolve through the join, not just one.
    expect((html.match(/class="vs-cut vs-cut-/g) ?? [])).toHaveLength(2);
  });
});
