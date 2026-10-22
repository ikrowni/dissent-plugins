import { describe, expect, it } from "vitest";
import { knock, newClimber, respawnAbove, stepClimber, NO_INTENT } from "./climb.js";
import { genTower } from "./towerGen.js";
import { FH, MOVE, STEP, WL } from "./tuning.js";

const flat = genTower(5, 50);
const ground = flat.byFloor[0][0];

function standing(x = 300) {
  const c = newClimber(x, 0);
  Object.assign(c, { onGround: true, ledge: ground, spawning: false });
  return c;
}
const run = (c, i, steps, t = flat) => {
  const ev = [];
  for (let n = 0; n < steps; n++) ev.push(...stepClimber(c, { ...NO_INTENT, ...i }, t, STEP));
  return ev;
};
const peak = (c, held) => {
  let top = 0;
  stepClimber(c, { ...NO_INTENT, jumpPressed: true, jumpHeld: held }, flat, STEP);
  for (let n = 0; n < 200; n++) { stepClimber(c, { ...NO_INTENT, jumpHeld: held }, flat, STEP); top = Math.min(top, c.y); }
  return -top;
};

describe("climbing feel", () => {
  it("a held jump goes higher than a tap, and running jumps higher still (Icy Tower)", () => {
    const tap = peak(standing(), false);
    const held = peak(standing(), true);
    const runner = standing(100);
    run(runner, { dir: 1 }, 30);
    const running = peak(runner, true);
    expect(held).toBeGreaterThan(tap * 1.5);
    expect(running).toBeGreaterThan(held * 1.5);
    expect(running).toBeGreaterThan(2 * FH); // a full-speed jump clears two floors
  });

  it("coyote time: a jump just after walking off an edge still works; too late doesn't", () => {
    const t = genTower(5, 50);
    const ledge = t.byFloor[1][0];
    const late = (ms) => {
      const c = newClimber(ledge.x + ledge.w - 1, ledge.y);
      Object.assign(c, { onGround: true, ledge, spawning: false, vx: MOVE.run });
      run(c, { dir: 1 }, 6, t); // walks off
      expect(c.onGround).toBe(false);
      run(c, { dir: 1 }, Math.round(ms / 1000 / STEP), t);
      return run(c, { dir: 1, jumpPressed: true, jumpHeld: true }, 1, t).includes("jump");
    };
    expect(late(40)).toBe(true);
    expect(late(MOVE.coyoteMs + 40)).toBe(false);
  });

  it("jump buffer: a press just before landing jumps on landing", () => {
    const c = newClimber(300, -12);
    c.spawning = false;
    stepClimber(c, { ...NO_INTENT, jumpPressed: true, jumpHeld: true }, flat, STEP); // pressed in the air
    const ev = run(c, { jumpHeld: true }, 40);
    expect(ev).toContain("jump");
  });

  it("ledges are one-way: you jump up through one and land on it from above", () => {
    const t = genTower(9, 50);
    const l1 = t.byFloor[1][0];
    const c = newClimber(l1.x + l1.w / 2, 0);
    Object.assign(c, { onGround: true, ledge: t.byFloor[0][0], spawning: false });
    run(c, { jumpPressed: true, jumpHeld: true }, 1, t);
    run(c, { jumpHeld: true }, 120, t);
    expect(c.onGround).toBe(true);
    expect(c.ledge).toBe(l1);
  });

  it("S drops through a ledge, never through the ground", () => {
    const t = genTower(9, 50);
    const l1 = t.byFloor[1][0];
    const c = newClimber(l1.x + l1.w / 2, l1.y);
    Object.assign(c, { onGround: true, ledge: l1, spawning: false });
    run(c, { drop: true }, 60, t);
    expect(c.ledge?.floor).toBe(0);
    run(c, { drop: true }, 60, t);
    expect(c.onGround && c.ledge?.type === "ground").toBe(true);
  });

  it("bouncing off a side wall in the air keeps most of the speed", () => {
    const c = newClimber(WL + 10, -200);
    Object.assign(c, { spawning: false, vx: -MOVE.run, vy: -100 });
    run(c, {}, 3);
    expect(c.vx).toBeGreaterThan(MOVE.run * 0.75); // 92% kept, less a little air drag either side of the bounce
  });

  it("falling in at the start passes every ledge and lands on the ground", () => {
    const t = genTower(9, 50);
    const c = newClimber(t.byFloor[3][0].x + 20, -5 * FH);
    run(c, {}, 300, t);
    expect(c.ledge?.type).toBe("ground");
  });

  it("two big jumps in a row are a combo", () => {
    const c = standing();
    c.jumpFloor = 0;
    const t = genTower(9, 50);
    const ev = [];
    const land = (floor) => {
      const q = t.byFloor[floor][0];
      Object.assign(c, { x: q.x + q.w / 2, y: q.y - 1, vy: 300, onGround: false, ledge: null });
      ev.push(...stepClimber(c, NO_INTENT, t, STEP));
      c.jumpFloor = c.ledge?.floor ?? c.jumpFloor;
    };
    c.jumpFloor = 0; land(2); c.jumpFloor = 2; land(4);
    expect(ev).toContainEqual({ combo: 4 });
  });

  it("caught by the mist: back on a steady ledge three floors above it, blinking", () => {
    const t = genTower(9, 50);
    const c = standing();
    expect(respawnAbove(c, t, -10 * FH, 3, 1.2)).toBe(true);
    expect(c.ledge?.floor).toBeGreaterThanOrEqual(13);
    expect(c.ledge?.type).not.toBe("move");
    expect(c.blink).toBe(1.2);
  });

  it("knocked: thrown, no control while stunned, then control again", () => {
    const c = standing();
    knock(c, 520, -380, 0.55);
    const ev = run(c, { dir: -1, jumpPressed: true, jumpHeld: true }, 30); // 0.25 s: still stunned
    expect(ev).not.toContain("jump");
    expect(c.vx).toBeGreaterThan(0); // still flying the way it was knocked
    run(c, {}, 80);
    expect(c.stun).toBe(0);
    expect(run(c, { jumpPressed: true, jumpHeld: true }, 1)).toContain("jump");
  });

  it("a slick ledge barely grips: you slide on", () => {
    const grip = (icy) => {
      const c = standing();
      c.vx = MOVE.run;
      for (let n = 0; n < 30; n++) stepClimber(c, NO_INTENT, flat, STEP, () => icy);
      return c.vx;
    };
    expect(grip(false)).toBe(0);
    expect(grip(true)).toBeGreaterThan(MOVE.run * 0.6);
  });
});
