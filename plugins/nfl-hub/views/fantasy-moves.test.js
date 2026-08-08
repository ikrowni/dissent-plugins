import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTransactions, groupByWeek } from '../core/sleeper-league.js';
import { renderPanel, describeMove } from './fantasy-moves.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const feed = parseTransactions(fx('sleeper-transactions-w1.json'));
const names = { 11600: 'Traded Guy', 8119: 'Waiver Guy' };
const teamNames = { 1: 'Alpha', 2: 'Beta' };
const state = { moves: groupByWeek(feed), playerNames: names, rosterNames: teamNames };

describe('describeMove', () => {
  it('describes a trade as a transfer between two teams', () => {
    const trade = feed.find((t) => t.transfers.length);
    const text = describeMove(trade, names, teamNames);
    expect(text).toContain('Traded Guy');
    expect(text).toContain('Beta');
    expect(text).toContain('Alpha');
  });

  it('names a player the index does not know rather than printing an id', () => {
    const t = { transfers: [], adds: [{ playerId: '999', rosterId: 1 }], drops: [], picks: [] };
    expect(describeMove(t, names, teamNames)).toContain('Player 999');
  });
});

describe('renderPanel', () => {
  it('groups the feed by week', () => {
    const html = renderPanel(state);
    expect(html).toContain('Week 1');
  });

  it('marks a failed claim as failed and shows the reason', () => {
    const html = renderPanel(state);
    expect(html).toContain('mv-failed');
    expect(html).toMatch(/claimed by another owner|over the budget|too many players/);
  });

  it('never renders a failed claim as a completed move', () => {
    const failed = feed.filter((t) => !t.succeeded);
    expect(failed.length).toBe(27);
    const html = renderPanel({ ...state, moves: groupByWeek(failed) });
    expect(html).not.toContain('mv-ok');
  });

  it('shows the FAAB bid on a waiver that has one', () => {
    const bid = feed.find((t) => t.faabBid !== null && t.faabBid > 0);
    const html = renderPanel({ ...state, moves: groupByWeek([bid]) });
    expect(html).toContain(`$${bid.faabBid}`);
  });

  it('shows a traded future pick', () => {
    const withPicks = feed.find((t) => t.picks.length);
    const html = renderPanel({ ...state, moves: groupByWeek([withPicks]) });
    expect(html).toContain('2026');
    expect(html).toContain('Round 2');
  });

  it('escapes a player name containing markup', () => {
    const t = feed.find((x) => x.adds.length);
    const html = renderPanel({
      ...state, moves: groupByWeek([t]),
      playerNames: { [t.adds[0].playerId]: '<script>x</script>' },
    });
    expect(html).not.toContain('<script>x');
  });

  it('renders an empty state rather than a blank panel', () => {
    expect(renderPanel({ moves: [] })).toContain('No transactions');
  });
});
