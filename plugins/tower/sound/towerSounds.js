import { figure, noise, P, tinkles, tone } from "./synthParts.js";

/**
 * Every Tower sound, exactly as the owner picked them by ear in the sound mock (2026-10-20; the picks are in
 * docs/research/2026-10-20-tower-intro-sound-brief.md and the mock is docs/design/tower-sound-mock.html).
 * `play(c, out, t, k, n)`: k is a pitch factor (±5 % for the frequent physical sounds), n the count or combo size.
 *
 * 🔴 TRIM keeps each one no louder than "someone joins your channel" at the same volume (the door's rule). The
 * numbers were measured the door's way and `e2e/tower-sound.spec.ts` re-measures them: if a change makes a sound
 * louder, lower its trim; never raise the limit.
 */

const COMBO_SCALE = [P.A4, P.C5, P.D5, P.E5, P.G5, P.A5];

export const SOUNDS = {
  // The climb
  jump: { vary: true, play: (c, o, t, k) => tone(c, o, t, "triangle", 330 * k, 520 * k, 0.09, 0.09) }, // soft hop
  land: { vary: true, play: (c, o, t, k) => { noise(c, o, t, 0.05, 0.14, { f: 380 * k }); tone(c, o, t, "sine", 140 * k, 60 * k, 0.12, 0.22); } }, // weighty thump
  spring: { play: (c, o, t) => { tone(c, o, t, "triangle", 260, 880, 0.24, 0.1); tone(c, o, t, "sine", 520, 1760, 0.2, 0.04); } }, // brass coil
  // The fight
  swing: { vary: true, play: (c, o, t, k) => noise(c, o, t, 0.09, 0.1, { type: "bandpass", f: 1200 * k, to: 400 * k }) }, // swish
  hit: { vary: true, play: (c, o, t, k) => { tone(c, o, t, "sine", 520 * k, 260 * k, 0.12, 0.24); noise(c, o, t, 0.04, 0.16, { f: 1200 }); } }, // cartoon bonk
  shieldUp: { play: (c, o, t) => { tone(c, o, t, "sine", 600, 1200, 0.3, 0.06, 0.04); tone(c, o, t + 0.02, "sine", 900, 1800, 0.3, 0.04, 0.04); } }, // shimmer
  shieldBreak: { play: (c, o, t) => { tone(c, o, t, "triangle", 1800, 900, 0.12, 0.08); tinkles(c, o, t, 4, 0.08, 0.03); } }, // glass
  // Pick-ups
  crate: { play: (c, o, t) => figure(c, o, t, [[987.77, 0, 0.06, 0.18], [1318.5, 0.07, 0.3, 0.2]]) }, // coin
  updraft: { play: (c, o, t) => noise(c, o, t, 0.45, 0.2, { type: "bandpass", f: 300, to: 3200, q: 1.4, attack: 0.05 }) }, // rising gust
  ink: { play: (c, o, t) => { noise(c, o, t, 0.08, 0.24, { f: 420 }); noise(c, o, t + 0.09, 0.1, 0.2, { f: 260 }); tone(c, o, t + 0.05, "sine", 220, 110, 0.2, 0.12); } }, // goopy
  slick: { play: (c, o, t) => { noise(c, o, t, 0.5, 0.1, { type: "bandpass", f: 4500, q: 4, attack: 0.08 }); tinkles(c, o, t, 6, 0.4, 0.03); } }, // frost
  bomb: { duck: true, trim: 0.43, play: (c, o, t) => { noise(c, o, t, 0.7, 0.5, { f: 900, to: 80 }); tone(c, o, t, "sine", 70, 30, 0.5, 0.35); } }, // boom
  grapple: { play: (c, o, t) => tone(c, o, t, "sawtooth", 300, 1500, 0.18, 0.035) }, // zip
  // The race (cues: fixed, on the game's voice)
  count: { trim: 0.85, play: (c, o, t, k, n) => figure(c, o, t, [[[P.G5, P.E5, P.D5][Math.max(0, Math.min(2, n))], 0, 0.14, 0.2]]) }, // falling counts
  go: { trim: 0.85, play: (c, o, t) => figure(c, o, t, [[P.C5, 0, 0.08, 0.18], [P.C6, 0.06, 0.5, 0.24]]) }, // GO leaps
  combo: { play: (c, o, t, k, n) => figure(c, o, t, [[COMBO_SCALE[Math.max(0, Math.min(5, n - 2))], 0, 0.16, 0.2]]) }, // one note, climbing
  hurry: { play: (c, o, t) => figure(c, o, t, [[P.G5, 0, 0.1, 0.2], [P.D5, 0.09, 0.1, 0.18], [P.G5, 0.18, 0.24, 0.22]]) }, // dip and return
  out: { play: (c, o, t) => noise(c, o, t, 0.6, 0.2, { type: "bandpass", f: 2400, to: 200, q: 1.2, attack: 0.03 }) }, // whoosh down
  win: { trim: 0.6, play: (c, o, t) => figure(c, o, t, [[P.G4, 0, 0.1, 0.16], [P.G4, 0.12, 0.1, 0.16], [P.C5, 0.24, 0.16, 0.2], [P.E5, 0.42, 0.12, 0.2], [P.G5, 0.54, 0.12, 0.22], [P.C6, 0.66, 0.8, 0.26]]) }, // little fanfare
};
