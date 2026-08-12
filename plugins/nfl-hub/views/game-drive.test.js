// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDrives, parsePlays } from '../core/espn-game.js';
import { driveClass, renderDriveChart, renderPlayByPlay } from './game-drive.js';

// fileURLToPath rather than passing a URL straight to readFileSync: under the jsdom
// environment the global URL is jsdom's, which node:fs does not recognise as a file
// URL, and the path silently loses its origin.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const fx = (n) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));
const drives = parseDrives(fx('drives-dalphi.json'));
const plays = parsePlays(fx('plays-dalphi.json'));

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('driveClass', () => {
  it('maps scoring outcomes to their own colours', () => {
    expect(driveClass({ result: 'TD' })).toBe('td');
    expect(driveClass({ result: 'FG' })).toBe('fg');
  });
  it('maps punts and turnovers', () => {
    expect(driveClass({ result: 'PUNT' })).toBe('punt');
    expect(driveClass({ result: 'INT' })).toBe('turnover');
    expect(driveClass({ result: 'FUMBLE' })).toBe('turnover');
    expect(driveClass({ result: 'DOWNS' })).toBe('turnover');
  });
  it('maps end-of-half and unknown to a neutral block', () => {
    expect(driveClass({ result: 'END OF HALF' })).toBe('end');
    expect(driveClass({ result: null })).toBe('end');
    expect(driveClass({})).toBe('end');
  });
  it('is case insensitive, since ESPN is inconsistent', () => {
    expect(driveClass({ result: 'td' })).toBe('td');
    expect(driveClass({ result: 'Punt' })).toBe('punt');
  });
  it('classifies every drive in the real fixture into a known bucket', () => {
    const known = new Set(['td', 'fg', 'punt', 'turnover', 'end']);
    for (const d of drives) expect(known.has(driveClass(d))).toBe(true);
  });
});

describe('renderDriveChart', () => {
  it('renders one block per drive from the real fixture', () => {
    const el = parse(renderDriveChart(drives));
    expect(el.querySelectorAll('.drives button')).toHaveLength(16);
  });

  it('labels each block for accessibility and delegation', () => {
    const el = parse(renderDriveChart(drives));
    const b = el.querySelector('.drives button');
    expect(b.dataset.act).toBe('drive');
    expect(b.dataset.drive).toBe(drives[0].id);
    expect(b.getAttribute('aria-label')).toBeTruthy();
  });

  it('marks the selected drive, and only one', () => {
    const el = parse(renderDriveChart(drives, { selectedId: drives[2].id }));
    const cur = el.querySelectorAll('[aria-current="true"]');
    expect(cur).toHaveLength(1);
    expect(cur[0].dataset.drive).toBe(drives[2].id);
  });

  it('includes a legend, because the colours are otherwise meaningless', () => {
    const el = parse(renderDriveChart(drives));
    expect(el.querySelector('.drive-legend')).not.toBeNull();
    expect(el.querySelectorAll('.drive-legend i').length).toBeGreaterThanOrEqual(5);
  });

  it('renders an empty state for no drives', () => {
    expect(parse(renderDriveChart([])).textContent).toMatch(/no drives/i);
    expect(parse(renderDriveChart(null)).textContent).toMatch(/no drives/i);
  });

  it('escapes hostile drive text', () => {
    const el = parse(renderDriveChart([
      { id: 'x', result: 'TD', resultText: '<script>a</script>', description: 'd', teamAbbr: 'KC' },
    ]));
    expect(el.querySelector('script')).toBeNull();
  });
});

describe('renderPlayByPlay', () => {
  it('renders newest first, matching the parser order', () => {
    const el = parse(renderPlayByPlay(plays.slice(0, 5)));
    const rows = el.querySelectorAll('.pbp .row');
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain(plays[0].clock);
  });

  it('badges a scoring play', () => {
    const scoring = plays.find((p) => p.scoring);
    const el = parse(renderPlayByPlay([scoring]));
    expect(el.querySelector('.row.score')).not.toBeNull();
    expect(el.querySelector('.tag')).not.toBeNull();
  });

  it('marks a turnover distinctly from a score', () => {
    const el = parse(renderPlayByPlay([
      { id: 't', seq: 1, clock: '1:00', period: 2, text: 'intercepted', scoring: false, isTurnover: true },
    ]));
    expect(el.querySelector('.row.turnover')).not.toBeNull();
    expect(el.querySelector('.row.score')).toBeNull();
  });

  it('caps how many plays it renders, so a full game does not paint 171 rows', () => {
    const el = parse(renderPlayByPlay(plays, { limit: 12 }));
    expect(el.querySelectorAll('.pbp .row')).toHaveLength(12);
  });

  it('reports how many of the total it is showing', () => {
    expect(parse(renderPlayByPlay(plays, { limit: 12 })).textContent).toContain('12 of 171');
  });

  it('escapes play text', () => {
    const el = parse(renderPlayByPlay([
      { id: 'x', seq: 1, clock: '1:00', period: 1, text: '<script>x</script>' },
    ]));
    expect(el.querySelector('script')).toBeNull();
  });

  it('renders an empty state for no plays', () => {
    expect(parse(renderPlayByPlay([])).textContent).toMatch(/no plays/i);
    expect(parse(renderPlayByPlay(null)).textContent).toMatch(/no plays/i);
  });

  // ⚠️ POSSESSION WAS THE MISSING HALF OF THIS CHART. The fill is the OUTCOME and
  // stays the primary encoding — but without knowing whose drive it was, a run of
  // three scores reads as one team pulling away when it may be two teams trading.
  // Alternation gives possession away for free right up until a turnover on downs,
  // which is exactly when it matters.
  it('carries the possessing team as a colour, without touching the outcome fill', () => {
    const el = parse(renderDriveChart([
      { id: 'a', result: 'TD', teamAbbr: 'PHI' },
      { id: 'b', result: 'PUNT', teamAbbr: 'DAL' },
    ]));
    const [a, b] = el.querySelectorAll('.drives button');
    expect(a.getAttribute('style')).toMatch(/--dt:\s*#[0-9a-f]{6}/i);
    expect(a.getAttribute('style')).not.toBe(b.getAttribute('style'));
    // The class is still the outcome. Recolouring the block by team would replace
    // the encoding this chart exists for.
    expect(a.className).toBe('td');
    expect(b.className).toBe('punt');
  });

  // ⚠️ A drive with no team must not emit `--dt:` pointing at nothing — that would
  // paint the rail in the fallback grey and assert a possession we do not know.
  it('omits the possession colour rather than guessing one', () => {
    const el = parse(renderDriveChart([{ id: 'a', result: 'TD', teamAbbr: null }]));
    expect(el.querySelector('.drives button').getAttribute('style')).toBeNull();
  });
});
