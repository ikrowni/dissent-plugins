import { describe, expect, it } from "vitest";
import { lateMs } from "./roundClock.js";

describe("lateMs", () => {
  it("🔴 a PC clock running ahead of the node does not read as late", () => {
    const node = Date.parse("2026-10-21T05:00:00.000Z");
    const pcAhead = node + 9_000; // this machine's clock is 9 s fast
    const l = { started_at: new Date(node - 100).toISOString(), elapsed_ms: 100 };
    expect(lateMs(l, pcAhead, pcAhead + 50)).toBe(150); // the node's 100 ms, plus 50 ms since it arrived
  });

  it("counts the time since the lobby arrived, on this machine's own clock", () => {
    expect(lateMs({ started_at: null, elapsed_ms: 4000 }, 1_000, 3_500)).toBe(6_500);
  });

  it("an older node without elapsed_ms: the old comparison", () => {
    const now = Date.parse("2026-10-21T05:00:10.000Z");
    expect(lateMs({ started_at: "2026-10-21T05:00:00.000Z" }, now, now)).toBe(10_000);
    expect(lateMs({ started_at: null }, now, now)).toBe(0);
  });
});
