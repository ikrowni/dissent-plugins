// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLeaders } from '../core/espn-league.js';
import { renderLeaders, FEATURED, seasonLabel, leaderBars } from './leaders.js';
import { POSITION_COLORS } from '../core/player-visuals.js';

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

  // ⚠️ ORDER WAS ALREADY TRUE AND CHANGED NOTHING VISIBLE — sixteen identical
  // modules in an auto-fit grid reflow into whatever the width allows, so being
  // "first" is not a position anybody perceives. The assertion is now that the
  // featured six are a different WEIGHT, which is what a reader actually sees.
  it('gives the featured categories their own tier, and only them', () => {
    const el = parse(renderLeaders({ cats }));
    const feat = [...el.querySelectorAll('.ld-feat .mod-head .t')].map((t) => t.textContent);
    expect(feat.length).toBe(FEATURED.length);
    expect(feat[0]).toMatch(/passing yards/i);
    expect(feat.join(' ')).not.toMatch(/punt yards/i);
  });

  it('still renders every category the payload carried, featured or not', () => {
    const el = parse(renderLeaders({ cats }));
    expect(el.querySelectorAll('.ld-cat').length).toBe(cats.length);
    expect(el.querySelectorAll('.ld-cat:not(.ld-feat)').length)
      .toBe(cats.length - FEATURED.length);
    // Every leader in every category, both tiers — hierarchy is weight, not omission.
    const total = cats.reduce((n, c) => n + c.leaders.length, 0);
    expect(el.querySelectorAll('.ld-row').length).toBe(total);
  });

  // ⚠️ A PORTRAIT IS THE FEATURED TIER'S PRIVILEGE. The second tier drops it to
  // stay dense; if it ever starts rendering avatars the two tiers look alike
  // again and the hierarchy is gone.
  it('portrays only the featured leaders', () => {
    const el = parse(renderLeaders({ cats }));
    expect(el.querySelectorAll('.ld-feat .pv-avatar').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.ld-cat:not(.ld-feat) .pv-avatar').length).toBe(0);
  });

  it('gives exactly one hero row per featured category, and none elsewhere', () => {
    const el = parse(renderLeaders({ cats }));
    expect(el.querySelectorAll('.ld-hero').length).toBe(FEATURED.length);
    expect(el.querySelectorAll('.ld-cat:not(.ld-feat) .ld-hero').length).toBe(0);
    for (const cat of el.querySelectorAll('.ld-feat')) {
      expect(cat.querySelectorAll('.ld-hero').length).toBe(1);
      expect(cat.querySelector('.ld-row').classList.contains('ld-hero')).toBe(true);
    }
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
    for (const cat of el.querySelectorAll('.ld-cat')) {
      const ranks = [...cat.querySelectorAll('.ld-rank')].map((s) => s.textContent.trim());
      expect(ranks.length).toBeGreaterThan(0);
      expect(ranks).toEqual(ranks.map((_, i) => String(i + 1)));
    }
  });

  // ⚠️ THE SCALE WAS ABSENT FROM THIS BOARD ENTIRELY. The hub owns a categorical
  // position scale and the leaders tab used none of it, so a category of three
  // names said nothing about who plays what.
  it('carries position colour on every row', () => {
    const el = parse(renderLeaders({ cats }));
    const rows = [...el.querySelectorAll('.ld-row')];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.getAttribute('style')).toMatch(/--pc:\s*\S/);
    expect(el.querySelectorAll('.pv-pos').length).toBe(rows.length);
  });

  // ⚠️ THE CASE THAT USED TO BE COLOURLESS. Six of the sixteen live categories
  // are led by DE / PK / S / CB / P, none of which is a POSITION_COLORS key, so
  // a naive positionColor() call leaves them grey. Asserted against the real
  // fixture rather than a hand-made one.
  it('colours the defensive and special-teams categories too', () => {
    const el = parse(renderLeaders({ cats }));
    const grey = [...el.querySelectorAll('.ld-row')]
      .filter((r) => /--pc:\s*var\(--text-3\)/.test(r.getAttribute('style')));
    expect(grey.length).toBe(0);
    // Sacks is led by a DE; it must read as the defensive-line colour.
    const sacks = [...el.querySelectorAll('.ld-cat')]
      .find((c) => /^sacks$/i.test(c.querySelector('.mod-head .t').textContent));
    expect(sacks.querySelector('.ld-row').getAttribute('style'))
      .toContain(POSITION_COLORS.DL);
  });

  it('draws a share-of-the-leader bar on each row', () => {
    const el = parse(renderLeaders({ cats }));
    const sacks = [...el.querySelectorAll('.ld-cat')]
      .find((c) => /^sacks$/i.test(c.querySelector('.mod-head .t').textContent));
    const widths = [...sacks.querySelectorAll('.ld-bar i')]
      .map((i) => i.getAttribute('style'));
    // 23 · 16.5 · 15 — the leader fills the rail and the others do not.
    expect(widths[0]).toContain('width:100%');
    expect(widths[1]).toContain('width:72%');
    expect(widths[2]).toContain('width:65%');
  });

  // ⚠️ ESPN'S OWN DISPLAY IS LOSSY — 16.5 sacks prints as "16". The bar has to
  // come from the numeric amount, and the printed figure has to stay ESPN's, or
  // the row contradicts the bar beside it.
  it('measures from the numeric amount while printing ESPN’s figure', () => {
    expect(leaderBars([{ amount: 23 }, { amount: 16.5 }])).toEqual([100, 72]);
    const el = parse(renderLeaders({ cats }));
    const sacks = [...el.querySelectorAll('.ld-cat')]
      .find((c) => /^sacks$/i.test(c.querySelector('.mod-head .t').textContent));
    expect([...sacks.querySelectorAll('.ld-val')].map((v) => v.textContent.trim()))
      .toEqual(['23', '16', '15']);
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

  it('renders nothing but the featured tier when the payload has no other category', () => {
    const only = cats.filter((c) => FEATURED.includes(c.key));
    const el = parse(renderLeaders({ cats: only }));
    expect(el.querySelectorAll('.ld-grid-more').length).toBe(0);
    expect(el.textContent).not.toMatch(/more categories/i);
  });
});

describe('leaderBars', () => {
  it('is the share of the biggest number in the category', () => {
    expect(leaderBars([{ amount: 46 }, { amount: 34 }, { amount: 31 }])).toEqual([100, 74, 67]);
  });

  // ⚠️ THE INFORMATION THAT WAS MISSING. Three bare numbers make a runaway and a
  // dead heat look identical; the bars must not.
  it('tells a runaway apart from a dead heat', () => {
    const runaway = leaderBars([{ amount: 46 }, { amount: 34 }, { amount: 31 }]);
    const heat = leaderBars([{ amount: 19 }, { amount: 19 }, { amount: 18 }]);
    expect(runaway[0] - runaway[2]).toBeGreaterThan(25);
    expect(heat[0] - heat[2]).toBeLessThan(10);
  });

  // ⚠️ ALL OR NOTHING. A bar missing from one row reads as "he scored zero".
  it('refuses the whole category rather than drawing a hole in it', () => {
    expect(leaderBars([{ amount: 10 }, { amount: null }, { amount: 4 }])).toBeNull();
    expect(leaderBars([{ amount: 10 }, {}, { amount: 4 }])).toBeNull();
    expect(leaderBars([{ amount: 10 }, { amount: -3 }])).toBeNull();
    expect(leaderBars([{ amount: 0 }, { amount: 0 }])).toBeNull();
    expect(leaderBars([])).toBeNull();
    expect(leaderBars(null)).toBeNull();
  });

  // ⚠️ SCALED TO THE LARGEST, NOT THE FIRST ROW. ESPN ranks these, so the two are
  // normally the same number — trusting the order anyway is what draws a bar
  // wider than the rail it sits in on the day the ordering changes.
  it('never exceeds the rail, even if the list arrives out of order', () => {
    expect(leaderBars([{ amount: 5 }, { amount: 20 }])).toEqual([25, 100]);
  });

  it('renders no bars at all in a category it cannot measure', () => {
    const el = parse(renderLeaders({
      cats: [{ key: 'x', label: 'X', leaders: [{ athleteId: 1, name: 'A B', value: '—' }] }],
    }));
    expect(el.querySelectorAll('.ld-bar').length).toBe(0);
    expect(el.querySelectorAll('.ld-row').length).toBe(1);
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
