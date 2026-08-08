// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseProbabilities } from '../core/espn-game.js';
import { wpPath, renderWinProb } from './game-winprob.js';

// fileURLToPath rather than a URL object: under jsdom the global URL is jsdom's and
// node:fs does not recognise it as a file URL.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const wp = parseProbabilities(JSON.parse(
  readFileSync(join(FIXTURES, 'probabilities-dalphi.json'), 'utf8'),
));

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const teams = { home: { abbr: 'PHI', primary: '#06424d' }, away: { abbr: 'DAL', primary: '#002a5c' } };

describe('wpPath', () => {
  it('emits one point per sample', () => {
    const pts = wpPath([{ homePct: 50 }, { homePct: 60 }, { homePct: 40 }], 100, 40)
      .trim().split(/\s+/);
    expect(pts).toHaveLength(3);
  });

  it('maps 100% home to the top and 0% to the bottom', () => {
    const [a, b] = wpPath([{ homePct: 100 }, { homePct: 0 }], 100, 40).trim().split(/\s+/);
    expect(Number(a.split(',')[1])).toBe(0);
    expect(Number(b.split(',')[1])).toBe(40);
  });

  it('clamps a value outside 0-100 rather than drawing off-canvas', () => {
    const [a, b] = wpPath([{ homePct: 140 }, { homePct: -20 }], 100, 40).trim().split(/\s+/);
    expect(Number(a.split(',')[1])).toBe(0);
    expect(Number(b.split(',')[1])).toBe(40);
  });

  it('never emits NaN', () => {
    expect(wpPath([{ homePct: 50 }], 100, 40)).not.toContain('NaN');
    expect(wpPath([{ homePct: null }], 100, 40)).not.toContain('NaN');
    expect(wpPath([], 100, 40)).toBe('');
    expect(wpPath(null, 100, 40)).toBe('');
  });

  it('rounds coordinates to keep the markup small', () => {
    expect(wpPath(wp, 600, 120)).not.toMatch(/\.\d{3,}/);
  });
});

describe('renderWinProb', () => {
  it('renders an svg with the real 164-sample series', () => {
    const el = parse(renderWinProb(wp, teams));
    expect(el.querySelector('svg')).not.toBeNull();
    const pts = el.querySelector('polyline').getAttribute('points').trim().split(/\s+/);
    expect(pts).toHaveLength(164);
  });

  it('draws a 50% midline so the swing is readable', () => {
    expect(parse(renderWinProb(wp, teams)).querySelector('line.mid')).not.toBeNull();
  });

  it('labels both teams', () => {
    const txt = parse(renderWinProb(wp, teams)).textContent;
    expect(txt).toContain('PHI');
    expect(txt).toContain('DAL');
  });

  it('marks scoring plays when given them', () => {
    const el = parse(renderWinProb(wp, teams, { scoringSeqs: [wp[10].seq, wp[40].seq] }));
    expect(el.querySelectorAll('circle.score-mark')).toHaveLength(2);
  });

  it('ignores a scoring seq with no matching sample', () => {
    const el = parse(renderWinProb(wp, teams, { scoringSeqs: [999999999] }));
    expect(el.querySelectorAll('circle.score-mark')).toHaveLength(0);
  });

  it('renders an empty state before any samples exist', () => {
    expect(parse(renderWinProb([], teams)).textContent).toMatch(/not available/i);
    expect(parse(renderWinProb(null, teams)).textContent).toMatch(/not available/i);
  });

  it('is aria-hidden on the chart itself, with a text summary for readers', () => {
    const el = parse(renderWinProb(wp, teams));
    expect(el.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.sr-only')).not.toBeNull();
  });

  it('survives missing team metadata rather than throwing', () => {
    expect(() => renderWinProb(wp, null)).not.toThrow();
  });
});
