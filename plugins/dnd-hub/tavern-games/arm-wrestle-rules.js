// arm-wrestle-rules.js — Arm Wrestle without the drawing: the tug, the timing band, and the host's strength.
//
// `p` runs from -1 (the host slams your hand down) to 1 (you slam theirs). A marker sweeps a bar; press while it is
// inside the bright band to push (dead centre pushes hardest), miss and you give ground. The host leans on you all
// the time, and now and then heaves. Strength widens the band. Longest bout: TIME_LIMIT seconds.

export const TIME_LIMIT = 45;
export const PUSH = { hit: 0.11, perfect: 0.17, miss: -0.07 };
export const HOST_LEAN = { novice: 0.045, regular: 0.065, shark: 0.085 };   // per second
export const HOST_HEAVE = { novice: 0.09, regular: 0.12, shark: 0.16 };

export const bandWidth = edge => Math.min(0.3, Math.max(0.06, 0.16 * (1 + 0.7 * (edge || 0))));

/** The marker on the bar (0..1) after t seconds: back and forth, a little faster as the bout goes on. */
export function markerAt(t) {
  const cycles = 0.55 * t + 0.012 * t * t; // ∫ (0.55 + 0.024 t) dt
  const f = cycles % 1;
  return f < 0.5 ? f * 2 : 2 - f * 2;
}

/** What a press is worth: hit, perfect, or miss. `band` = { at (centre, 0..1), width }. */
export function press(marker, band) {
  const off = Math.abs(marker - band.at);
  if (off <= band.width / 6) return { kind: 'perfect', push: PUSH.perfect };
  if (off <= band.width / 2) return { kind: 'hit', push: PUSH.hit };
  return { kind: 'miss', push: PUSH.miss };
}

/** A new place for the band after a hit, never right where it was. */
export function nextBand(band, rng = Math.random) {
  let at;
  do { at = band.width / 2 + rng() * (1 - band.width); } while (Math.abs(at - band.at) < 0.2);
  return { at, width: band.width };
}

/** The host's lean over `dt` seconds. */
export const lean = (skill, dt) => -(HOST_LEAN[skill] ?? HOST_LEAN.regular) * dt;

export const clampP = p => Math.max(-1, Math.min(1, p));

/** 'hero', 'host', 'draw', or null while the bout goes on. */
export function boutResult(p, t) {
  if (p >= 1) return 'hero';
  if (p <= -1) return 'host';
  if (t >= TIME_LIMIT) return p > 0.02 ? 'hero' : p < -0.02 ? 'host' : 'draw';
  return null;
}
