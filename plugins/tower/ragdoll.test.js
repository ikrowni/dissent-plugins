import { describe, expect, it } from "vitest";
import { Ragdoll } from "./ragdoll.js";
import { posePoints } from "./drawFigure.js";

const pose = (x, y) => ({ x, y, vx: 0, vy: 0, onGround: true, facing: 1, phase: 0, squash: 0, blink: false, color: "#f00" });
const dt = 1 / 120;

describe("the ragdoll", () => {
  it("stays in one piece through a violent knock, and its hip follows the body", () => {
    const r = new Ragdoll(posePoints(pose(100, 0), 0, true), 900, -700, 14, dt);
    let hip = { x: 100, y: -21 };
    for (let n = 0; n < 90; n++) {
      hip = { x: hip.x + 4, y: hip.y - 2 };
      r.step(hip, dt);
    }
    expect(r.boneStretch()).toBeLessThan(2.5); // bones within a couple of units of their length
    expect(r.joints(posePoints(pose(0, 0), 0, true), 0).hip).toEqual(hip);
  });

  it("flops: the limbs end up somewhere the pose would never put them", () => {
    const start = posePoints(pose(100, 0), 0, true);
    const r = new Ragdoll(start, 600, -400, 10, dt);
    for (let n = 0; n < 60; n++) r.step({ x: 100, y: -21 }, dt);
    const j = r.joints(start, 0);
    const moved = Math.hypot(j.head.x - start.head.x, j.head.y - start.head.y);
    expect(moved).toBeGreaterThan(8);
  });

  it("eases back into the pose when the stun ends", () => {
    const start = posePoints(pose(100, 0), 0, true);
    const r = new Ragdoll(start, 600, -400, 10, dt);
    for (let n = 0; n < 60; n++) r.step({ x: 100, y: -21 }, dt);
    r.recover();
    let j = r.joints(start, 0.1);
    expect(r.done).toBe(false);
    j = r.joints(start, 0.2);
    expect(r.done).toBe(true);
    expect(j.head.x).toBeCloseTo(start.head.x, 5);
    expect(j.foot1.y).toBeCloseTo(start.foot1.y, 5);
  });
});
