import { describe, expect, it } from "vitest";
import { parseMsg, posMsg } from "./towerProtocol.js";
import { newClimber } from "./climb.js";

describe("tower messages", () => {
  it("round-trips a position and stays small", () => {
    const c = Object.assign(newClimber(123.4, -456.7), { vx: 12.6, vy: -800.2, onGround: false, phase: 3.21, squash: -0.4, blink: 0.5, best: 5 });
    const m = posMsg(1234.5, c);
    expect(parseMsg(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(JSON.stringify(m).length).toBeLessThan(200);
    expect(m).toMatchObject({ x: 123, y: -457, g: 0, bl: 1, sq: -40 });
  });

  it("accepts fin; drops anything else", () => {
    expect(parseMsg({ k: "fin", t: 90000 })).toEqual({ k: "fin", t: 90000 });
    for (const bad of [null, 5, "p", {}, { k: "fin" }, { k: "fin", t: -1 }, { k: "boom", t: 1 },
      { k: "p", t: 1, x: 1.5, y: 0, vx: 0, vy: 0, g: 1, f: 1, ph: 0, sq: 0, bl: 0, b: 0 },
      { k: "p", t: 1, x: 1, y: 0, vx: 0, vy: 0, g: 2, f: 1, ph: 0, sq: 0, bl: 0, b: 0 },
      { k: "p", t: 1, x: 1, y: 0, vx: 0, vy: 0, g: 1, f: 0, ph: 0, sq: 0, bl: 0, b: 0 }]) {
      expect(parseMsg(bad)).toBeNull();
    }
  });

  it("piece 3's messages parse; bad ones drop; piece 2's position messages still parse", () => {
    const u = "11111111-2222-4333-8444-555555555555";
    const good = [
      { k: "atk", t: 5, x: 10, y: -20, f: -1, run: 1 },
      { k: "use", t: 5, item: "ink", floor: 3, x: 1, y: 2 },
      { k: "use", t: 5, item: "grapple", floor: 3, x: 1, y: 2, target: u },
      { k: "swap", t: 5, to: u, ok: 1, x: 1, y: 2 },
      { k: "bomb", t: 5, id: "b-1", x: 1, y: 2, vx: 300, vy: -500 },
      { k: "out", t: 5 },
      { k: "crown", t: 5, held: 12000 },
    ];
    for (const m of good) expect(parseMsg(m)).toEqual(m);
    for (const bad of [
      { k: "atk", t: 5, x: 10, y: -20, f: 0, run: 1 },
      { k: "use", t: 5, item: "nuke", floor: 3, x: 1, y: 2 },
      { k: "use", t: 5, item: "grapple", floor: 3, x: 1, y: 2 },
      { k: "swap", t: 5, to: "bob", ok: 1, x: 1, y: 2 },
      { k: "bomb", t: 5, id: "<script>", x: 1, y: 2, vx: 3, vy: 4 },
      { k: "crown", t: 5, held: -1 },
    ]) expect(parseMsg(bad)).toBeNull();
    const old = { k: "p", t: 1, x: 1, y: 0, vx: 0, vy: 0, g: 1, f: 1, ph: 0, sq: 0, bl: 0, b: 0 };
    expect(parseMsg(old)).toEqual(old);
    expect(parseMsg({ ...old, st: 1, it: 6, sh: 1, pu: 0 })).toEqual({ ...old, st: 1, it: 6, sh: 1, pu: 0 });
    expect(parseMsg({ ...old, it: 9 })).toBeNull();
  });
});
