// core/sfx.js — the click tick: a short, quiet confirmation that a control was hit.
//
// ⚠️ ONE VOICE FOR THE WHOLE HUB, DIFFERENTIATED BY PITCH — never by adding a
// second oscillator type or envelope. That is the same rule the desktop client
// holds its own UI instrument to, and for the same reason: two voices drift, and
// a product whose clicks do not sound related reads as two products.
//
// Synthesised rather than sampled, like core/draft-alert.js: no bytes to ship, no
// CSP allowance to request, and it cannot 404 the way an asset can.
//
// ⚠️ DELIBERATELY QUIETER AND SHORTER THAN THE TURN CHIME. The chime is an ALERT
// — it must reach someone looking at another window. This fires on every click,
// so anything with presence becomes intolerable inside a minute. 22 ms at 0.045
// gain is felt more than heard, which is the entire brief.

const KEY = 'nfl:ui:sfx';

/**
 * The palette. ⚠️ PITCHES LIVE HERE, NEVER AS RAW HERTZ AT A CALL SITE — a number
 * typed inline is how an interface ends up with fourteen slightly different clicks
 * that nobody can bring back into tune.
 *
 * Kept clear of the turn chime's A5/D6 so the two are never confused.
 */
export const PITCH = Object.freeze({
  tap: 587.33,     // D5  — the default: something happened
  nav: 739.99,     // F#5 — you moved somewhere
  toggle: 493.88,  // B4  — a state flipped
});

const THROTTLE_MS = 40;
const DURATION_S = 0.022;
const PEAK_GAIN = 0.045;

let ctx = null;
// ⚠️ -Infinity, NOT 0. At 0 the very first click is swallowed by the throttle
// whenever the clock reads near zero — invisible with a real Date.now() in the
// 1.7e12 range, and immediate under any injected or fake clock. "The first click
// of the session is silent" is exactly the kind of bug that gets called flaky.
let lastAt = -Infinity;

/** On unless the user turned it off. Per browser, like the turn alert. */
export function sfxEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSfxEnabled(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

/**
 * Which note an action gets.
 *
 * Split out from the player so the mapping is testable without a Web Audio stack,
 * and so app.js stays a dispatcher rather than growing sound design.
 */
export function pitchForAction(act) {
  const a = String(act ?? '');
  if (a === 'nav') return PITCH.nav;
  if (a.includes('toggle')) return PITCH.toggle;
  return PITCH.tap;
}

/**
 * ⚠️ ONE SHARED AudioContext, created lazily on the first click.
 *
 * Not one per sound: browsers cap concurrent contexts (~6 in Chrome) and never
 * collect them on their own, so a context per click silently stops producing
 * audio after a handful of clicks — the failure looks like "the sound randomly
 * stopped working", which is exactly the kind of bug nobody can reproduce.
 *
 * Lazy because constructing one before a user gesture starts it `suspended` under
 * every autoplay policy; the first click is a gesture, so this is the moment it
 * is allowed to exist.
 */
function context(AudioCtx) {
  const Ctx = AudioCtx ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) ctx = new Ctx();
  // A context can be suspended out from under us (tab backgrounded, policy).
  if (ctx.state === 'suspended') ctx.resume?.();
  return ctx;
}

/**
 * Play one tick. Returns whether it actually sounded, so callers and tests can
 * tell "played" from "declined" without listening.
 *
 * Never throws: a broken audio stack must not take a click handler down with it.
 */
export function playClick(act = 'tap', { AudioCtx, enabled = sfxEnabled, now = () => Date.now() } = {}) {
  if (!enabled()) return false;

  // ⚠️ THROTTLED. Double-clicks, a held key repeating and delegated handlers that
  // see one gesture twice all stack otherwise, and simultaneous copies of one
  // short tone sum into a click loud enough to be startling.
  const t = now();
  if (t - lastAt < THROTTLE_MS) return false;
  lastAt = t;

  try {
    const audio = context(AudioCtx);
    if (!audio) return false;
    const at = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = pitchForAction(act);
    // Ramped rather than gated: an abrupt start or stop on a sine is an audible
    // click of its own, which would defeat the point of a deliberately soft one.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + DURATION_S);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + DURATION_S + 0.01);
    return true;
  } catch {
    // Autoplay policy, no output device, a closed context — never break the UI.
    return false;
  }
}

/** Test seam: forget the shared context and the throttle. */
export function _reset() { ctx = null; lastAt = -Infinity; }
