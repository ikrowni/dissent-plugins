// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseStandings } from '../core/espn-league.js';
import { renderStandings, seedGroups } from './standings.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const table = parseStandings(JSON.parse(readFileSync(join(FIXTURES, 'standings.json'), 'utf8')));
const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('seedGroups', () => {
  it('splits a conference into seeds 1-7, in the hunt, and the rest', () => {
    const g = seedGroups(table, 'AFC');
    expect(g.seeded).toHaveLength(7);
    expect(g.seeded[0].seed).toBeLessThanOrEqual(g.seeded[6].seed);
    expect(g.seeded.length + g.hunt.length + g.out.length).toBe(16);
  });

  it('never puts the same team in two groups', () => {
    const g = seedGroups(table, 'NFC');
    const all = [...g.seeded, ...g.hunt, ...g.out].map((r) => r.abbr);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the two conferences disjoint', () => {
    const afc = seedGroups(table, 'AFC').seeded.map((r) => r.abbr);
    const nfc = seedGroups(table, 'NFC').seeded.map((r) => r.abbr);
    expect(afc.filter((a) => nfc.includes(a))).toEqual([]);
  });

  it('returns empty groups for an unknown conference rather than throwing', () => {
    expect(seedGroups(table, 'XFC').seeded).toEqual([]);
    expect(seedGroups(null, 'AFC').seeded).toEqual([]);
  });
});

describe('renderStandings', () => {
  it('renders a loading and an error state', () => {
    expect(parse(renderStandings({ loading: true })).querySelector('.spinner')).not.toBeNull();
    expect(parse(renderStandings({ error: 'x' })).querySelector('[data-act="retry"]')).not.toBeNull();
  });

  it('renders eight division tables from the real fixture', () => {
    const el = parse(renderStandings({ table }));
    expect(el.querySelectorAll('table.grid').length).toBeGreaterThanOrEqual(8);
  });

  it('makes every team clickable so it can drill into a team page', () => {
    const el = parse(renderStandings({ table }));
    const btns = el.querySelectorAll('[data-act="team"]');
    expect(btns.length).toBeGreaterThanOrEqual(32);
    expect(btns[0].dataset.team).toMatch(/^[A-Z]{2,3}$/);
  });

  it('uses local logos only', () => {
    const el = parse(renderStandings({ table }));
    const imgs = [...el.querySelectorAll('img')];
    expect(imgs.length).toBeGreaterThan(30);
    for (const img of imgs) expect(img.getAttribute('src')).not.toContain('espncdn');
  });

  it('renders the playoff picture with both conferences', () => {
    const txt = parse(renderStandings({ table })).textContent;
    expect(txt).toMatch(/AFC playoff picture/);
    expect(txt).toMatch(/NFC playoff picture/);
    expect(txt).toMatch(/Seeded/);
  });

  it('renders an empty state when standings are unavailable', () => {
    expect(parse(renderStandings({ table: {} })).textContent).toMatch(/not available/i);
  });

  it('renders a dash for a missing column rather than undefined', () => {
    const el = parse(renderStandings({
      table: { 'AFC East': [{ abbr: 'BUF', logo: 'l/buf.png', wins: 1, losses: 0, seed: 1 }] },
    }));
    expect(el.textContent).not.toContain('undefined');
  });
});

// ── Out of season ───────────────────────────────────────────────────────────
//
// ⚠️ ESPN PUBLISHES playoffSeed IN PRESEASON TOO. It is division order, not a
// standing — every team is 0-0 and nothing has been played. Rendering it as a
// "Playoff picture" with seeds #1–#7 presents that ordering as information, and
// a reader has no way to tell it apart from a real one. `views/league-home.js`
// already learned this for the fantasy table ("a column of 0-0 before anyone has
// played looks like a played season in which everybody drew"); the NFL standings
// tab did not, and in August it is what the tab opens on.
describe('the standings tab before a season starts', () => {
  const zeroed = (t) => Object.fromEntries(Object.entries(t).map(([div, rows]) => [
    div, rows.map((r) => ({ ...r, wins: 0, losses: 0, ties: 0, record: '0-0' })),
  ]));

  it('draws no playoff picture when nobody has played', () => {
    const html = renderStandings({ loading: false, error: null, table: zeroed(table) });
    // ⚠️ Assert the STRUCTURE, not the phrase — the replacement copy explains
    // that there is no playoff picture yet, so a substring check on those two
    // words matches the very text that proves the fix worked.
    expect(html).not.toContain('AFC playoff picture');
    expect(html).not.toContain('NFC playoff picture');
    expect(html).not.toMatch(/#1<\/span>/);
  });

  it('says so, rather than silently dropping the panel', () => {
    const html = renderStandings({ loading: false, error: null, table: zeroed(table) });
    expect(html).toMatch(/season has not started|no games have been played/i);
  });

  // The division tables are the league's structure and are honest at 0-0.
  it('still shows the divisions', () => {
    const html = renderStandings({ loading: false, error: null, table: zeroed(table) });
    expect(html).toMatch(/AFC|NFC/);
  });

  it('restores the playoff picture as soon as one game has been played', () => {
    const t = zeroed(table);
    const firstDiv = Object.keys(t)[0];
    t[firstDiv][0] = { ...t[firstDiv][0], wins: 1, record: '1-0' };
    expect(renderStandings({ loading: false, error: null, table: t })).toContain('playoff picture');
  });
});
