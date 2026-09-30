// A lineup carries forward from the last week a team set. Before 2026-09-30 an unset week
// read — and SCORED — as an empty lineup, so managers had to re-enter it every week.
// Run through the real ops against an in-memory `storage` with the host's semantics.
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = vi.hoisted(() => new Map());
vi.mock("./sdk/server-sdk.js", () => ({ storage: {
  get: (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
  set: (k, v) => { store.set(k, structuredClone(v)); },
  swap: (k, fn, { fallback } = {}) => {
    const next = fn(store.has(k) ? structuredClone(store.get(k)) : fallback);
    store.set(k, structuredClone(next));
    return next;
  },
} }));

const { getLineup } = await import("./ops-league.js");

const LG = "lg1";
const lineupKey = (week) => `fl:${LG}:lineup:2026:w${week}:t1`;
const get = (week) => getLineup({ p: { userId: "alice" }, payload: { leagueId: LG, teamId: "t1", week } });

beforeEach(() => {
  store.clear();
  store.set(`fl:${LG}:meta`, { settings: {}, season: 2026, currentWeek: 6 });
  store.set(`fl:${LG}:teams`, { t1: { id: "t1", ownerId: "alice" } });
  store.set(`fl:${LG}:assets`, { rosters: { t1: { players: ["qb1", "rb1", "rb2", "wr1"], ir: [] } } });
  // Exactly what setLineup writes.
  store.set(lineupKey(3), { lineup: ["qb1", "rb1", "wr1"], setAt: 1, setBy: "alice" });
});

describe("getLineup carries the last set week forward", () => {
  it("an unset week returns the last set week's lineup, and says where it came from", () => {
    expect(get(6)).toMatchObject({ lineup: ["qb1", "rb1", "wr1"], carriedFrom: 3 });
  });

  it("a week the manager set returns that week, not an older one", () => {
    store.set(lineupKey(5), { lineup: ["qb1", "rb2", "wr1"], setAt: 2, setBy: "alice" });
    expect(get(5)).toMatchObject({ lineup: ["qb1", "rb2", "wr1"], carriedFrom: null });
    expect(get(6)).toMatchObject({ lineup: ["qb1", "rb2", "wr1"], carriedFrom: 5 });
  });

  it("a carried player the team no longer holds comes back as an empty slot", () => {
    store.set(`fl:${LG}:assets`, { rosters: { t1: { players: ["qb1", "wr1"], ir: [] } } });
    expect(get(6).lineup).toEqual(["qb1", null, "wr1"]);
  });

  it("does not write anything — carrying is a read, the stored weeks are untouched", () => {
    get(6);
    expect(store.has(lineupKey(6))).toBe(false);
  });
});
