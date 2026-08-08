import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEvent } from '../core/ufc-cloudfront.js';
import { parseTracking } from '../core/fight-timeline.js';
import { renderPanel, actionLabel } from './timeline.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const final = parseEvent(fx('cf-event-final.json'));
const fight = final.fights[0];
const events = parseTracking(fight.tracking);
const names = { [fight.red.fighterId]: fight.red.name, [fight.blue.fighterId]: fight.blue.name };

describe('actionLabel', () => {
  it('gives a human label for each tracked action', () => {
    expect(actionLabel('knockdown')).toBe('Knockdown');
    expect(actionLabel('takedown')).toBe('Takedown');
    expect(actionLabel('takedown_attempt')).toBe('Takedown attempt');
    expect(actionLabel('submission_attempt')).toBe('Submission attempt');
  });

  it('falls back to a readable form for an unknown action', () => {
    expect(actionLabel('some_new_thing')).toBe('Some new thing');
  });
});

describe('renderPanel', () => {
  it('renders a round block per round', () => {
    const html = renderPanel({ events, fighterNames: names });
    expect(html).toMatch(/class="tl-round"/);
  });

  it('names the fighter who performed each action', () => {
    const html = renderPanel({ events, fighterNames: names });
    expect(html).toContain(fight.red.name);
  });

  it('shows derived action counts for both fighters', () => {
    const html = renderPanel({ events, fighterNames: names });
    expect(html).toMatch(/class="tl-counts"/);
  });

  it('labels the counts as tracked actions, never as official stats', () => {
    const html = renderPanel({ events, fighterNames: names });
    expect(html).toMatch(/[Tt]racked/);
    expect(html).not.toMatch(/significant strikes/i);
  });

  it('escapes a fighter name containing markup', () => {
    const html = renderPanel({
      events, fighterNames: { [fight.red.fighterId]: '<script>x</script>' },
    });
    expect(html).not.toContain('<script>x');
  });

  it('renders an empty state rather than a blank panel', () => {
    expect(renderPanel({ events: [] })).toContain('No play-by-play');
  });
});
