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
