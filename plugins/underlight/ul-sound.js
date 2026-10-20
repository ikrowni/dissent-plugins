// ul-sound.js — every sound is synthesised (nothing to download, nothing to license). Plays the fx 'sfx' events.
let AC = null, master = null, noiseBuf = null, muted = false, volume = 1, appVolume = 1, deafened = false;

/** How loud, 0..0.5: your game volume times the app's volume (a games-hub rule: follow game.sound), nothing when
 *  deafened or muted. */
export const soundLevel = () => (muted || deafened ? 0 : 0.5 * volume * appVolume);
const apply = () => { if (master) master.gain.value = soundLevel(); };
export function setVolume(v) { volume = Math.max(0, Math.min(1, v)); apply(); }
/** From the host's game.sound: { volume: 0..1, deafened }. */
export function setAppSound(s) { if (!s) return; appVolume = Math.max(0, Math.min(1, Number(s.volume ?? 1))); deafened = Boolean(s.deafened); apply(); }

/** Call from a click or key press: browsers only start audio after one. */
export function unlockAudio() {
  if (!AC) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    AC = new C(); master = AC.createGain(); master.gain.value = soundLevel(); master.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
}
export function setMuted(m) { muted = m; apply(); }
export const isMuted = () => muted;

function tone(f, d, { type = 'sine', vol = 0.2, to = null, at = 0, attack = 0.005 } = {}) {
  if (!AC || !soundLevel()) return;
  const t = AC.currentTime + at, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(master); o.start(t); o.stop(t + d + 0.02);
}
function noise(d, { type = 'lowpass', freq = 1000, q = 0.7, vol = 0.3, at = 0, to = null } = {}) {
  if (!AC || !soundLevel()) return;
  if (!noiseBuf) {
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; // texture only; never game state
  }
  const t = AC.currentTime + at, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + d + 0.02);
}

export const SFX = {
  jump: () => tone(260, 0.09, { type: 'triangle', vol: 0.06, to: 380 }),
  land: () => noise(0.08, { freq: 260, vol: 0.12 }),
  swing: () => noise(0.13, { type: 'bandpass', freq: 1500, to: 500, q: 1.2, vol: 0.16 }),
  hit: () => { tone(110, 0.1, { type: 'square', vol: 0.1, to: 70 }); noise(0.07, { freq: 1800, vol: 0.14 }); },
  parry: () => { tone(1320, 0.5, { vol: 0.16 }); tone(1985, 0.35, { vol: 0.09 }); tone(660, 0.2, { type: 'triangle', vol: 0.08 }); },
  block: () => tone(420, 0.06, { type: 'square', vol: 0.07 }),
  hurt: () => { tone(190, 0.22, { type: 'sawtooth', vol: 0.12, to: 85 }); noise(0.12, { freq: 600, vol: 0.12 }); },
  dodge: () => tone(1250, 0.07, { vol: 0.05, to: 1600 }),
  roll: () => noise(0.16, { type: 'bandpass', freq: 700, to: 300, q: 0.8, vol: 0.08 }),
  shadeTell: () => noise(0.5, { type: 'highpass', freq: 2600, to: 5200, vol: 0.12 }),
  mothTell: () => { tone(70, 0.5, { type: 'sawtooth', vol: 0.06, to: 150 }); noise(0.5, { type: 'bandpass', freq: 300, q: 4, vol: 0.08 }); },
  snuffTell: () => noise(0.8, { freq: 260, to: 1700, vol: 0.16 }),
  snuffed: () => { noise(0.3, { freq: 900, to: 120, vol: 0.2 }); tone(240, 0.4, { vol: 0.09, to: 100 }); },
  sconce: () => { noise(0.35, { freq: 500, to: 2400, vol: 0.12 }); tone(660, 0.6, { vol: 0.07, at: 0.08 }); tone(990, 0.7, { vol: 0.05, at: 0.14 }); },
  throw: () => noise(0.2, { type: 'bandpass', freq: 600, to: 1600, q: 1, vol: 0.1 }),
  recall: () => noise(0.2, { type: 'bandpass', freq: 1600, to: 600, q: 1, vol: 0.1 }),
  oil: () => tone(880, 0.1, { vol: 0.06, to: 1320 }),
  die: () => { noise(0.3, { freq: 1200, to: 200, vol: 0.14 }); tone(300, 0.3, { type: 'triangle', vol: 0.07, to: 90 }); },
  beat: () => { tone(58, 0.16, { vol: 0.22 }); tone(52, 0.16, { vol: 0.18, at: 0.2 }); },
  drink: () => { tone(500, 0.12, { vol: 0.06, to: 700 }); tone(600, 0.12, { vol: 0.05, at: 0.15, to: 800 }); },
  // piece 1c: the Cellars' new foes and the Rat King. Underlight's own voice: noise and low tones, never the app's pluck
  squeak: () => { tone(2200, 0.06, { type: 'square', vol: 0.03, to: 3100 }); tone(2600, 0.05, { type: 'square', vol: 0.025, at: 0.07, to: 1900 }); },
  toss: () => noise(0.18, { type: 'bandpass', freq: 900, to: 400, q: 1.5, vol: 0.08 }),
  bottleTell: () => { noise(0.3, { type: 'bandpass', freq: 350, q: 3, vol: 0.06 }); tone(150, 0.3, { type: 'sawtooth', vol: 0.04, to: 220 }); },
  glass: () => { noise(0.18, { type: 'highpass', freq: 3500, vol: 0.14 }); for (const [f, at] of [[3100, 0.02], [4200, 0.06], [3700, 0.1]]) tone(f, 0.12, { vol: 0.025, at }); },
  clank: () => { tone(230, 0.18, { type: 'square', vol: 0.06, to: 180 }); noise(0.1, { type: 'bandpass', freq: 1400, q: 5, vol: 0.1 }); },
  lidTell: () => noise(0.5, { type: 'bandpass', freq: 220, to: 120, q: 2, vol: 0.12 }),
  kingTell: () => { tone(70, 0.6, { type: 'sawtooth', vol: 0.1, to: 55 }); noise(0.6, { freq: 300, to: 900, vol: 0.1 }); },
  slamTell: () => { tone(90, 0.5, { type: 'sawtooth', vol: 0.09, to: 160 }); noise(0.5, { type: 'highpass', freq: 1200, to: 3000, vol: 0.06 }); },
  shockwave: () => { tone(45, 0.6, { vol: 0.28, to: 30 }); noise(0.5, { freq: 180, to: 60, vol: 0.22 }); },
  roar: () => { tone(60, 1.0, { type: 'sawtooth', vol: 0.12, to: 40 }); noise(1.0, { freq: 500, to: 150, vol: 0.14 }); for (let i = 0; i < 4; i++) tone(1900 + i * 300, 0.08, { type: 'square', vol: 0.02, at: 0.1 + i * 0.12 }); },
  chew: () => { for (let i = 0; i < 3; i++) noise(0.07, { type: 'bandpass', freq: 600, q: 2, vol: 0.1, at: i * 0.1 }); tone(240, 0.4, { vol: 0.07, to: 90, at: 0.3 }); },
  kingHurt: () => { tone(110, 0.4, { type: 'sawtooth', vol: 0.1, to: 260 }); noise(0.3, { type: 'highpass', freq: 2500, vol: 0.08 }); },
  rest: () => { for (let i = 0; i < 6; i++) noise(0.05, { type: 'bandpass', freq: 1800 + i * 300, q: 3, vol: 0.05, at: i * 0.09 }); tone(130, 1.2, { vol: 0.06, to: 98, attack: 0.3 }); },
  kingDie: () => { tone(80, 1.6, { type: 'sawtooth', vol: 0.14, to: 30 }); noise(1.4, { freq: 800, to: 80, vol: 0.18 }); for (let i = 0; i < 8; i++) tone(2400 - i * 150, 0.06, { type: 'square', vol: 0.02, at: 0.2 + i * 0.09 }); },
};

/** Play this frame's sound events. */
export function playFx(events) { for (const ev of events) if (ev.k === 'sfx' && SFX[ev.n]) SFX[ev.n](); }
