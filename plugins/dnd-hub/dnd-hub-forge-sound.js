// dnd-hub-forge-sound.js — the Hero Forge's sounds, made in code (nothing to license): a soft whoosh when browsing,
// a two-tone bell on choosing, a low swell on the reveal. Quiet on purpose. Mute is remembered per viewer.
const KEY = 'lk-forge-muted';
const defaultContext = () => { const AC = window.AudioContext || window.webkitAudioContext; return AC ? new AC() : null; };
const defaultStore = () => { try { return window.localStorage; } catch { return null; } };

export function createForgeSound({ makeContext = defaultContext, store = defaultStore() } = {}) {
  let ctx = null;
  let muted = false;
  try { muted = store?.getItem(KEY) === '1'; } catch { /* private window */ }

  const audio = () => {
    if (muted) return null;
    if (!ctx) { try { ctx = makeContext(); } catch { ctx = null; } }
    if (ctx?.state === 'suspended') ctx.resume?.().catch?.(() => {});
    return ctx;
  };
  const env = (c, peak, attack, release) => {
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    g.connect(c.destination);
    return g;
  };
  const safe = fn => () => { try { const c = audio(); if (c) fn(c); } catch { /* audio is a nicety */ } };

  return {
    muted: () => muted,
    setMuted(v) { muted = !!v; try { store?.setItem(KEY, muted ? '1' : '0'); } catch { /* ignore */ } },
    // Filtered noise, the band sweeping up: a short "whff".
    whoosh: safe(c => {
      const n = Math.floor(c.sampleRate * 0.35);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
      f.frequency.setValueAtTime(300, c.currentTime);
      f.frequency.exponentialRampToValueAtTime(2400, c.currentTime + 0.3);
      src.connect(f); f.connect(env(c, 0.08, 0.04, 0.3));
      src.start(); src.stop(c.currentTime + 0.36);
    }),
    // Two bell partials, the second a fifth above, decaying slowly.
    chime: safe(c => {
      for (const [hz, peak] of [[523.25, 0.07], [783.99, 0.04], [1567.98, 0.015]]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(hz, c.currentTime);
        o.connect(env(c, peak, 0.01, 1.4)); o.start(); o.stop(c.currentTime + 1.5);
      }
    }),
    // A low pad rising over 1.5 s: the reveal.
    swell: safe(c => {
      for (const hz of [98, 146.83, 196]) {
        const o = c.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(hz, c.currentTime);
        o.frequency.linearRampToValueAtTime(hz * 1.5, c.currentTime + 1.5);
        o.connect(env(c, 0.05, 1.2, 1.2)); o.start(); o.stop(c.currentTime + 2.5);
      }
    }),
  };
}
