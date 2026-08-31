// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { playClick, pitchForAction, sfxEnabled, setSfxEnabled, PITCH, _reset } from './sfx.js';

// A fake Web Audio stack that records what was scheduled, so the sound design is
// assertable without listening — gain, duration and pitch are the whole product
// here, and "it did not throw" would prove none of them.
function fakeAudio() {
  const built = [];
  let created = 0;
  class Ctx {
    constructor() { created += 1; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { this.state = 'running'; }
    createOscillator() {
      const o = { type: null, frequency: { value: null }, started: null, stopped: null,
        connect: (n) => n, start(t) { this.started = t; }, stop(t) { this.stopped = t; } };
      built.push(o); return o;
    }
    createGain() {
      const ramps = [];
      return { gain: {
        setValueAtTime: (v, t) => ramps.push(['set', v, t]),
        exponentialRampToValueAtTime: (v, t) => ramps.push(['ramp', v, t]),
      }, ramps, connect: (n) => n };
    }
  }
  return { Ctx, built, contexts: () => created };
}

beforeEach(() => { _reset(); localStorage.clear(); });

describe('the preference', () => {
  it('is on by default — the feature is the point', () => {
    expect(sfxEnabled()).toBe(true);
  });

  it('round-trips off and back on', () => {
    setSfxEnabled(false);
    expect(sfxEnabled()).toBe(false);
    setSfxEnabled(true);
    expect(sfxEnabled()).toBe(true);
  });

  it('stays on when storage is unavailable rather than falling silent', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(sfxEnabled()).toBe(true);
    spy.mockRestore();
  });
});

describe('which note an action gets', () => {
  it('gives navigation its own pitch', () => {
    expect(pitchForAction('nav')).toBe(PITCH.nav);
  });

  it('gives anything toggle-ish the toggle pitch', () => {
    expect(pitchForAction('draft-auto-toggle')).toBe(PITCH.toggle);
    expect(pitchForAction('sfx-toggle')).toBe(PITCH.toggle);
  });

  it('falls back to the default tap for everything else', () => {
    expect(pitchForAction('draft-pick-for')).toBe(PITCH.tap);
    expect(pitchForAction(undefined)).toBe(PITCH.tap);
  });

  // 🔴 One voice, differentiated by pitch. Three notes that are actually the same
  // number is the failure this catches.
  it('uses three distinct pitches', () => {
    expect(new Set(Object.values(PITCH)).size).toBe(3);
  });
});

describe('playing', () => {
  it('schedules a sine at the pitch the action maps to', () => {
    const { Ctx, built } = fakeAudio();
    expect(playClick('nav', { AudioCtx: Ctx })).toBe(true);
    expect(built).toHaveLength(1);
    expect(built[0].type).toBe('sine');
    expect(built[0].frequency.value).toBe(PITCH.nav);
  });

  // ⚠️ SUBTLE IS THE REQUIREMENT, not a nicety. A click on every control at alert
  // volume is intolerable within a minute, so the ceiling is asserted.
  it('stays quiet and short', () => {
    const { Ctx, built } = fakeAudio();
    let captured = null;
    class Spy extends Ctx {
      createGain() { const g = super.createGain(); captured = g; return g; }
    }
    playClick('tap', { AudioCtx: Spy });
    const peak = Math.max(...captured.ramps.map(([, v]) => v));
    expect(peak).toBeLessThanOrEqual(0.05);
    const duration = built[0].stopped - built[0].started;
    expect(duration).toBeLessThan(0.05);
  });

  it('says no, and makes no sound, when the preference is off', () => {
    const { Ctx, built } = fakeAudio();
    setSfxEnabled(false);
    expect(playClick('tap', { AudioCtx: Ctx })).toBe(false);
    expect(built).toHaveLength(0);
  });

  // 🔴 One context for the whole session. One per click silently stops producing
  // audio after a handful — browsers cap them and never collect them.
  it('reuses a single AudioContext across many clicks', () => {
    const { Ctx, contexts } = fakeAudio();
    let t = 0;
    const now = () => (t += 1000);
    for (let i = 0; i < 10; i += 1) playClick('tap', { AudioCtx: Ctx, now });
    expect(contexts()).toBe(1);
  });

  // Simultaneous copies of one short tone sum into something startling.
  it('throttles a burst of clicks', () => {
    const { Ctx, built } = fakeAudio();
    const now = () => 1000;   // same instant every time
    expect(playClick('tap', { AudioCtx: Ctx, now })).toBe(true);
    expect(playClick('tap', { AudioCtx: Ctx, now })).toBe(false);
    expect(playClick('tap', { AudioCtx: Ctx, now })).toBe(false);
    expect(built).toHaveLength(1);
  });

  it('plays again once the throttle window has passed', () => {
    const { Ctx, built } = fakeAudio();
    let t = 0;
    const now = () => t;
    playClick('tap', { AudioCtx: Ctx, now });
    t = 500;
    playClick('tap', { AudioCtx: Ctx, now });
    expect(built).toHaveLength(2);
  });

  // A click handler must never die because audio is unavailable.
  it('survives a browser with no Web Audio at all', () => {
    expect(playClick('tap', { AudioCtx: null, enabled: () => true })).toBe(false);
  });

  it('survives a context that throws on construction', () => {
    class Broken { constructor() { throw new Error('no device'); } }
    expect(playClick('tap', { AudioCtx: Broken })).toBe(false);
  });

  it('resumes a context the browser suspended', () => {
    const { Ctx } = fakeAudio();
    let resumed = false;
    class Suspended extends Ctx {
      constructor() { super(); this.state = 'suspended'; }
      resume() { resumed = true; this.state = 'running'; }
    }
    playClick('tap', { AudioCtx: Suspended });
    expect(resumed).toBe(true);
  });
});
