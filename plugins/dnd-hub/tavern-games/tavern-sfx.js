// tavern-sfx.js — small table sounds made on the spot (no files to ship): a die's clack, bone cracking, a coin.
// Shared by the tavern games. Quiet by design; a game that is muted by the browser simply plays silent.

let _ac = null;
const ac = () => {
  if (!_ac) { try { _ac = new AudioContext(); } catch { return null; } }
  if (_ac.state === 'suspended') _ac.resume().catch(() => {});
  return _ac;
};

function noise(a, dur, { freq = 2000, q = 1, gain = 0.25, type = 'bandpass' } = {}) {
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

/** A die landing on wood. */
export function clack(strength = 1) {
  const a = ac(); if (!a) return;
  noise(a, 0.06, { freq: 2400 + Math.random() * 800, q: 3, gain: 0.22 * strength });
  setTimeout(() => noise(a, 0.04, { freq: 3000, q: 4, gain: 0.08 * strength }), 70);
}

/** Bone cracking apart. */
export function crack() {
  const a = ac(); if (!a) return;
  noise(a, 0.18, { freq: 900, q: 0.7, gain: 0.35 });
  noise(a, 0.08, { freq: 4200, q: 2, gain: 0.15 });
}

/** A rattle of dice in a cup. */
export function rattle() {
  for (let i = 0; i < 5; i++) setTimeout(() => clack(0.35), i * 55 + Math.random() * 30);
}

/** A bright coin chime (a win). */
export function chime() {
  const a = ac(); if (!a) return;
  for (const [f, t] of [[1318, 0], [1760, 0.09], [2637, 0.18]]) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, a.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.12, a.currentTime + t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t + 0.5);
    o.connect(g).connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.55);
  }
}

/** Air cut by a thrown blade. */
export function whoosh() {
  const a = ac(); if (!a) return;
  noise(a, 0.28, { freq: 1200, q: 0.8, gain: 0.12 });
}

/** A blade biting into wood. */
export function thunk() {
  const a = ac(); if (!a) return;
  noise(a, 0.12, { freq: 380, q: 1.2, gain: 0.5, type: 'lowpass' });
  noise(a, 0.05, { freq: 2600, q: 3, gain: 0.12 });
}

/** A low drum hit (a beat, a slam on the table). */
export function thump(gain = 0.4) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(140, a.currentTime); o.frequency.exponentialRampToValueAtTime(48, a.currentTime + 0.18);
  g.gain.setValueAtTime(gain, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.22);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.25);
}

/** A soft tick (a beat to come, a card dealt). */
export function tick(gain = 0.1) {
  const a = ac(); if (!a) return;
  noise(a, 0.025, { freq: 5200, q: 6, gain });
}

/** A short sour note (a miss, a bust). */
export function buzz() {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sawtooth'; o.frequency.value = 110;
  g.gain.setValueAtTime(0.08, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.3);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.32);
}
