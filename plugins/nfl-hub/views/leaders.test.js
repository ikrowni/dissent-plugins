// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLeaders } from '../core/espn-league.js';
import { renderLeaders, FEATURED, seasonLabel} from './leaders.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const cats = parseLeaders(JSON.parse(readFileSync(join(FIXTURES, 'leaders.json'), 'utf8')));
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('renderLeaders', () => {
  it('renders loading and error states', () => {
    expect(parse(renderLeaders({ loading: true })).querySelector('.spinner')).not.toBeNull();
    expect(parse(renderLeaders({ error: 'x' })).querySelector('[data-act="retry"]')).not.toBeNull();
  });

  it('renders one panel per category from the real fixture', () => {
    const el = parse(renderLeaders({ cats }));
    expect(el.querySelectorAll('.mod').length).toBe(cats.length);
  });

  it('puts a featured category first', () => {
    const el = parse(renderLeaders({ cats }));
    const titles = [...el.querySelectorAll('.mod-head .t')].map((t) => t.textContent);
    const idx = titles.findIndex((t) => /passing yards/i.test(t));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(3);
  });

  it('never renders a raw espncdn headshot url', () => {
    const el = parse(renderLeaders({ cats }));
    for (const img of el.querySelectorAll('img')) {
      expect(img.getAttribute('src')).not.toMatch(/^https:\/\/a\.espncdn\.com\/i\/headshots/);
    }
  });

  it('makes each leader clickable into a player page', () => {
    const el = parse(renderLeaders({ cats }));
    const b = el.querySelector('[data-act="player"]');
    expect(b).not.toBeNull();
    expect(b.dataset.player).toMatch(/^\d+$/);
  });

  it('numbers the leaders 1..n within each category', () => {
    const el = parse(renderLeaders({ cats }));
    const first = el.querySelector('.mod-body');
    const ranks = [...first.querySelectorAll('.sb-row > .sb-meta:first-child')]
      .map((s) => s.textContent);
    expect(ranks.length).toBeGreaterThan(0);
    expect(ranks).toEqual(ranks.map((_, i) => String(i + 1)));
  });

  it('renders an empty state when no categories came back', () => {
    expect(parse(renderLeaders({ cats: [] })).textContent).toMatch(/not available/i);
  });

  it('escapes hostile leader names', () => {
    const el = parse(renderLeaders({
      cats: [{ key: 'x', label: 'X', leaders: [{ athleteId: 1, name: '<script>a</script>', value: '1' }] }],
    }));
    expect(el.querySelector('script')).toBeNull();
  });

  it('exports a featured order that is a non-empty list of category keys', () => {
    expect(Array.isArray(FEATURED)).toBe(true);
    expect(FEATURED.length).toBeGreaterThan(3);
  });
});

describe('seasonLabel', () => {
  it('says nothing when the numbers are from the season in progress', () => {
    expect(seasonLabel({ year: 2026, name: 'Regular Season', isCurrent: true })).toBe('2026 · ');
  });

  // ⚠️ THE CASE THAT MATTERS. In August this endpoint answers with last season's
  // finals; unlabelled, they read as the current race.
  it('marks last season’s numbers as final', () => {
    expect(seasonLabel({ year: 2025, name: 'Regular Season', isCurrent: false }))
      .toBe('2025 regular season · final · ');
  });

  it('renders nothing when the season is unknown', () => {
    expect(seasonLabel(null)).toBe('');
    expect(seasonLabel({ year: null })).toBe('');
  });
});

describe('the leaders panel head', () => {
  it('carries the season into the rendered panel', () => {
    const html = renderLeaders({
      loading: false, error: null, season: { year: 2025, name: 'Regular Season', isCurrent: false },
      cats: [{ name: 'Passing Yards', leaders: [{ athleteId: 1, name: 'A B', value: '4707', teamAbbr: 'LAR', position: 'QB' }] }],
    });
    expect(html).toContain('2025 regular season · final');
  });
});
