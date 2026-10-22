import { describe, expect, it } from "vitest";
import { Remote, Sender } from "./net.js";

const p = (t, x, extra = {}) =>
  ({ k: "p", t, x, y: 0, vx: 200, vy: 0, g: 1, f: 1, ph: 0, sq: 0, bl: 0, b: 0, ...extra });

describe("Remote — drawing another player in the past", () => {
  it("slides between the two positions around (their clock − 150 ms)", () => {
    const r = new Remote();
    // Their clock runs 1000 ms behind ours; messages take 20 ms.
    r.push(p(0, 0), 1020);
    r.push(p(50, 10), 1070);
    r.push(p(100, 20), 1120);
    // At our 1195: their clock ≈ 175, 150 ms ago = 25 → halfway between x=0 and x=10.
    expect(r.at(1195)?.x).toBeCloseTo(5, 5);
  });

  it("carries on at the last speed for 100 ms when messages stop, then stops", () => {
    const r = new Remote();
    r.push(p(0, 0), 1000);
    expect(r.at(1000 + 150 + 50)?.x).toBeCloseTo(10, 5); // 50 ms × 200/s
    expect(r.at(1000 + 150 + 500)?.x).toBeCloseTo(20, 5); // capped at 100 ms
  });

  it("drops old and repeated messages", () => {
    const r = new Remote();
    r.push(p(100, 50), 1000);
    r.push(p(50, 999), 1001);
    r.push(p(100, 999), 1002);
    expect(r.latest?.x).toBe(50);
  });

  it("a respawn jumps without sliding across the tower", () => {
    const r = new Remote();
    r.push(p(0, 0, { y: 0 }), 1000);
    r.push(p(50, 0, { y: -900 }), 1050);
    expect(r.at(1000 + 150 + 25)?.y).toBe(-900);
  });
});

describe("Sender", () => {
  it("sends every 50 ms, every 100 ms for 2 s after the node says too fast", () => {
    const s = new Sender();
    const sent = (from, to) => { let n = 0; for (let t = from; t < to; t += 10) if (s.due(t)) n++; return n; };
    expect(sent(0, 1000)).toBe(20);
    s.limited(1000);
    expect(sent(1000, 2000)).toBe(10);
    expect(sent(3000, 4000)).toBe(20);
  });
});
