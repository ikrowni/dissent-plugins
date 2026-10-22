import { describe, expect, it } from "vitest";
import { stepMist, mistLevel } from "./mist.js";
import { FH, MIST } from "./tuning.js";

describe("the mist", () => {
  it("waits, then rises, faster every 30 s", () => {
    expect(stepMist(260, MIST.startMs - 1, null, 100, 1)).toBe(260);
    expect(stepMist(260, MIST.startMs, null, 100, 1)).toBe(260 - MIST.speed);
    expect(stepMist(260, 31_000, null, 100, 1)).toBe(260 - MIST.speed - MIST.stepSpeed);
    expect(mistLevel(61_000)).toBe(2);
  });

  it("races up when far behind the leader, and never covers the top", () => {
    const slow = 260 - stepMist(260, 10_000, -10 * FH, 100, 1);
    const fast = 260 - stepMist(260, 10_000, -20 * FH, 100, 1);
    expect(fast).toBeCloseTo(slow * MIST.catchUpMult, 5);
    expect(stepMist(-97 * FH, 10_000, -100 * FH, 100, 100)).toBe(-98 * FH);
  });
});
