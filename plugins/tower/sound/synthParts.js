/**
 * The building blocks every Tower sound is made from (spec 2026-10-19-tower-game-design §8.5): the game's own
 * voice, "Arcade" (a square wave with a triangle sub), plus noise bursts, simple oscillators and glass tinkles.
 * Synthesised: no files, no licence, no outside request.
 *
 * 🔴 Never the app's pluck (src/lib/sfx/instrument.ts). Owner, 2026-10-20: game sounds "sound like the dissent join
 * and leave sound effects … id rather them be unique". The pluck is for app events only.
 */

export const SILENCE = 0.0001;

/** Attack then an exponential fall to silence. */
export function strike(g, peak, t, len, attack) {
  const a = Math.min(attack, len / 3);
  g.gain.setValueAtTime(SILENCE, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, SILENCE * 2), t + a);
  g.gain.exponentialRampToValueAtTime(SILENCE, t + len);
}

const noises = new WeakMap();
function noiseBuffer(c) {
  let b = noises.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noises.set(c, b);
  }
  return b;
}

/** One oscillator note, optionally gliding to `to`. */
export function tone(c, out, t, type, f, to, dur, vol, attack = 0.004) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  strike(g, vol, t, dur, attack);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

/** A filtered noise burst, optionally sweeping its filter to `to`. */
export function noise(c, out, t, dur, vol, o = {}) {
  const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuffer(c);
  fl.type = o.type ?? "lowpass";
  fl.frequency.setValueAtTime(o.f ?? 1000, t);
  if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  fl.Q.value = o.q ?? 0.7;
  strike(g, vol, t, dur, o.attack ?? 0.002);
  s.connect(fl); fl.connect(g); g.connect(out);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

/** A few short high glass notes, scattered over `spread` seconds. */
export function tinkles(c, out, t, n, spread, vol) {
  for (let i = 0; i < n; i++) tone(c, out, t + Math.random() * spread, "sine", 2200 + Math.random() * 2600, null, 0.05 + Math.random() * 0.12, vol, 0.002);
}

/** One note on the game's voice, Arcade: a bright square wave (lowpassed) with a triangle sub an octave down. */
export function arcade(c, out, f, t, dur, vol) {
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5200;
  lp.connect(out);
  const o = c.createOscillator(), g = c.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(SILENCE, t);
  g.gain.exponentialRampToValueAtTime(vol * 0.42, t + 0.004);
  g.gain.setValueAtTime(vol * 0.42, t + Math.max(0.01, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(SILENCE, t + dur + 0.06);
  o.connect(g); g.connect(lp);
  o.start(t); o.stop(t + dur + 0.08);
  const sub = c.createOscillator(), sg = c.createGain();
  sub.type = "triangle";
  sub.frequency.setValueAtTime(f / 2, t);
  strike(sg, vol * 0.3, t, dur + 0.06, 0.004);
  sub.connect(sg); sg.connect(out);
  sub.start(t); sub.stop(t + dur + 0.08);
}

/** A figure of notes on the game's voice: [freq, at, dur, gain][]. */
export function figure(c, out, t0, notes) {
  for (const [f, at, dur, g] of notes) arcade(c, out, f, t0 + at, dur, g);
}

/** Pentatonic pitches used by the cues (no semitones: nothing grinds). */
export const P = { G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, A5: 880, C6: 1046.5 };
