// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTeamStats, renderComparison, renderBoxScore } from './game-box.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const summary = JSON.parse(readFileSync(join(FIXTURES, 'summary-dalphi.json'), 'utf8'));

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const teams = {
  home: { abbr: 'PHI', primary: '#06424d' },
  away: { abbr: 'DAL', primary: '#002a5c' },
};

describe('parseTeamStats', () => {
  it('pulls a comparable stat set from the real summary fixture', () => {
    const out = parseTeamStats(summary);
    expect(out.length).toBeGreaterThan(4);
    for (const row of out) {
      expect(typeof row.label).toBe('string');
      expect(row).toHaveProperty('home');
      expect(row).toHaveProperty('away');
    }
  });

  it('includes the broadcast staples', () => {
    const labels = parseTeamStats(summary).map((r) => r.label);
    expect(labels).toContain('Total yards');
    expect(labels).toContain('First downs');
    expect(labels).toContain('Turnovers');
    expect(labels).toContain('Time of poss.');
  });

  it('keys sides on homeAway rather than array order', () => {
    // The fixture lists DAL (the away team) first. Flipping the array must not flip
    // which side each stat is attributed to.
    const flipped = structuredClone(summary);
    flipped.boxscore.teams.reverse();
    expect(parseTeamStats(flipped)).toEqual(parseTeamStats(summary));
  });

  it('returns an empty array rather than throwing on junk', () => {
    expect(parseTeamStats(null)).toEqual([]);
    expect(parseTeamStats({})).toEqual([]);
    expect(parseTeamStats({ boxscore: { teams: [] } })).toEqual([]);
  });
});

describe('renderComparison', () => {
  it('renders one row per stat', () => {
    const rows = [
      { label: 'Total yards', home: 300, away: 100 },
      { label: 'Turnovers', home: 1, away: 2 },
    ];
    expect(parse(renderComparison(rows, teams)).querySelectorAll('.cmp-row')).toHaveLength(2);
  });

  it('renders the real fixture stats', () => {
    const el = parse(renderComparison(parseTeamStats(summary), teams));
    expect(el.querySelectorAll('.cmp-row').length).toBeGreaterThan(4);
  });

  it('renders an empty state when there are no stats yet', () => {
    expect(parse(renderComparison([], teams)).textContent).toMatch(/not available/i);
    expect(parse(renderComparison(null, teams)).textContent).toMatch(/not available/i);
  });

  it('handles non-numeric stat values without emitting NaN', () => {
    const el = parse(renderComparison([{ label: 'TOP', home: '18:04', away: '11:56' }], teams));
    expect(el.innerHTML).not.toContain('NaN');
    expect(el.textContent).toContain('18:04');
  });
});

describe('renderBoxScore', () => {
  it('renders a table per statistical category from the real fixture', () => {
    const el = parse(renderBoxScore(summary));
    expect(el.querySelectorAll('table.grid').length).toBeGreaterThan(2);
  });

  it('labels each table with its team and category', () => {
    const el = parse(renderBoxScore(summary));
    const kickers = [...el.querySelectorAll('.kicker')].map((k) => k.textContent);
    expect(kickers.some((k) => /DAL/.test(k))).toBe(true);
    expect(kickers.some((k) => /passing/i.test(k))).toBe(true);
  });

  it('renders a header cell per stat label', () => {
    const el = parse(renderBoxScore(summary));
    const t = el.querySelector('table.grid');
    // One "Player" column plus one per label.
    expect(t.querySelectorAll('thead th').length).toBeGreaterThan(1);
  });

  it('renders an empty state before a game starts', () => {
    expect(parse(renderBoxScore({})).textContent).toMatch(/no box score/i);
    expect(parse(renderBoxScore(null)).textContent).toMatch(/no box score/i);
  });

  it('skips a category with no athletes rather than emitting an empty table', () => {
    const el = parse(renderBoxScore({
      boxscore: { players: [{
        team: { abbreviation: 'DAL' },
        statistics: [{ name: 'passing', labels: ['YDS'], athletes: [] }],
      }] },
    }));
    expect(el.querySelector('table.grid')).toBeNull();
    expect(el.textContent).toMatch(/no box score/i);
  });

  it('escapes player names', () => {
    const el = parse(renderBoxScore({
      boxscore: { players: [{
        team: { abbreviation: 'DAL' },
        statistics: [{ name: 'passing', labels: ['YDS'],
          athletes: [{ athlete: { displayName: '<script>x</script>' }, stats: ['1'] }] }],
      }] },
    }));
    expect(el.querySelector('script')).toBeNull();
  });
});
