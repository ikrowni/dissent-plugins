// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderGame, renderReplayBar } from './game.js';

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

const base = {
  loading: false, error: null,
  game: {
    id: '9', state: 'in', period: 3, clock: '7:42',
    home: { abbr: 'PHI', score: 17, logo: 'nfl-hub/assets/logos/phi.png', primary: '#06424d' },
    away: { abbr: 'DAL', score: 24, logo: 'nfl-hub/assets/logos/dal.png', primary: '#002a5c' },
  },
  plays: [], drives: [], winProb: [], summary: {},
};

describe('renderGame', () => {
  it('renders a loading state', () => {
    expect(parse(renderGame({ loading: true })).querySelector('.spinner')).not.toBeNull();
  });

  it('prompts for a game when none is selected', () => {
    const el = parse(renderGame({ loading: false, game: null }));
    expect(el.textContent).toMatch(/choose a game/i);
  });

  it('renders an error state with retry', () => {
    expect(parse(renderGame({ error: 'x' })).querySelector('[data-act="retry"]')).not.toBeNull();
  });

  it('renders the hero plus every panel once a game is loaded', () => {
    const el = parse(renderGame(base));
    expect(el.querySelector('.hero')).not.toBeNull();
    const titles = [...el.querySelectorAll('.mod-head .t')].map((t) => t.textContent);
    expect(titles).toContain('Drive chart');
    expect(titles).toContain('Play by play');
    expect(titles).toContain('Win probability');
    expect(titles).toContain('Team comparison');
    expect(titles).toContain('Box score');
  });

  it('includes a back control so the user is not trapped', () => {
    expect(parse(renderGame(base)).querySelector('[data-act="nav"][data-view="league"]'))
      .not.toBeNull();
  });

  it('shows the replay bar only in replay mode', () => {
    expect(parse(renderGame(base)).querySelector('.replay-bar')).toBeNull();
    expect(parse(renderGame({ ...base, replay: { progress: 0.5, done: false, totalPlays: 171 } }))
      .querySelector('.replay-bar')).not.toBeNull();
  });

  it('passes win probability through to the hero bar', () => {
    const el = parse(renderGame({ ...base, winProb: [{ homePct: 60, awayPct: 40 }] }));
    expect(el.querySelector('.hero-wp')).not.toBeNull();
  });

  it('marks the selected drive when one is chosen', () => {
    const el = parse(renderGame({
      ...base,
      drives: [{ id: 'd1', result: 'TD', teamAbbr: 'DAL' }, { id: 'd2', result: 'PUNT', teamAbbr: 'PHI' }],
      selectedDrive: 'd2',
    }));
    const cur = el.querySelectorAll('.drives [aria-current="true"]');
    expect(cur).toHaveLength(1);
    expect(cur[0].dataset.drive).toBe('d2');
  });
});

describe('renderReplayBar', () => {
  it('renders play, step and reset controls plus a scrubber', () => {
    const el = parse(renderReplayBar({ progress: 0.25, done: false, totalPlays: 171 }, false));
    expect(el.querySelector('[data-act="replay-play"]')).not.toBeNull();
    expect(el.querySelector('[data-act="replay-step"]')).not.toBeNull();
    expect(el.querySelector('[data-act="replay-reset"]')).not.toBeNull();
    const range = el.querySelector('input[type="range"]');
    expect(range.getAttribute('max')).toBe('171');
  });

  it('shows pause while playing and play while paused', () => {
    expect(parse(renderReplayBar({ progress: 0.1, totalPlays: 10 }, true)).textContent)
      .toMatch(/pause/i);
    expect(parse(renderReplayBar({ progress: 0.1, totalPlays: 10 }, false)).textContent)
      .toMatch(/play/i);
  });

  it('reports progress as a rounded percentage', () => {
    expect(parse(renderReplayBar({ progress: 0.333, totalPlays: 9 }, false)).textContent)
      .toContain('33%');
  });

  it('positions the scrubber at the current play', () => {
    const el = parse(renderReplayBar({ progress: 0.5, totalPlays: 100 }, false));
    expect(el.querySelector('input[type="range"]').getAttribute('value')).toBe('50');
  });

  it('survives a null replay state rather than throwing', () => {
    expect(() => renderReplayBar(null, false)).not.toThrow();
  });
});
