// dagger-toss-rules.js — Dagger Toss without the drawing: where a throw lands and what it scores.
//
// Board units: the board's centre is (0, 0) and its rim is radius 1. Three throws each, hero then host, highest
// total wins. The hero's hand sways (less with Dexterity); holding builds power, and power off the sweet spot makes
// the dagger land high or low. The host throws with a scatter set by how good the DM made them.

export const THROWS = 3;
export const RINGS = [[0.07, 50, 'Heart'], [0.18, 25, 'Inner ring'], [0.42, 10, ''], [0.7, 5, ''], [1, 2, '']];
export const SWEET = 0.72;          // the power that flies true
export const HOST_SCATTER = { novice: 0.5, regular: 0.34, shark: 0.21 };

/** Points for a dagger at (x, y), and the ring's name. Off the board scores nothing. */
export function scoreAt(x, y) {
  const d = Math.hypot(x, y);
  for (const [r, pts, name] of RINGS) if (d <= r) return { pts, name };
  return { pts: 0, name: 'Miss' };
}

/** How far the hand sways, from the stat edge (-1..1): 0.55 at +0, 0.24 at +5, 0.86 at -5. */
export const swayAmp = edge => 0.55 * (1 - 0.56 * Math.max(-1, Math.min(1, edge || 0)));

/** Where the hand points at time t (seconds), around the aim. A smooth figure that never quite repeats. */
export function sway(t, amp) {
  return { x: amp * (0.62 * Math.sin(1.3 * t) + 0.38 * Math.sin(3.1 * t + 1)), y: amp * (0.6 * Math.cos(1.1 * t) + 0.4 * Math.sin(2.7 * t + 2)) };
}

/** The power meter at time t since the press began: 0..1, back and forth every 1.6 s. */
export const powerAt = t => 1 - Math.abs(((t / 0.8) % 2) - 1);

/** Where a hero's dagger lands: the aim plus the sway at release, high or low by the power, and a little luck. */
export function heroLanding(aim, swayed, power, rng = Math.random) {
  const dy = (SWEET - power) * 0.9; // too weak drops low (positive y is down), too strong flies high
  return { x: aim.x + swayed.x + (rng() - 0.5) * 0.04, y: aim.y + swayed.y + dy + (rng() - 0.5) * 0.04 };
}

/** A host's throw: aimed at the heart, scattered by skill (a gaussian), wider when someone loosened the board. */
export function hostLanding(skill = 'regular', rng = Math.random, loosened = false) {
  const s = (HOST_SCATTER[skill] ?? HOST_SCATTER.regular) * (loosened ? 1.7 : 1);
  const g = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return { x: g() * s * 0.7, y: g() * s * 0.7 };
}

/** 'hero', 'host' or 'draw' from the two lists of points. */
export function winner(hero, host) {
  const a = hero.reduce((t, v) => t + v, 0), b = host.reduce((t, v) => t + v, 0);
  return a > b ? 'hero' : b > a ? 'host' : 'draw';
}
