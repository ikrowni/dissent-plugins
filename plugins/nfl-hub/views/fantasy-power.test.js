import { describe, it, expect } from 'vitest';
import { renderPanel, luckLabel } from './fantasy-power.js';

const rows = [
  {
    rosterId: 1, rank: 1, wins: 9, losses: 4, ties: 0, pointsFor: 1500, potentialPoints: 1800,
    allPlay: { wins: 100, losses: 43, ties: 0 }, allPlayPct: 0.699, expectedWins: 9.1,
    luck: -0.1, efficiency: 0.8333,
  },
  {
    rosterId: 2, rank: 2, wins: 4, losses: 9, ties: 0, pointsFor: 1200, potentialPoints: 1500,
    allPlay: { wins: 43, losses: 100, ties: 0 }, allPlayPct: 0.301, expectedWins: 3.9,
    luck: 2.4, efficiency: 0.8,
  },
];
const users = { 1: { teamName: 'Alpha' }, 2: { teamName: 'Beta' } };
const state = { power: rows, users, rosterOwner: { 1: 1, 2: 2 }, odds: { 1: 88.5, 2: 3.2 } };

describe('luckLabel', () => {
  it('calls a big positive gap lucky', () => {
    expect(luckLabel(2.4)).toBe('Lucky');
  });

  it('calls a big negative gap unlucky', () => {
    expect(luckLabel(-2.4)).toBe('Unlucky');
  });

  it('calls a small gap neutral', () => {
    expect(luckLabel(0.4)).toBe('Neutral');
    expect(luckLabel(-0.4)).toBe('Neutral');
  });
});

describe('renderPanel', () => {
  it('renders one row per team, in rank order', () => {
    const html = renderPanel(state);
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect(html.indexOf('Alpha')).toBeLessThan(html.indexOf('Beta'));
  });

  it('shows the all-play record and the real record separately', () => {
    const html = renderPanel(state);
    expect(html).toContain('100-43');
    expect(html).toContain('9-4');
  });

  it('shows playoff odds when the sim has run', () => {
    expect(renderPanel(state)).toContain('88.5%');
  });

  it('shows a pending note instead of odds before the sim finishes', () => {
    const html = renderPanel({ ...state, odds: null });
    expect(html).toContain('Simulating');
    expect(html).not.toContain('88.5%');
  });

  it('escapes a team name containing markup', () => {
    const html = renderPanel({
      ...state, users: { 1: { teamName: '<img src=x onerror=alert(1)>' }, 2: { teamName: 'Beta' } },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('renders an empty state rather than a blank panel', () => {
    expect(renderPanel({ power: [] })).toContain('Not enough');
  });
});
