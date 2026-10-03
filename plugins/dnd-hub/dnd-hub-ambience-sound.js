// dnd-hub-ambience-sound.js — the default session ambience, made in code: wind and a distant drip. Pure (samples
// only); dnd-hub-ambience.js plays them. No audio file, so nothing to license (spec 2026-10-03 §6).
//
// What the owner heard (2026-10-03): v1 (one big swell of broadband noise, a falling 120 ms chirp) = "ocean waves
// with a bird"; v2 (drips baked into a 6 s loop) = "wind and a single drip over and over". So the wind is the loop
// and each drip is made on its own, different every time, at irregular gaps.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * One seamless loop of wind, mono, in [-1, 1]: noise through a band-pass whose centre drifts slowly (the whistle)
 * over a low rumble, with gentle, irregular gusts; faded at both ends so the loop has no click.
 */
export function windSamples(sampleRate = 22050, seconds = 6, seed = 7) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const r = rng(seed);
  const TAU = 2 * Math.PI;
  let rumble = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const ph = i / n;                                        // whole cycles across the loop keep it seamless
    const noise = r() * 2 - 1;
    rumble += 0.004 * (noise - rumble);
    const f = 380 + 140 * Math.sin(TAU * ph) + 60 * Math.sin(TAU * 3 * ph + 1.3);
    const w0 = TAU * f / sampleRate, alpha = Math.sin(w0) / (2 * 2.2), a0 = 1 + alpha;
    const y = (alpha * noise - alpha * x2 + 2 * Math.cos(w0) * y1 - (1 - alpha) * y2) / a0; // RBJ band-pass
    x2 = x1; x1 = noise; y2 = y1; y1 = y;
    const gust = 0.8 + 0.12 * Math.sin(TAU * 2 * ph + 0.7) + 0.08 * Math.sin(TAU * 5 * ph + 2.1);
    out[i] = (y * 0.55 + rumble * 4) * gust;
  }
  const fade = Math.floor(sampleRate * 0.05);
  for (let i = 0; i < fade; i++) { const g = i / fade; out[i] *= g; out[n - 1 - i] *= g; }
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

/**
 * One drip, a short RISING blip (water, not a bird) and an echo. `v` in [0, 1] varies its pitch, loudness, length
 * and echo, so no two drips in a row sound alike.
 */
export function dripSamples(sampleRate = 22050, v = 0.5) {
  const TAU = 2 * Math.PI;
  const base = 550 + 500 * v;                                // where the pitch starts
  const rise = 800 + 900 * ((v * 7.3) % 1);                  // how far it rises
  const len = 0.03 + 0.025 * ((v * 3.1) % 1);                // 30–55 ms
  const level = 0.09 + 0.08 * ((v * 5.7) % 1);
  const echoDelay = 0.07 + 0.08 * ((v * 2.3) % 1), echoLevel = 0.25 + 0.2 * ((v * 4.9) % 1);
  const n = Math.floor(sampleRate * (echoDelay + len + 0.05));
  const out = new Float32Array(n);
  for (const [at, gain] of [[0, 1], [echoDelay, echoLevel]]) {
    const start = Math.floor(at * sampleRate);
    let phase = 0;
    for (let k = 0; k < len * sampleRate && start + k < n; k++) {
      const t = k / sampleRate;
      phase += TAU * (base + rise * (t / len)) / sampleRate;
      out[start + k] += level * gain * Math.sin(phase) * Math.exp(-t * (90 + 60 * v));
    }
  }
  return out;
}

/** Seconds until the next drip, from a uniform random number in [0, 1): irregular, 3 to 9 s. */
export const nextDripDelay = u => 3 + 6 * Math.min(0.999, Math.max(0, u));
