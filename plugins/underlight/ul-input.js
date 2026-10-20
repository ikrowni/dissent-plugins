// ul-input.js — keyboard and controller into one set of held keys and presses.
// 🔴 A press is kept until a fixed step uses it (the tower's lesson): clearing presses every frame drops jumps on
// screens over 120 Hz, where some frames run no step, and during the hit-stop freeze.

export const BINDINGS = Object.freeze({
  left: ['a', 'arrowleft', 'pad:left'], right: ['d', 'arrowright', 'pad:right'], down: ['s', 'arrowdown', 'pad:down'],
  jump: ['w', ' ', 'arrowup', 'pad:jump'], roll: ['shift', 'l', 'pad:roll'], attack: ['j', 'pad:attack'],
  block: ['k', 'pad:block'], throwL: ['e', 'i', 'pad:throw'], flask: ['f', 'pad:flask'],
});

export class Input {
  constructor() { this.keys = new Set(); this.pressed = new Set(); }
  down(k) { if (!this.keys.has(k)) this.pressed.add(k); this.keys.add(k); }
  up(k) { this.keys.delete(k); }
  clear() { this.keys.clear(); this.pressed.clear(); }
  held(action) { return BINDINGS[action].some((k) => this.keys.has(k)); }
  hit(action) { return BINDINGS[action].some((k) => this.pressed.has(k)); }
  /** What a step sees. Presses stay until consume(). */
  read() {
    return {
      dir: (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0), down: this.held('down'),
      jumpHeld: this.held('jump'), jump: this.hit('jump'), roll: this.hit('roll'), attack: this.hit('attack'),
      block: this.held('block'), blockPress: this.hit('block'), throwL: this.hit('throwL'), flask: this.hit('flask'),
    };
  }
  /** A step used the presses. */
  consume() { this.pressed.clear(); }
}

/** One snapshot of the first connected controller as virtual keys (standard mapping). */
export function padKeys(pad) {
  const now = new Set();
  if (!pad) return now;
  const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0, b = (i) => Boolean(pad.buttons[i] && pad.buttons[i].pressed);
  if (ax < -0.4 || b(14)) now.add('pad:left');
  if (ax > 0.4 || b(15)) now.add('pad:right');
  if (ay > 0.6 || b(13)) now.add('pad:down');
  if (b(0)) now.add('pad:jump');
  if (b(1)) now.add('pad:roll');
  if (b(2)) now.add('pad:attack');
  if (b(3)) now.add('pad:throw');
  if (b(5) || b(7)) now.add('pad:block');
  if (b(4) || b(6)) now.add('pad:flask');
  if (b(9)) now.add('pad:pause');
  return now;
}

/** Feed a controller snapshot into the input: new buttons are presses, released ones let go. */
export function applyPad(input, prev, now) {
  for (const k of now) if (!prev.has(k)) input.down(k);
  for (const k of prev) if (!now.has(k)) input.up(k);
  return now;
}
