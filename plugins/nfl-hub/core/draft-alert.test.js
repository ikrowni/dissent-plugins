// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { playTurnAlert, alertEnabled, setAlertEnabled, becameMyTurn } from './draft-alert.js';

const fakeCtx = () => {
  const started = [];
  class Ctx {
    constructor() { this.currentTime = 0; this.destination = {}; }
    createOscillator() {
      const o = { type: '', frequency: { value: 0 }, connect: (n) => n, start: (t) => started.push(t), stop: () => {} };
      return o;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n };
    }
  }
  return { Ctx, started };
};

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

describe('the turn alert', () => {
  it('plays two notes when enabled', () => {
    const { Ctx, started } = fakeCtx();
    expect(playTurnAlert({ AudioCtx: Ctx })).toBe(true);
    expect(started.length).toBe(2);
  });

  it('stays silent when muted', () => {
    setAlertEnabled(false);
    const { Ctx, started } = fakeCtx();
    expect(playTurnAlert({ AudioCtx: Ctx })).toBe(false);
    expect(started.length).toBe(0);
  });

  it('defaults to on, and the toggle round-trips', () => {
    expect(alertEnabled()).toBe(true);
    setAlertEnabled(false);
    expect(alertEnabled()).toBe(false);
    setAlertEnabled(true);
    expect(alertEnabled()).toBe(true);
  });

  // Autoplay policy, no device, a dead context — a chime must never break a draft.
  it('never throws when Web Audio is unavailable or fails', () => {
    expect(playTurnAlert({ AudioCtx: undefined, enabled: () => true })).toBe(false);
    const Boom = function () { throw new Error('autoplay blocked'); };
    expect(playTurnAlert({ AudioCtx: Boom, enabled: () => true })).toBe(false);
  });

  // 🔴 The board polls every 3 s. Keyed on state rather than the transition, this
  // would chime for the whole pick.
  it('fires only on the transition into my turn', () => {
    expect(becameMyTurn(false, true)).toBe(true);
    expect(becameMyTurn(true, true)).toBe(false);
    expect(becameMyTurn(true, false)).toBe(false);
    expect(becameMyTurn(false, false)).toBe(false);
  });
});
