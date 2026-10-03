// dnd-hub-ambience.js — plays the default session ambience (dnd-hub-ambience-sound.js) with WebAudio: the wind on a
// loop, and drips one at a time at random gaps, each a little different (a looped drip sounded like one drip over
// and over).
import { windSamples, dripSamples, nextDripDelay } from './dnd-hub-ambience-sound.js';

let _ctx = null, _src = null, _gain = null, _dripTimer = null;

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
  const data = windSamples(_ctx.sampleRate, 6, 7);
  const buf = _ctx.createBuffer(1, data.length, _ctx.sampleRate);
  buf.copyToChannel(data, 0);
  _src = _ctx.createBufferSource();
  _src.buffer = buf;
  _src.loop = true;
  _gain = _ctx.createGain();
  _gain.gain.value = Math.max(0, Math.min(1, volume));
  _src.connect(_gain).connect(_ctx.destination);
  _src.start();
  _scheduleDrip();
  if (_ctx.state === 'suspended') playWhenAllowed(() => _ctx.resume());
  return true;
}

function _scheduleDrip() {
  _dripTimer = setTimeout(() => {
    if (!_src || !_ctx || !_gain) return;
    const d = dripSamples(_ctx.sampleRate, Math.random());
    const buf = _ctx.createBuffer(1, d.length, _ctx.sampleRate);
    buf.copyToChannel(d, 0);
    const one = _ctx.createBufferSource();
    one.buffer = buf;
    one.connect(_gain);
    one.start();
    _scheduleDrip();
  }, nextDripDelay(Math.random()) * 1000);
}

export function stopAmbience() {
  clearTimeout(_dripTimer);
  _dripTimer = null;
  try { _src?.stop(); } catch { /* already stopped */ }
  _src = null;
}

/** For the playtest: is the ambience loop running? */
export const ambiencePlaying = () => !!_src;
