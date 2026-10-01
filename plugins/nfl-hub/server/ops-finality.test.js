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
