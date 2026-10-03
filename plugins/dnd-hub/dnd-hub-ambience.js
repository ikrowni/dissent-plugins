// dnd-hub-ambience.js — plays the default session ambience (dnd-hub-ambience-sound.js) on a loop with WebAudio.
import { ambienceSamples } from './dnd-hub-ambience-sound.js';

let _ctx = null, _src = null;

/** Run `start` now; if the browser blocks audio until a gesture, run it again on the first click (D5). */
export function playWhenAllowed(start) {
  Promise.resolve().then(start).catch(() => {
    document.addEventListener('pointerdown', () => { Promise.resolve().then(start).catch(() => {}); }, { once: true });
  });
}

export function startAmbience(volume = 0.35) {
  stopAmbience();
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  _ctx = _ctx || new AC();
  const data = ambienceSamples(_ctx.sampleRate, 6, 7);
  const buf = _ctx.createBuffer(1, data.length, _ctx.sampleRate);
  buf.copyToChannel(data, 0);
  _src = _ctx.createBufferSource();
  _src.buffer = buf;
  _src.loop = true;
  const gain = _ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, volume));
  _src.connect(gain).connect(_ctx.destination);
  _src.start();
  if (_ctx.state === 'suspended') playWhenAllowed(() => _ctx.resume());
  return true;
}

export function stopAmbience() {
  try { _src?.stop(); } catch { /* already stopped */ }
  _src = null;
}

/** For the playtest: is the ambience loop running? */
export const ambiencePlaying = () => !!_src;
