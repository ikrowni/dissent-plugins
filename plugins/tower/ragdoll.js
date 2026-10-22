/**
 * Going limp (spec §3.5, §8.4): when a figure is knocked, its joints become a rope-and-joints ragdoll (Verlet
 * points held at their bone lengths) that tumbles with the knock, the hip carried along by the figure's real path
 * (climb.js still decides where the body goes and what it lands on). When the stun ends it eases back into the pose.
 *
 * Purely visual and local: every machine flops every stunned figure itself, from where that figure moves. That is
 * why it needs no physics engine — the egg's Box2D ragdoll was the plan, but for a 0.6 s tumble this gives the
 * same flop with no 180 KB download, and it can be tested.
 */

const NAMES = ["hip", "neck", "head", "elbow0", "hand0", "elbow1", "hand1", "knee0", "foot0", "knee1", "foot1"];
/** Bones: pairs held at the length they had when the ragdoll began. */
const BONES = [
  ["hip", "neck"], ["neck", "head"], ["neck", "elbow0"], ["elbow0", "hand0"], ["neck", "elbow1"], ["elbow1", "hand1"],
  ["hip", "knee0"], ["knee0", "foot0"], ["hip", "knee1"], ["knee1", "foot1"],
  // A brace so the head doesn't fold into the chest.
  ["hip", "head"],
];
const GRAVITY = 1400;
const ITER = 6;
const EASE_S = 0.25;

export class Ragdoll {
  p = {};
  prev = {};
  len = [];
  /** Seconds easing back into the pose after the stun (0 = fully the ragdoll's). */
  easing = -1;

  /** Starts from the joints the figure has now, thrown with (vx, vy) and a spin. */
  constructor(from, vx, vy, spin, dt) {
    for (const n of NAMES) {
      const q = from[n];
      this.p[n] = { x: q.x, y: q.y };
      // A spin about the hip: points further from it move faster, sideways to it.
      const rx = q.x - from.hip.x, ry = q.y - from.hip.y;
      this.prev[n] = { x: q.x - (vx - ry * spin) * dt, y: q.y - (vy + rx * spin) * dt };
    }
    this.len = BONES.map(([a, b]) => Math.hypot(from[a].x - from[b].x, from[a].y - from[b].y));
  }

  /** One step: carried by the hip's real path (hipTo), flopping around it. */
  step(hipTo, dt) {
    const p = this.p, prev = this.prev;
    for (const n of NAMES) {
      const vx = p[n].x - prev[n].x, vy = p[n].y - prev[n].y;
      prev[n] = { x: p[n].x, y: p[n].y };
      p[n] = { x: p[n].x + vx * 0.99, y: p[n].y + vy * 0.99 + GRAVITY * dt * dt };
    }
    // The hip goes where the body really is.
    const dx = hipTo.x - p.hip.x, dy = hipTo.y - p.hip.y;
    p.hip = { x: hipTo.x, y: hipTo.y };
    prev.hip = { x: prev.hip.x + dx, y: prev.hip.y + dy };
    for (let it = 0; it < ITER; it++) {
      BONES.forEach(([a, b], i) => {
        const ax = p[a].x, ay = p[a].y, bx = p[b].x, by = p[b].y;
        const d = Math.hypot(bx - ax, by - ay) || 0.0001;
        const diff = (d - this.len[i]) / d;
        // The hip is pinned to the body; everything else gives.
        const wa = a === "hip" ? 0 : 0.5, wb = a === "hip" ? 1 : 0.5;
        p[a] = { x: ax + (bx - ax) * diff * wa, y: ay + (by - ay) * diff * wa };
        p[b] = { x: bx - (bx - ax) * diff * wb, y: by - (by - ay) * diff * wb };
      });
    }
  }

  /** Starts easing back into the pose. */
  recover() {
    if (this.easing < 0) this.easing = 0;
  }

  get done() {
    return this.easing >= EASE_S;
  }

  /** The joints to draw: the ragdoll's, blended toward the pose while recovering. */
  joints(pose, dt) {
    if (this.easing >= 0) this.easing = Math.min(EASE_S, this.easing + dt);
    const k = this.easing < 0 ? 0 : this.easing / EASE_S;
    const out = {};
    for (const n of NAMES) out[n] = { x: this.p[n].x + (pose[n].x - this.p[n].x) * k, y: this.p[n].y + (pose[n].y - this.p[n].y) * k };
    return out;
  }

  /** For tests: each bone's length now against the length it began with. */
  boneStretch() {
    return Math.max(...BONES.map(([a, b], i) => Math.abs(Math.hypot(this.p[a].x - this.p[b].x, this.p[a].y - this.p[b].y) - this.len[i])));
  }
}
