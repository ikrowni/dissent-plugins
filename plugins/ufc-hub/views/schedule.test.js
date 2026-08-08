import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderPanel } from './schedule.js';
import { parseMonthIndex } from '../core/ufc-espn.js';

const events = parseMonthIndex(JSON.parse(readFileSync(
  new URL('../tests/fixtures/espn-month-202608.json', import.meta.url), 'utf8')));

const html = (over = {}) => renderPanel({ monthKey: '202608', events, ...over });

describe('renderPanel', () => {
  it('names the month and offers both directions', () => {
    const out = html();
    expect(out).toContain('August 2026');
    expect(out).toContain('data-delta="-1"');
    expect(out).toContain('data-delta="1"');
  });

  it('lists every event in the month', () => {
    expect(html().match(/data-act="pick-event"/g)).toHaveLength(events.length);
  });

  it('includes DWCS cards, which are events too', () => {
    // ⚠️ The old plugin's index dropped every DWCS and Road To UFC card, because it
    // joined on name and those names disagree between sources. They belong here.
    expect(html()).toContain('Contender Series');
  });

  it('carries each event id, so a click can select it', () => {
    expect(html()).toContain(`data-event="${events[0].id}"`);
  });

  it('marks the currently selected event', () => {
    const out = html({ selectedId: events[1].id });
    expect(out.match(/is-open/g)).toHaveLength(1);
  });

  it('shows an empty month as empty, not as an error', () => {
    // The UFC does not run every week; a blank month is normal.
    const out = renderPanel({ monthKey: '202612', events: [] });
    expect(out).toContain('No events this month');
    expect(out).toContain('December 2026');
  });

  it('shows a spinner while loading rather than a blank panel', () => {
    expect(html({ loading: true })).toContain('spinner');
  });

  it('escapes an event name containing markup', () => {
    const evil = [{ ...events[0], name: '<img src=x onerror=alert(1)>' }];
    const out = renderPanel({ monthKey: '202608', events: evil });
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });

  it('never throws on nothing', () => {
    expect(() => renderPanel({})).not.toThrow();
    expect(() => renderPanel(null)).not.toThrow();
  });
});
