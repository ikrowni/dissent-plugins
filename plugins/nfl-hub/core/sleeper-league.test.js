import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTransactions, groupByWeek } from './sleeper-league.js';

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), 'utf8'));

const w1 = fx('sleeper-transactions-w1.json');
const parsed = parseTransactions(w1);

describe('parseTransactions', () => {
  it('returns one entry per raw transaction', () => {
    expect(parsed).toHaveLength(w1.length);
    expect(parsed).toHaveLength(182);
  });

  it('carries the failed status through instead of dropping it', () => {
    const failed = parsed.filter((t) => !t.succeeded);
    expect(failed.length).toBe(27);
    expect(failed[0].status).toBe('failed');
  });

  it('exposes the failure reason from metadata.notes', () => {
    const withNote = parsed.find((t) => !t.succeeded && t.note);
    expect(withNote.note).toMatch(/claimed by another owner|over the budget|too many players/);
  });

  it('parses a trade as a transfer, not two independent moves', () => {
    const trade = parsed.find((t) => t.type === 'trade' && t.transfers.length);
    expect(trade.transfers[0]).toEqual({ playerId: '11600', fromRosterId: 2, toRosterId: 1 });
    // The same player must NOT also appear as a standalone add or drop.
    expect(trade.adds.map((a) => a.playerId)).not.toContain('11600');
    expect(trade.drops.map((d) => d.playerId)).not.toContain('11600');
  });

  it('keeps a waiver add as an add, since it appears on one side only', () => {
    const waiver = parsed.find((t) => t.type === 'waiver' && t.adds.length);
    expect(waiver.transfers).toEqual([]);
    expect(waiver.adds[0].rosterId).toBeGreaterThan(0);
  });

  it('reads the FAAB bid off settings.waiver_bid', () => {
    const bid = parsed.find((t) => t.type === 'waiver' && t.faabBid !== null);
    expect(typeof bid.faabBid).toBe('number');
  });

  it('parses traded future picks with roster ids and a season', () => {
    const withPicks = parsed.find((t) => t.picks.length);
    expect(withPicks.picks[0]).toEqual({
      season: '2026', round: 2, fromRosterId: 1, toRosterId: 2,
    });
  });

  it('never throws on a null or malformed payload', () => {
    expect(parseTransactions(null)).toEqual([]);
    expect(parseTransactions({})).toEqual([]);
    expect(parseTransactions([{}])).toHaveLength(1);
    expect(parseTransactions([{}])[0].adds).toEqual([]);
  });

  it('tolerates the unmeasured waiver_budget shape without inventing fields', () => {
    // Never observed non-empty in 292 live transactions. It must survive, not be trusted.
    const out = parseTransactions([{ waiver_budget: [{ sender: 1, receiver: 2, amount: 5 }] }]);
    expect(out[0].budgetMoves).toEqual([{ sender: 1, receiver: 2, amount: 5 }]);
    expect(parseTransactions([{ waiver_budget: 'nonsense' }])[0].budgetMoves).toEqual([]);
  });
});

describe('groupByWeek', () => {
  it('buckets by leg, newest week first', () => {
    const g = groupByWeek([
      ...parseTransactions([{ leg: 3, created: 3 }]),
      ...parseTransactions([{ leg: 1, created: 1 }]),
    ]);
    expect(g.map((x) => x.week)).toEqual([3, 1]);
  });

  it('sorts within a week by created, newest first', () => {
    const g = groupByWeek(parseTransactions([
      { leg: 2, created: 100 }, { leg: 2, created: 300 }, { leg: 2, created: 200 },
    ]));
    expect(g[0].items.map((i) => i.created)).toEqual([300, 200, 100]);
  });
});
