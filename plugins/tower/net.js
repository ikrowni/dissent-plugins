import { NET } from "./tuning.js";

/**
 * Showing another player (spec §7.1, Gaffer on Games' snapshot interpolation): their positions arrive about
 * 20 a second, each stamped with THEIR race clock. We learn the gap between their clock and ours (the
 * smallest receive-minus-sent seen: the fastest message) and draw them NET.delayMs behind that, sliding
 * between the two positions around the moment. Nothing new → keep moving for NET.extrapolateMs, then stop.
 */

export class Remote {
  snaps = [];
  offset = Infinity;

  /** A position arrived at our race time nowMs. Out-of-order or repeated messages are dropped. */
  push(m, nowMs) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && m.t <= last.t) return;
    this.offset = Math.min(this.offset, nowMs - m.t);
    this.snaps.push(m);
    if (this.snaps.length > 40) this.snaps.shift();
  }

  get latest() {
    return this.snaps[this.snaps.length - 1];
  }

  /** Where to draw them at our race time nowMs, or null before anything arrived. */
  at(nowMs, delayMs = NET.delayMs) {
    const n = this.snaps;
    if (!n.length) return null;
    const rt = nowMs - this.offset - delayMs;
    const i = n.findIndex((s) => s.t >= rt);
    if (i === -1) {
      const l = n[n.length - 1];
      const e = Math.min(rt - l.t, NET.extrapolateMs) / 1000;
      return shown(l, l.x + l.vx * e, l.y + (l.g ? 0 : l.vy * e));
    }
    if (i === 0) return shown(n[0], n[0].x, n[0].y);
    const a = n[i - 1], b = n[i];
    // A jump of more than three floors in one message is a teleport (respawn): don't slide across it.
    if (Math.abs(b.y - a.y) > 250) return shown(b, b.x, b.y);
    const k = (rt - a.t) / (b.t - a.t || 1);
    return shown(a, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
  }
}

function shown(s, x, y) {
  return {
    x, y, vx: s.vx, vy: s.vy, onGround: s.g === 1, facing: s.f, phase: s.ph / 100, squash: s.sq / 100, blink: s.bl === 1, best: s.b,
    stunned: s.st === 1, shield: s.sh === 1, punching: s.pu === 1, item: s.it ?? 0,
  };
}

/** When to send the next position: every NET.sendMs, or twice that while the node says we're too fast. */
export class Sender {
  next = 0;
  backoffUntil = -1;

  limited(nowMs) {
    this.backoffUntil = nowMs + NET.backoffMs;
  }

  due(nowMs) {
    if (nowMs < this.next) return false;
    this.next = nowMs + (nowMs < this.backoffUntil ? NET.sendMs * 2 : NET.sendMs);
    return true;
  }
}
