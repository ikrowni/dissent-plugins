// Week finality, through the real ops against an in-memory storage with the host's semantics.
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = vi.hoisted(() => new Map());
const fetched = vi.hoisted(() => ({ payload: null, calls: 0 }));
vi.mock("./sdk/server-sdk.js", () => ({
  storage: {
    get: (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: (k, v) => { store.set(k, structuredClone(v)); },
    swap: (k, fn, { fallback } = {}) => {
      const next = fn(store.has(k) ? structuredClone(store.get(k)) : fallback);
      store.set(k, structuredClone(next));
      return next;
    },
  },
  fetchJSON: ({ url }) => {
    if (url.includes("espn")) { fetched.calls++; return fetched.payload; }
    return {}; // Sleeper stats: no stats → every total 0, fine for these tests
  },
}));

const { runScoring } = await import("./ops-scoring.js");

const LG = "lg1";
const SC = (w) => `fl:${LG}:scores:2026:w${w}`;

beforeEach(() => {
  store.clear(); fetched.payload = null; fetched.calls = 0;
  store.set(`fl:${LG}:meta`, { settings: {}, season: 2026, currentWeek: 4, commissioners: ["commish"] });
  store.set(`fl:${LG}:teams`, { t1: { id: "t1", ownerId: "alice" } });
  store.set(`fl:${LG}:assets`, { rosters: { t1: { players: [], ir: [] } } });
});

describe("scoring and a final week", () => {
  it("never rewrites a week stamped final, even when forced", () => {
    store.set(SC(3), { season: 2026, week: 3, teams: { t1: { total: 88 } }, final: true, finalAt: 1, finalReason: "all-games-complete" });
    expect(runScoring(LG, 2026, 3, { force: true })).toMatchObject({ skipped: "final" });
    expect(store.get(SC(3)).teams.t1.total).toBe(88);
  });

  it("scores a non-final week as before", () => {
    runScoring(LG, 2026, 4, { force: true });
    expect(store.get(SC(4))).toMatchObject({ week: 4 });
  });
});

const { finalizeOldestIfDue, finalizeWeek, reopenWeek } = await import("./ops-finality.js");

const as = (userId) => ({ userId, scheduled: false });
const espnAllDone = { events: [
  { date: "2026-09-25T00:15Z", status: { type: { completed: true } } },
  { date: "2026-09-29T00:15Z", status: { type: { completed: true } } },
] };
const TUE_9_ET_WK4 = Date.UTC(2026, 8, 29, 13);
const state = { season_start_date: "2026-09-09" };

describe("the tick locks the oldest non-final week", () => {
  beforeEach(() => {
    store.set(SC(3), { season: 2026, week: 3, teams: { t1: { total: 80 } } });
    store.set(SC(4), { season: 2026, week: 4, teams: { t1: { total: 10 } } });
  });

  it("locks week 3 (oldest) and leaves week 4 alone", () => {
    fetched.payload = espnAllDone;
    const r = finalizeOldestIfDue(LG, state, TUE_9_ET_WK4 + 7 * 86_400_000);
    expect(r).toMatchObject({ week: 3, locked: true, reason: "all-games-complete" });
    expect(store.get(SC(3))).toMatchObject({ final: true, finalReason: "all-games-complete" });
    expect(store.get(SC(4)).final).toBeUndefined();
  });

  it("does nothing, and writes nothing, when ESPN does not answer", () => {
    fetched.payload = null;
    const before = JSON.stringify(store.get(SC(3)));
    const r = finalizeOldestIfDue(LG, state, Date.UTC(2026, 8, 23, 12)); // inside the backstop window
    expect(r.locked).toBe(false);
    expect(JSON.stringify(store.get(SC(3)))).toBe(before);
  });

  it("the backstop locks even without ESPN, from the season-start estimate", () => {
    fetched.payload = null;
    const r = finalizeOldestIfDue(LG, state, Date.UTC(2026, 9, 30));
    expect(r).toMatchObject({ week: 3, locked: true, reason: "backstop" });
  });

  it("records lockAt while waiting, so the matchup screen can say when", () => {
    fetched.payload = espnAllDone;
    const r = finalizeOldestIfDue(LG, state, TUE_9_ET_WK4 - 3_600_000);
    expect(r).toMatchObject({ week: 3, locked: false, lockAt: TUE_9_ET_WK4 });
    expect(store.get(SC(3))).toMatchObject({ lockAt: TUE_9_ET_WK4 });
    expect(store.get(SC(3)).final).toBeUndefined();
  });

  it("does not fetch the scoreboard again before the stored lockAt", () => {
    fetched.payload = espnAllDone;
    finalizeOldestIfDue(LG, state, TUE_9_ET_WK4 - 3_600_000);
    expect(fetched.calls).toBe(1);
    finalizeOldestIfDue(LG, state, TUE_9_ET_WK4 - 60_000);
    expect(fetched.calls).toBe(1);
    expect(finalizeOldestIfDue(LG, state, TUE_9_ET_WK4)).toMatchObject({ week: 3, locked: true });
    expect(fetched.calls).toBe(2);
  });

  it("a scoring pass keeps the stored lockAt", () => {
    store.set(SC(4), { season: 2026, week: 4, teams: {}, lockAt: 123 });
    runScoring(LG, 2026, 4, { force: true });
    expect(store.get(SC(4)).lockAt).toBe(123);
  });
});

describe("commissioner finalize / reopen", () => {
  beforeEach(() => store.set(SC(4), { season: 2026, week: 4, teams: { t1: { total: 10 } } }));

  it("a commissioner finalizes a week now", () => {
    finalizeWeek({ p: as("commish"), payload: { leagueId: LG, week: 4 } });
    expect(store.get(SC(4))).toMatchObject({ final: true, finalReason: "commissioner", finalBy: "commish" });
  });

  it("a non-commissioner is refused AND nothing changes", () => {
    const before = JSON.stringify(store.get(SC(4)));
    expect(() => finalizeWeek({ p: as("alice"), payload: { leagueId: LG, week: 4 } })).toThrow(/commissioner/);
    expect(JSON.stringify(store.get(SC(4)))).toBe(before);
    expect(() => reopenWeek({ p: as("alice"), payload: { leagueId: LG, week: 4 } })).toThrow(/commissioner/);
  });

  it("reopen clears the stamp, records who, and warns about decided playoff rounds", () => {
    finalizeWeek({ p: as("commish"), payload: { leagueId: LG, week: 4 } });
    const r = reopenWeek({ p: as("commish"), payload: { leagueId: LG, week: 4 } });
    expect(store.get(SC(4)).final).toBeUndefined();
    expect(store.get(SC(4))).toMatchObject({ reopenedBy: "commish" });
    expect(r.note).toMatch(/playoff/);
  });

  it("refuses to finalize a week that was never scored", () => {
    expect(() => finalizeWeek({ p: as("commish"), payload: { leagueId: LG, week: 9 } })).toThrow(/not been scored/);
  });
});
