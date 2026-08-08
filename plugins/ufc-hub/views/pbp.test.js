import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderPbp, groupRounds } from './pbp.js';
import { parseEvent } from '../core/ufc-cloudfront.js';
import { parseTracking } from '../core/fight-timeline.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const final = parseEvent(fx('cf-event-final.json'));
const events = parseTracking(final.fights[0].tracking);

describe('groupRounds', () => {
  it('splits round-less actions into before and after the fight', () => {
    // Walkouts and the staredown carry no round; so do the result and the
    // unofficial winner. A plain `round || 0` bucket puts the closing ones in
    // "before the bell", which reads as nonsense.
    const groups = groupRounds(events);
    const pre = groups.find((g) => g.key === 'pre');
    const post = groups.find((g) => g.key === 'post');
    expect(pre.actions.some((a) => a.type === 'walkout')).toBe(true);
    expect(post.actions.some((a) => a.type === 'results')).toBe(true);
    expect(pre.actions.some((a) => a.type === 'results')).toBe(false);
  });

  it('orders rounds ascending for a finished fight', () => {
    const nums = groupRounds(events).map((g) => g.key).filter((k) => typeof k === 'number');
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  it('orders rounds newest-first when the fight is live', () => {
    const nums = groupRounds(events, { newestFirst: true })
      .map((g) => g.key).filter((k) => typeof k === 'number');
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
  });

  it('never throws on nothing', () => {
    expect(groupRounds([])).toEqual([]);
    expect(groupRounds(null)).toEqual([]);
  });
});

describe('renderPbp', () => {
  const names = { 3599: 'Du Plessis', 2587: 'Usman' };

  it('labels an action and attributes it to a fighter', () => {
    const html = renderPbp(events, names);
    expect(html).toContain('Takedown attempt');
    expect(html).toContain('Usman');
  });

  it('escapes a hostile fighter name', () => {
    const html = renderPbp(events, { 2587: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('renders nothing for an empty feed', () => {
    expect(renderPbp([], {})).toBe('');
  });
});
