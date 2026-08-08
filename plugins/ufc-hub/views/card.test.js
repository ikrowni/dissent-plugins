import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEvent } from '../core/ufc-cloudfront.js';
import { renderPanel, fightRow } from './card.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const upcoming = parseEvent(fx('cf-event-upcoming.json'));
const final = parseEvent(fx('cf-event-final.json'));
const none = new Map();

describe('fightRow', () => {
  it('names both fighters', () => {
    const html = fightRow(upcoming.fights[0], upcoming, none);
    expect(html).toContain('Mateusz');
    expect(html).toContain('Gamrot');
    expect(html).toContain('Quillan');
    expect(html).toContain('Salkilld');
  });

  it('shows both records', () => {
    const html = fightRow(upcoming.fights[0], upcoming, none);
    expect(html).toContain('26-4-0 (1 NC)');
  });

  it('marks the winner of a completed fight', () => {
    const html = fightRow(final.fights[0], final, none);
    expect(html).toContain('is-win');
  });

  it('shows the method and round on a completed fight', () => {
    const html = fightRow(final.fights[0], final, none);
    expect(html).toContain('Decision - Unanimous');
    expect(html).toContain('R5');
  });

  it('does not mark a winner on an upcoming fight', () => {
    expect(fightRow(upcoming.fights[0], upcoming, none)).not.toContain('is-win');
  });

  it('renders NO result line on an upcoming fight', () => {
    // ⚠️ REGRESSION GUARD. CloudFront emits a Result key on every fight, so
    // `fight.result` is truthy even when hollow. 1.0.0 tested it directly and put an
    // empty <div class="fresult"> on all 12 scheduled bouts.
    expect(upcoming.fights[0].result).toBeTruthy();
    expect(fightRow(upcoming.fights[0], upcoming, none)).not.toContain('fresult');
  });

  it('escapes a fighter name containing markup', () => {
    const evil = JSON.parse(JSON.stringify(upcoming.fights[0]));
    evil.red = { ...evil.red, lastName: '<img src=x onerror=alert(1)>' };
    const html = fightRow(evil, upcoming, none);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('routes the headshot through the node image proxy', () => {
    // ⚠️ THIS IS THE ASSERTION THAT MATTERS, and its absence shipped a broken build.
    // The raw espncdn URL appears in BOTH the proxied and unproxied output, so
    // asserting on it passes even when the plugin CSP is blocking every image. Assert
    // on the proxy path instead.
    const athletes = new Map([[upcoming.fights[0].red.fighterId, { espnId: '3068125' }]]);
    const html = fightRow(upcoming.fights[0], upcoming, athletes);
    expect(html).toContain('/api/v1/plugins/image?url=');
    expect(html).toContain(encodeURIComponent(
      'https://a.espncdn.com/i/headshots/mma/players/full/3068125.png'));
    expect(html).not.toContain('src="https://a.espncdn.com');
  });

  it('routes the country flag through the proxy too', () => {
    const athletes = new Map([[upcoming.fights[0].red.fighterId,
      { espnId: '1', flag: 'https://a.espncdn.com/i/teamlogos/countries/500/pol.png' }]]);
    const html = fightRow(upcoming.fights[0], upcoming, athletes);
    expect(html).not.toContain('src="https://a.espncdn.com');
    expect(html).toContain(encodeURIComponent('countries/500/pol.png'));
  });

  it('renders without a mug when the join is empty', () => {
    const html = fightRow(upcoming.fights[0], upcoming, none);
    expect(html).toContain('fight-row');
    expect(html).not.toContain('/api/v1/plugins/image');
  });

  it('marks a fight collapsed by default and carries its id', () => {
    const html = fightRow(upcoming.fights[0], upcoming, none);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`data-fight="${upcoming.fights[0].fightId}"`);
    expect(html).toContain('data-act="fight"');
  });
});

describe('renderPanel', () => {
  it('renders every fight on the card', () => {
    const html = renderPanel({ event: upcoming, athletes: none });
    expect((html.match(/class="fight-row/g) ?? [])).toHaveLength(12);
  });

  it('groups the card into segments with readable labels', () => {
    const html = renderPanel({ event: upcoming, athletes: none });
    expect(html).toMatch(/class="seg-head"/);
    expect(html).toContain('Main Card');
    expect(html).toContain('Prelims');
  });

  it('keeps the main card above the prelims', () => {
    const html = renderPanel({ event: upcoming, athletes: none });
    expect(html.indexOf('Main Card')).toBeLessThan(html.indexOf('Prelims'));
  });

  it('shows the event name and venue', () => {
    const html = renderPanel({ event: upcoming, athletes: none });
    expect(html).toContain('Gamrot');
    expect(html).toContain('Meta Apex');
  });

  it('distinguishes two fighters who share a last name', () => {
    // ⚠️ This card carries BOTH Ty Miller and Juliana Miller. A row showing only the
    // last name renders two different people identically.
    const html = renderPanel({ event: upcoming, athletes: none });
    expect(html).toContain('Ty');
    expect(html).toContain('Juliana');
  });

  it('expands exactly the fight in openFight', () => {
    const open = upcoming.fights[1].fightId;
    const html = renderPanel({ event: upcoming, athletes: none, openFight: open });
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html).toContain('Tale of the tape');
  });

  it('renders no versus body when nothing is open', () => {
    const html = renderPanel({ event: upcoming, athletes: none });
    expect(html).not.toContain('Tale of the tape');
  });

  it('renders an empty state rather than a blank panel', () => {
    expect(renderPanel({ event: null })).toContain('No event');
  });

  it('renders an empty state for an event with no fights', () => {
    expect(renderPanel({ event: { ...upcoming, fights: [] } })).toContain('No fights');
  });
});
