/**
 * Keys → intent. 🔴 A press is KEPT until a game step has used it (spec §8.2). The mock cleared presses
 * every frame and lost jumps on screens faster than 120 Hz (a frame with no step) and during hit-stop —
 * the owner hit it. `take()` hands the presses to one step and clears them; a frame that runs no step
 * simply doesn't call it.
 */

const LEFT = ["a", "arrowleft"];
const RIGHT = ["d", "arrowright"];
const JUMP = ["w", " ", "arrowup"];
const DOWN = ["s", "arrowdown"];
const PUNCH = ["j"];
const USE = ["e", "k"];
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...JUMP, ...DOWN, ...PUNCH, ...USE]);

export class Keys {
  held = new Set();
  pressed = new Set();

  /** Returns true when the key is the game's (the caller then stops the page scrolling). */
  down(key, repeat = false) {
    const k = key.toLowerCase();
    if (!repeat && !this.held.has(k)) this.pressed.add(k);
    this.held.add(k);
    return GAME_KEYS.has(k);
  }

  up(key) {
    this.held.delete(key.toLowerCase());
  }

  /** The window lost focus: nothing is held any more. */
  clear() {
    this.held.clear();
  }

  /** The intent for ONE step, consuming its presses. */
  take() {
    const has = (ks, s) => ks.some((k) => s.has(k));
    const l = has(LEFT, this.held), r = has(RIGHT, this.held);
    const intent = {
      dir: ((r ? 1 : 0) - (l ? 1 : 0)),
      jumpPressed: has(JUMP, this.pressed),
      jumpHeld: has(JUMP, this.held),
      drop: has(DOWN, this.held),
      punch: has(PUNCH, this.pressed),
      use: has(USE, this.pressed),
    };
    this.pressed.clear();
    return intent;
  }
}

/**
 * The fixed-step clock: how many steps a frame of dt seconds runs, carrying the remainder. A frame shorter
 * than a step runs none (the presses wait for the next frame).
 */
export class StepClock {
  acc = 0;
  step;
  maxSteps;
  constructor(step, maxSteps) {
    this.step = step;
    this.maxSteps = maxSteps;
  }

  steps(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= this.step && n < this.maxSteps) {
      this.acc -= this.step;
      n++;
    }
    if (n >= this.maxSteps) this.acc = 0;
    return n;
  }
}
