import { MOVE } from "./tuning.js";

/**
 * The stick figure, posed procedurally from how it moves (the mock's figure, which the owner approved): run
 * cycle from speed, tucked legs rising, arms out falling, squash on landing. World units, feet at (x, y). Night
 * look: cream lines with a soft amber glow; the head is filled with the player's colour.
 *
 * The pose is a set of joint POINTS (posePoints), so the ragdoll (ragdoll.js) can take over from exactly where
 * the figure stood when it was hit, and hand back to it.
 */

export const HEAD_R = 6.6;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function bend(ox, oy, a1, a2, len, f) {
  const kx = ox + Math.sin(a1) * len * f, ky = oy + Math.cos(a1) * len;
  return [{ x: kx, y: ky }, { x: kx + Math.sin(a1 + a2) * len * f, y: ky + Math.cos(a1 + a2) * len }];
}

/** Where every joint is for this pose, in world units (squash applied). */
export function posePoints(s, nowS, reduced) {
  const f = s.facing;
  let lt1, lk1, lt2, lk2, au1, af1, au2, af2;
  let lean = 0;
  if (!s.onGround) {
    if (s.vy < 0) [lt1, lk1, lt2, lk2, au1, af1, au2, af2] = [1.0, -1.5, -0.25, -0.5, 2.7, 0.3, -2.6, -0.2];
    else [lt1, lk1, lt2, lk2, au1, af1, au2, af2] = [0.4, -0.3, -0.35, 0.2, 1.9, 0.5, -1.9, -0.5];
    lean = clamp(s.vx / MOVE.run, -1, 1) * 0.12 * f;
  } else if (Math.abs(s.vx) > 20) {
    const ph = s.phase, amp = clamp(Math.abs(s.vx) / MOVE.run, 0.4, 1);
    lt1 = Math.sin(ph) * 0.8 * amp; lk1 = -Math.max(0, -Math.cos(ph)) * 1.2 - 0.1;
    lt2 = Math.sin(ph + Math.PI) * 0.8 * amp; lk2 = -Math.max(0, -Math.cos(ph + Math.PI)) * 1.2 - 0.1;
    au1 = -Math.sin(ph) * 0.9 * amp; af1 = 1.2; au2 = Math.sin(ph) * 0.9 * amp; af2 = 1.2;
    lean = 0.18 * amp;
  } else {
    const br = reduced ? 0 : Math.sin(nowS * 2.2) * 0.04;
    [lt1, lk1, lt2, lk2, au1, af1, au2, af2] = [0.14, -0.05, -0.14, 0.05, 0.18 + br, 0.25, -0.18 - br, 0.2];
  }
  if (s.punching) { au1 = 1.62; af1 = 0; }
  const hipY = -21, shY = -36, shX = Math.sin(lean) * 15 * f;
  const [knee1, foot1] = bend(0, hipY, lt1, lk1, 10.5, f);
  const [knee0, foot0] = bend(0, hipY, lt2, lk2, 10.5, f);
  const [elbow1, hand1] = bend(shX, shY + 1, au1, af1, 8.6, f);
  const [elbow0, hand0] = bend(shX, shY + 1, au2, af2, 8.6, f);
  const local = {
    hip: { x: 0, y: hipY }, neck: { x: shX, y: shY }, head: { x: shX * 1.15, y: shY - 8 },
    elbow0, hand0, elbow1, hand1, knee0, foot0, knee1, foot1,
  };
  const sq = clamp(s.squash, -0.8, 1) * 0.28;
  const out = {};
  for (const k of Object.keys(local)) out[k] = { x: s.x + local[k].x * (1 + sq), y: s.y + local[k].y * (1 - sq) };
  return out;
}

/** Draws a figure from its joints (posed, or the ragdoll's). */
export function drawJoints(c, j, color, alpha, shield, nowS) {
  c.save();
  c.globalAlpha = alpha;
  c.lineCap = "round";
  c.lineJoin = "round";
  // The glow is the same path stroked wide and faint first: shadowBlur costs a blur per frame per figure.
  c.beginPath();
  c.moveTo(j.hip.x, j.hip.y); c.lineTo(j.neck.x, j.neck.y);
  c.moveTo(j.hip.x, j.hip.y); c.lineTo(j.knee0.x, j.knee0.y); c.lineTo(j.foot0.x, j.foot0.y);
  c.moveTo(j.hip.x, j.hip.y); c.lineTo(j.knee1.x, j.knee1.y); c.lineTo(j.foot1.x, j.foot1.y);
  c.moveTo(j.neck.x, j.neck.y + 1); c.lineTo(j.elbow0.x, j.elbow0.y); c.lineTo(j.hand0.x, j.hand0.y);
  c.moveTo(j.neck.x, j.neck.y + 1); c.lineTo(j.elbow1.x, j.elbow1.y); c.lineTo(j.hand1.x, j.hand1.y);
  c.strokeStyle = "rgba(255,190,118,.22)";
  c.lineWidth = 8;
  c.stroke();
  c.strokeStyle = "#f3e6cf";
  c.lineWidth = 3;
  c.stroke();
  c.beginPath();
  c.arc(j.head.x, j.head.y, HEAD_R, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
  c.stroke();
  if (shield) {
    c.globalAlpha = alpha * (0.5 + Math.sin(nowS * 8) * 0.15);
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(j.hip.x, j.hip.y - 3, 22, 30, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
}

export function drawFigure(c, s, nowS, reduced) {
  const alpha = s.blink && Math.floor(nowS * 14) % 2 ? 0.35 : 1;
  drawJoints(c, posePoints(s, nowS, reduced), s.color, alpha, !!s.shield, nowS);
}
