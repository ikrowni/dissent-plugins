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

/** One loop of mono samples in [-1, 1]: low wind with a slow swell, three drips, faded at both ends. */
export function ambienceSamples(sampleRate = 22050, seconds = 6, seed = 7) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const r = rng(seed);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += 0.02 * ((r() * 2 - 1) - lp);                       // low-passed noise: wind
    const swell = 0.55 + 0.45 * Math.sin((2 * Math.PI * i) / n); // one gust per loop, seamless
    out[i] = lp * swell * 2.5;
  }
  for (const at of dripTimes(seconds, seed)) {
    const start = Math.floor(at * sampleRate);
    const len = Math.floor(sampleRate * 0.12);
    for (let k = 0; k < len && start + k < n; k++) {
      const t = k / sampleRate;
      out[start + k] += 0.2 * Math.sin(2 * Math.PI * (1400 - 2500 * t) * t) * Math.exp(-t * 45);
    }
  }
  const fade = Math.floor(sampleRate * 0.05);
  for (let i = 0; i < fade; i++) { const g = i / fade; out[i] *= g; out[n - 1 - i] *= g; }
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}
