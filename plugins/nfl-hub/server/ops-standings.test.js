// Standings must not count the current week before anyone has played. Scoring writes an
// all-zero record for it on the first tick, and counted as a result that was a 0–0 tie
// in every matchup — every team in Happy Hour showed a tie for week 4 on 2026-09-30.
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = vi.hoisted(() => new Map());
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
  fetchJSON: () => null,
}));

const { getStandings } = await import("./ops-scoring.js");

const LG = "lg1";
const scores = (week, totals) => store.set(`fl:${LG}:scores:2026:w${week}`, {
  season: 2026, week, teams: Object.fromEntries(Object.entries(totals).map(([t, total]) => [t, { total }])),
});

beforeEach(() => {
  store.clear();
  store.set(`fl:${LG}:meta`, { settings: {}, season: 2026, currentWeek: 2 });
  store.set(`fl:${LG}:teams`, { t1: { id: "t1" }, t2: { id: "t2" } });
  store.set(`fl:${LG}:sched:2026`, { weeks: [
    { week: 1, matchups: [{ home: "t1", away: "t2" }] },
    { week: 2, matchups: [{ home: "t1", away: "t2" }] },
  ] });
  scores(1, { t1: 100, t2: 90 });
});

const row = (id) => getStandings({ payload: { leagueId: LG } }).standings.find((r) => r.teamId === id);

describe("standings and an unplayed week", () => {
  it("the all-zero record of a week nobody has played is not a tie", () => {
    scores(2, { t1: 0, t2: 0 });
    expect(row("t1")).toMatchObject({ wins: 1, losses: 0, ties: 0 });
    expect(row("t2")).toMatchObject({ wins: 0, losses: 1, ties: 0 });
    expect(getStandings({ payload: { leagueId: LG } }).weeks).toBe(1);
  });

  it("counts the week as soon as anyone has scored", () => {
    scores(2, { t1: 0, t2: 7.5 });
    expect(row("t2")).toMatchObject({ wins: 1, losses: 1, ties: 0 });
  });
});
