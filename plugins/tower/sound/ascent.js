import { arcade, noise, SILENCE, strike, tone } from "./synthParts.js";

/**
 * "Ascent", the Tower's music (owner's pick 2026-10-20), composed in code like every other sound.
 *
 * A minor, 112 bpm, Am · F · C · G. An eight-bar melody: a question that hangs on G, then an answer that climbs
 * (the tower) and lands. The melody and arpeggio are on the game's voice (Arcade); a quiet, dark pad, bass and soft
 * drums are music-only. The melody uses only A minor pentatonic, so nothing clashes with the chords.
 *
 * It ADAPTS to the round (intensity 0–3):
 *   0  pad + bass                  the countdown
 *   1  + arpeggio + soft kick      GO
 *   2  + melody + hats + rim       the first "Hurry up!"
 *   3  + melody an octave up, busier hats, driving bass   later ones
 * and REACTS: `resolve()` plays the home chord and stops (you reached the top); `muffle()` low-passes it (you're
 * out); the engine ducks it under bombs.
 *
 * Scheduling is a look-ahead clock: notes are queued ~0.15 s ahead on the audio clock, from a 25 ms timer, so a
 * busy frame never makes the music stutter.
 */

const N = {
  F2: 87.31, G2: 98, A2: 110, C3: 130.81, F3: 174.61, G3: 196, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63,
  G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, A5: 880,
};
export const BPM = 112;
const CHORDS = [["A2", ["A3", "C4", "E4"]], ["F2", ["F3", "A3", "C4"]], ["C3", ["C4", "E4", "G4"]], ["G2", ["G3", "B3", "D4"]]];
/** [beat, note, beats] per bar. */
export const MELODY = [
  [[0, "E5", 1.5], [1.5, "D5", 0.5], [2, "C5", 1], [3, "A4", 1]],
  [[0, "C5", 1.5], [1.5, "A4", 0.5], [2, "C5", 0.5], [2.5, "D5", 1.5]],
  [[0, "E5", 1], [1, "G5", 1], [2, "E5", 1], [3, "D5", 1]],
  [[0, "D5", 2], [2, "G4", 0.5], [2.5, "A4", 0.5], [3, "C5", 1]],
  [[0, "A4", 0.5], [0.5, "C5", 0.5], [1, "D5", 0.5], [1.5, "E5", 0.5], [2, "G5", 1], [3, "E5", 1]],
  [[0, "A5", 1.5], [1.5, "G5", 0.5], [2, "E5", 1], [3, "C5", 1]],
  [[0, "D5", 0.5], [0.5, "E5", 0.5], [1, "G5", 1], [2, "E5", 0.5], [2.5, "D5", 0.5], [3, "C5", 1]],
  [[0, "D5", 2], [2, "E5", 1], [3, "A4", 1]],
];
/** Every melody note, for the test that nothing leaves A minor pentatonic. */
export const PENTATONIC_A_MINOR = ["A", "C", "D", "E", "G"];
export const noteName = (n) => n.replace(/[0-9]/g, "");

/** The game voice sits a touch louder per note than the gains below were written for. */
const VOICE = 0.55;

function pad(c, out, f, t, dur, vol) {
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  lp.connect(out);
  for (const det of [-6, 6]) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    o.detune.value = det;
    g.gain.setValueAtTime(SILENCE, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.45);
    g.gain.setValueAtTime(vol, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(SILENCE, t + dur + 0.7);
    o.connect(g); g.connect(lp);
    o.start(t); o.stop(t + dur + 0.8);
  }
}

function bass(c, out, f, t, dur, vol) {
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 420;
  lp.connect(out);
  for (const [type, v] of [["sine", 1], ["triangle", 0.5]]) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    strike(g, vol * v, t, dur, 0.01);
    o.connect(g); g.connect(lp);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

/** Plays one sixteenth-note step of the piece at time t (exported for the offline loudness test). */
export function playStep(c, out, step, t, intensity) {
  const s16 = 60 / BPM / 4, L = intensity, bar = Math.floor(step / 16), inBar = step % 16, beat = inBar / 4;
  const [bassName, chord] = CHORDS[bar % 4];
  if (inBar === 0) for (const n of chord) pad(c, out, N[n], t, s16 * 16, 0.04);
  const root = N[bassName];
  if (L >= 3) { if (inBar % 2 === 0) bass(c, out, inBar % 8 === 4 ? root * 2 : root, t, s16 * 1.8, 0.2); }
  else if (inBar === 0) bass(c, out, root, t, s16 * 6, 0.22);
  else if (inBar === 6 && L >= 1) bass(c, out, root, t, s16 * 2, 0.16);
  else if (inBar === 8) bass(c, out, root * 2, t, s16 * 4, 0.17);
  if (L >= 1) {
    const tones = [...chord.map((n) => N[n] * 2), ...chord.map((n) => N[n] * 4)];
    arcade(c, out, tones[inBar % tones.length], t, 0.12, (0.05 + (inBar % 4 === 0 ? 0.015 : 0)) * VOICE);
  }
  if (L >= 1 && (inBar % 8 === 0 || (L >= 3 && inBar % 4 === 0))) tone(c, out, t, "sine", 110, 42, 0.26, 0.32, 0.002);
  if (L >= 2 && (L >= 3 || inBar % 2 === 0)) noise(c, out, t, 0.035, inBar % 4 === 2 ? 0.05 : 0.03, { type: "highpass", f: 7500 });
  if (L >= 2 && (inBar === 4 || inBar === 12)) {
    noise(c, out, t, 0.06, 0.1, { type: "bandpass", f: 1900, q: 1.5 });
    tone(c, out, t, "triangle", 190, 150, 0.05, 0.04);
  }
  if (L >= 2) {
    for (const [b, n, dur] of MELODY[bar % 8]) {
      if (Math.abs(b - beat) > 1e-6) continue;
      arcade(c, out, N[n], t, dur * s16 * 4 * 0.9, 0.13 * VOICE);
      if (L >= 3) arcade(c, out, N[n] * 2, t, dur * s16 * 4 * 0.7, 0.05 * VOICE);
    }
  }
}

/** The home chord, plucked and held: the end of the music when you reach the top. */
function homeChord(c, out, t) {
  const [b, chord] = CHORDS[0];
  bass(c, out, N[b], t, 2.4, 0.22);
  chord.forEach((n, i) => { pad(c, out, N[n], t, 2.4, 0.045); arcade(c, out, N[n] * 2, t + i * 0.06, 0.6, 0.12 * VOICE); });
}

export class AscentPlayer {
  step = 0;
  next = 0;
  timer = null;
  ending = false;
  intensity = 0;

  c;
  out;
  constructor(c, out) {
    this.c = c;
    this.out = out;
  }

  get playing() {
    return this.timer !== null;
  }

  start() {
    if (this.timer) return;
    this.step = 0;
    this.ending = false;
    this.next = this.c.currentTime + 0.12;
    this.timer = setInterval(() => this.tick(), 25);
  }

  setIntensity(n) {
    this.intensity = Math.max(0, Math.min(3, n));
  }

  /** Reaching the top: the next bar is the home chord, then silence. */
  resolve() {
    this.ending = true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const s16 = 60 / BPM / 4;
    while (this.timer && this.next < this.c.currentTime + 0.15) {
      if (this.ending && this.step % 16 === 0) {
        homeChord(this.c, this.out, this.next);
        this.stop();
        return;
      }
      playStep(this.c, this.out, this.step, this.next, this.intensity);
      this.step++;
      this.next += s16;
    }
  }
}
