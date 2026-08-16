// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { rootClassFor, statusBar, matchHero } from './scoreboard.js';
import { resetAll, setLastGoal } from './state.js';

describe('rootClassFor', () => {
  it('adds the overtime class in overtime', () => {
    expect(rootClassFor({ is_overtime: true })).toContain('vsb-ot');
  });

  it('omits it in normal play', () => {
    expect(rootClassFor({ is_overtime: false })).not.toContain('vsb-ot');
  });

  it('omits it when the flag is absent', () => {
    expect(rootClassFor({})).not.toContain('vsb-ot');
  });

  it('omits it with no game state', () => {
    expect(rootClassFor(null)).not.toContain('vsb-ot');
  });
});

describe('statusBar', () => {
  it('shows Live during normal play', () => {
    expect(statusBar({ time: 90, mode: '3v3 Standard', arena: 'DFH' })).toContain('Live');
  });

  it('prefers Final over everything else', () => {
    expect(statusBar({ has_winner: true, is_replay: true, time: 0 })).toContain('Final');
  });

  it('shows Replay during a replay', () => {
    expect(statusBar({ is_replay: true, time: 90 })).toContain('Replay');
  });

  it('marks overtime with a leading plus on the clock', () => {
    expect(statusBar({ is_overtime: true, time: 65 })).toContain('+1:05');
  });

  it('renders a waiting bar with no game state — and no zeros', () => {
    const html = statusBar(null);
    expect(html).toContain('Waiting');
    expect(html).toContain('--:--');
    expect(html).not.toMatch(/>\s*0\s*</);
  });

  it('escapes arena and mode rather than interpolating raw', () => {
    expect(statusBar({ time: 0, mode: '<img>', arena: 'x' })).not.toContain('<img>');
  });
});

describe('matchHero', () => {
  beforeEach(() => resetAll());

  it('renders both scores', () => {
    const html = matchHero({ teams: { blue: { score: 3 }, orange: { score: 2 } } });
    expect(html).toContain('>3<');
    expect(html).toContain('>2<');
  });

  it('marks the leading side as winning', () => {
    const html = matchHero({ teams: { blue: { score: 3 }, orange: { score: 1 } } });
    expect(html).toMatch(/vsb-hero-score blue winning/);
    expect(html).not.toMatch(/vsb-hero-score orange winning/);
  });

  it('marks neither side when level', () => {
    const html = matchHero({ teams: { blue: { score: 2 }, orange: { score: 2 } } });
    expect(html).not.toContain('winning');
  });

  it('references both car marks by a relative path', () => {
    const html = matchHero({ teams: {} });
    expect(html).toContain('src="assets/octane-blue.png"');
    expect(html).toContain('src="assets/octane-orange.png"');
    // An absolute URL would break mirroring to another node.
    expect(html).not.toContain('https://');
  });

  it('says so plainly when there are no goals yet', () => {
    expect(matchHero({ teams: {} })).toContain('No goals yet');
  });

  it('shows the most recent goal across both teams', () => {
    setLastGoal('blue', { scorer: 'alice', time: 200 });
    setLastGoal('orange', { scorer: 'bob', time: 260 });
    const html = matchHero({ teams: {} });
    expect(html).toContain('bob');
  });

  it('escapes the scorer name', () => {
    setLastGoal('blue', { scorer: '<script>x</script>', time: 10 });
    expect(matchHero({ teams: {} })).not.toContain('<script>');
  });
});
