import { describe, expect, it } from "vitest";
import { blast, landsOnHead, punchLands, stepBomb } from "./fight.js";
import { genTower } from "./towerGen.js";
import { STEP } from "./tuning.js";

describe("hitting", () => {
  it("a punch lands about one body width ahead, only at your own height — never upward onto someone landing on you", () => {
    const a = { x: 100, y: 0 };
    expect(punchLands(a, 1, { x: 130, y: 0 })).toBe(true);
    expect(punchLands(a, 1, { x: 150, y: 0 })).toBe(false); // too far
    expect(punchLands(a, 1, { x: 80, y: 0 })).toBe(false); // behind you
    expect(punchLands(a, -1, { x: 80, y: 0 })).toBe(true);
    expect(punchLands(a, 1, { x: 110, y: -50 })).toBe(false); // the mock's bug: someone standing on your head
  });

  it("coming down onto a head counts; walking past it, or rising through it, doesn't", () => {
    const other = { x: 200, y: 0 };
    expect(landsOnHead(-60, { x: 205, y: -48 }, other)).toBe(true);
    expect(landsOnHead(-60, { x: 230, y: -48 }, other)).toBe(false);
    expect(landsOnHead(-40, { x: 205, y: -30 }, other)).toBe(false); // already below the head top
  });
});

describe("bombs", () => {
  it("fly in an arc and go off on a ledge or at the end of the fuse", () => {
    const t = genTower(3, 50);
    const b = { id: "b1", by: "me", x: 300, y: -30, vx: 200, vy: -400, t: 0 };
    let n = 0;
    while (!stepBomb(b, t, STEP) && n < 1000) n++;
    expect(b.t).toBeLessThanOrEqual(1.61);
    expect(b.t).toBeGreaterThan(0.12);
  });

  it("knock away anyone within reach, harder close in, away from the blast", () => {
    const near = blast(100, -22, { x: 120, y: 0 });
    const far = blast(100, -22, { x: 210, y: 0 });
    expect(near && near.vx > 0 && near.vy < 0).toBe(true);
    expect(far && far.vx < near.vx).toBe(true);
    expect(blast(100, -22, { x: 400, y: 0 })).toBeNull();
    expect(blast(100, -22, { x: 80, y: 0 }).vx).toBeLessThan(0);
  });
});
