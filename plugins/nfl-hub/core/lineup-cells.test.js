// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { byeProjCells, byeProjHead, isOnBye } from './lineup-cells.js';
import { setRanking } from './draft-ranking.js';
import { setWeekProjections, resetProjections } from './weekly-projections.js';
import { PPR_SCORING, HALF_PPR_SCORING } from './league/scoring.js';

const parse = (html) => {
  const t = document.createElement('table');
  t.innerHTML = `<tbody><tr>${html}</tr></tbody>`;
  return t.querySelectorAll('td');
};
const ctx = (over = {}) => ({
  team: 'SF', season: 2026, week: 3, scoring: PPR_SCORING, ...over,
});

beforeEach(() => {
  resetProjections();
  setRanking({ byes: { SF: 8, NE: 3 } });
  setWeekProjections(2026, 3, { 96: { rec: 4, rec_yd: 50, rush_yd: 20 } });
});

// ⚠️ THIS MODULE EXISTS BECAUSE TWO COPIES HAD ALREADY DRIFTED — one rendered
// Proj before Bye and the other the reverse, so the same two columns read in a
// different order depending on the tab.
describe('column order is fixed for every surface', () => {
  it('is always Bye then Proj', () => {
    const cells = parse(byeProjCells('96', ctx()));
    expect(cells[0].classList.contains('bye')).toBe(true);
    expect(cells[1].classList.contains('proj')).toBe(true);
  });

  it('heads the columns in the same order it renders them', () => {
    const h = byeProjHead();
    expect(h.indexOf('>Bye<')).toBeLessThan(h.indexOf('>Proj<'));
  });

  // The tooltip is the contract, and it has drifted from the cells once already.
  it('says the projection is weekly and league-scored', () => {
    const h = byeProjHead();
    expect(h).toMatch(/this week/i);
    expect(h).not.toMatch(/whole season/i);
  });
});

describe('unknown values', () => {
  // 🔴 0 IS A REAL VALUE IN BOTH COLUMNS — a real projection for somebody not
  // expected to play, and week 0 is not a bye. A 0 here is a confident
  // statement that happens to be false.
  it('renders a dash, never a zero', () => {
    const cells = parse(byeProjCells('999', ctx({ team: 'ZZZ' })));
    expect(cells[0].textContent.trim()).toBe('—');
    expect(cells[1].textContent.trim()).toBe('—');
  });

  it('handles a free agent with no NFL team', () => {
    const cells = parse(byeProjCells('96', ctx({ team: null })));
    expect(cells[0].textContent.trim()).toBe('—');
  });

  it('renders a dash when the week is not loaded', () => {
    const cells = parse(byeProjCells('96', ctx({ week: 9 })));
    expect(cells[1].textContent.trim()).toBe('—');
  });
});

describe('the projection follows the league and the week', () => {
  it('scores with the league’s own rules', () => {
    const ppr = parse(byeProjCells('96', ctx()))[1].textContent.trim();
    const half = parse(byeProjCells('96', ctx({ scoring: HALF_PPR_SCORING })))[1].textContent.trim();
    expect(Number(ppr) - Number(half)).toBeCloseTo(2, 5);
  });

  // Browsing a matchup back to week 6 must show week 6's projection.
  it('reads the week it is handed, not a fixed one', () => {
    setWeekProjections(2026, 6, { 96: { rec: 10 } });
    const w3 = parse(byeProjCells('96', ctx({ week: 3 })))[1].textContent.trim();
    const w6 = parse(byeProjCells('96', ctx({ week: 6 })))[1].textContent.trim();
    expect(w3).not.toBe(w6);
  });
});

describe('bye marking', () => {
  it('flags a bye in the week being looked at', () => {
    expect(isOnBye('NE', 3)).toBe(true);
    expect(isOnBye('NE', 4)).toBe(false);
    expect(isOnBye('SF', 3)).toBe(false);
  });

  it('marks the cell, so a 0.00 has a visible explanation', () => {
    const cells = parse(byeProjCells('96', ctx({ team: 'NE', week: 3 })));
    expect(cells[0].classList.contains('on-bye')).toBe(true);
  });

  // A bye already gone by still explains an old zero, so it is dimmed, not hidden.
  it('dims a bye that has passed rather than hiding it', () => {
    const cells = parse(byeProjCells('96', ctx({ team: 'NE', week: 5 })));
    expect(cells[0].textContent.trim()).toBe('3');
    expect(cells[0].classList.contains('past')).toBe(true);
  });

  it('is not fooled by a week that is not a number', () => {
    expect(isOnBye('NE', null)).toBe(false);
    expect(isOnBye('NE', 'three')).toBe(false);
  });
});
