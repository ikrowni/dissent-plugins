// plugins/dnd-hub/dnd-hub-forge-sound.test.js
import { describe, it, expect, vi } from 'vitest';
import { createForgeSound } from './dnd-hub-forge-sound.js';

const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
const node = () => ({ connect: vi.fn(t => t), start: vi.fn(), stop: vi.fn(), gain: param(), frequency: param(), Q: param(), type: '' });
function fakeCtx() {
  return { currentTime: 0, sampleRate: 8000, destination: {}, state: 'running', resume: vi.fn(async () => {}),
    createGain: vi.fn(node), createOscillator: vi.fn(node), createBiquadFilter: vi.fn(node), createBufferSource: vi.fn(node),
    createBuffer: vi.fn((ch, n) => ({ getChannelData: () => new Float32Array(n) })) };
}
const memStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

describe('forge sound', () => {
  it('plays all three sounds on one context, made only when first needed', () => {
    const make = vi.fn(fakeCtx);
    const s = createForgeSound({ makeContext: make, store: memStore() });
    expect(make).not.toHaveBeenCalled();
    s.whoosh(); s.chime(); s.swell();
    expect(make).toHaveBeenCalledTimes(1);
  });
  it('is silent while muted, and the mute is remembered', () => {
    const store = memStore();
    const make = vi.fn(fakeCtx);
    createForgeSound({ makeContext: make, store }).setMuted(true);
    const again = createForgeSound({ makeContext: make, store });
    expect(again.muted()).toBe(true);
    again.whoosh(); again.chime(); again.swell();
    expect(make).not.toHaveBeenCalled();
  });
  it('never throws when audio is unavailable', () => {
    const s = createForgeSound({ makeContext: () => null, store: memStore() });
    expect(() => { s.whoosh(); s.chime(); s.swell(); }).not.toThrow();
  });
});
