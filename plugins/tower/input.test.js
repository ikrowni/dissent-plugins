import { describe, expect, it } from "vitest";
import { Keys, StepClock } from "./input.js";
import { STEP } from "./tuning.js";

describe("presses are never lost (spec §8.2)", () => {
  it("a press during a frame that runs no step waits for the next step", () => {
    const keys = new Keys();
    const clock = new StepClock(STEP, 12);
    keys.down(" ");
    keys.up(" "); // tapped and released within one short frame
    expect(clock.steps(STEP / 3)).toBe(0); // a 360 Hz frame: no step, so take() isn't called
    expect(clock.steps(STEP / 3)).toBe(0);
    expect(clock.steps(STEP / 2)).toBe(1);
    expect(keys.take().jumpPressed).toBe(true);
    expect(keys.take().jumpPressed).toBe(false); // used once
  });

  it("key repeat doesn't count as a new press; holding still reads as held", () => {
    const keys = new Keys();
    keys.down("w");
    keys.take();
    keys.down("w", true);
    const i = keys.take();
    expect(i.jumpPressed).toBe(false);
    expect(i.jumpHeld).toBe(true);
  });

  it("left and right cancel; losing focus lets go of everything", () => {
    const keys = new Keys();
    keys.down("a"); keys.down("ArrowRight");
    expect(keys.take().dir).toBe(0);
    keys.clear();
    keys.down("d");
    expect(keys.take().dir).toBe(1);
    keys.clear();
    expect(keys.take().dir).toBe(0);
  });

  it("only the game's keys stop the page", () => {
    const keys = new Keys();
    expect(keys.down(" ")).toBe(true);
    expect(keys.down("Enter")).toBe(false);
  });

  it("a long stall runs at most 12 steps and drops the rest", () => {
    const clock = new StepClock(STEP, 12);
    expect(clock.steps(5)).toBe(12);
    expect(clock.steps(0)).toBe(0);
  });
});
