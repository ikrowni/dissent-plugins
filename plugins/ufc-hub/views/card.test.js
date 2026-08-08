import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEvent } from '../core/ufc-cloudfront.js';
import { renderPanel, fightRow } from './card.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const upcoming = parseEvent(fx('cf-event-upcoming.json'));
const final = parseEvent(fx('cf-event-final.json'));

describe('fightRow', () => {
  it('names both fighters', () => {
    const html = fightRow(upcoming.fights[0], upcoming);
    expect(html).toContain('Mateusz Gamrot');
    expect(html).toContain('Quillan Salkilld');
  });

  it('shows both records', () => {
    const html = fightRow(upcoming.fights[0], upcoming);
    expect(html).toContain('26-4-0 (1 NC)');
  });

  it('marks the winner of a completed fight', () => {
    const html = fightRow(final.fights[0], final);
    expect(html).toContain('is-win');
  });

  it('shows the method and round on a completed fight', () => {
    const html = fightRow(final.fights[0], final);
    expect(html).toContain('Decision - Unanimous');
    expect(html).toContain('R5');
  });

  it('does not mark a winner on an upcoming fight', () => {
    expect(fightRow(upcoming.fights[0], upcoming)).not.toContain('is-win');
  });

  it('escapes a fighter name containing markup', () => {
    const evil = JSON.parse(JSON.stringify(upcoming.fights[0]));
    evil.red = { ...evil.red, name: '<img src=x onerror=alert(1)>' };
    const html = fightRow(evil, upcoming);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('renderPanel', () => {
  it('renders every fight on the card', () => {
    const html = renderPanel({ event: upcoming });
    expect((html.match(/class="fight-row/g) ?? [])).toHaveLength(12);
  });

  it('groups the card into segments with readable labels', () => {
    const html = renderPanel({ event: upcoming });
    expect(html).toMatch(/class="seg-head"/);
    expect(html).toContain('Main Card');
    expect(html).toContain('Prelims');
  });

  it('shows the event name and venue', () => {
    const html = renderPanel({ event: upcoming });
    expect(html).toContain('Gamrot');
    expect(html).toContain('Meta Apex');
  });

  it('renders an empty state rather than a blank panel', () => {
    expect(renderPanel({ event: null })).toContain('No event');
  });

  it('renders an empty state for an event with no fights', () => {
    expect(renderPanel({ event: { ...upcoming, fights: [] } })).toContain('No fights');
  });
});
