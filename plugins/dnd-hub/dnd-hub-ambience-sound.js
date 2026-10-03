// dnd-hub-ambience-sound.js — the default session ambience, made in code: wind and a distant drip. Pure (samples
// only); dnd-hub-ambience.js plays them. No audio file, so nothing to license (spec 2026-10-03 §6).

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** When the three drips fall in a loop of `seconds` (away from the seam). */
export function dripTimes(seconds, seed) {
  const r = rng(seed ^ 0x5bd1e995);
  const span = seconds - 0.9;
  return [0, 1, 2].map(i => 0.3 + span * (i + 0.2 + 0.6 * r()) / 3);
}

/**
 * One loop of mono samples in [-1, 1], faded at both ends so the loop has no click.
 * Wind = noise through a band-pass whose centre drifts slowly (the whistle) over a low rumble, with gentle,
 * irregular gusts. A first version (one big swell of broadband noise, a falling 120 ms chirp) sounded like ocean
 * waves and a bird (owner, 2026-10-03). Drip = a 40 ms RISING blip and a faint echo, like water in a stone room.
 */
export function ambienceSamples(sampleRate = 22050, seconds = 6, seed = 7) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const r = rng(seed);
  const TAU = 2 * Math.PI;
  let rumble = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const ph = i / n;                                        // 0..1 across the loop; whole cycles keep it seamless
    const noise = r() * 2 - 1;
    rumble += 0.004 * (noise - rumble);                      // deep, slow rumble
    // Band-pass (RBJ biquad) with a drifting centre: the whistle of wind through a gap.
    const f = 380 + 140 * Math.sin(TAU * ph) + 60 * Math.sin(TAU * 3 * ph + 1.3);
    const w0 = TAU * f / sampleRate, alpha = Math.sin(w0) / (2 * 2.2), a0 = 1 + alpha;
    const y = (alpha * noise - alpha * x2 + 2 * Math.cos(w0) * y1 - (1 - alpha) * y2) / a0;
    x2 = x1; x1 = noise; y2 = y1; y1 = y;
    const gust = 0.8 + 0.12 * Math.sin(TAU * 2 * ph + 0.7) + 0.08 * Math.sin(TAU * 5 * ph + 2.1);
    out[i] = (y * 0.55 + rumble * 4) * gust;
  }
  for (const at of dripTimes(seconds, seed)) {
    for (const [delay, level] of [[0, 0.16], [0.09, 0.05]]) {   // the drip and its echo
      const start = Math.floor((at + delay) * sampleRate);
      const len = Math.floor(sampleRate * 0.04);
      let phase = 0;
      for (let k = 0; k < len && start + k < n; k++) {
        const t = k / sampleRate;
        phase += TAU * (700 + 1100 * (t / 0.04)) / sampleRate;  // pitch rises: a drop, not a chirp
        out[start + k] += level * Math.sin(phase) * Math.exp(-t * 110);
      }
    }
  }
  const fade = Math.floor(sampleRate * 0.05);
  for (let i = 0; i < fade; i++) { const g = i / fade; out[i] *= g; out[n - 1 - i] *= g; }
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}
