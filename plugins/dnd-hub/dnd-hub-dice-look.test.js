import { describe, it, expect, vi } from 'vitest';

const store = {};
vi.mock('../plugin-sdk.js', () => ({
  storageGetUser: async k => store[k] ?? null,
  storageSetUser: async (k, v) => { store[k] = v; },
}));
const { cleanLook, presetOf, lookKey, PRESETS, DEFAULT_LOOK, setMyLook, myLook, loadMyLook } = await import('./dnd-hub-dice-look.js');

describe('cleanLook', () => {
  it('keeps a good look, lower-cased', () => {
    expect(cleanLook({ body: '#AA0011', ink: '#ffffff', edge: '#000000', finish: 'glass' }))
      .toEqual({ body: '#aa0011', ink: '#ffffff', edge: '#000000', finish: 'glass' });
  });
  it('anything a roll could smuggle in falls back to the default, part by part', () => {
    expect(cleanLook({ body: 'red;background:url(x)', ink: '#fff', edge: 7, finish: 'lava', extra: '<script>' }))
      .toEqual({ ...DEFAULT_LOOK });
    expect(cleanLook({ body: '#123456', finish: 'neon' })).toEqual({ ...DEFAULT_LOOK, body: '#123456' });
    expect(cleanLook(null)).toEqual({ ...DEFAULT_LOOK });
    expect(cleanLook('#ffffff')).toEqual({ ...DEFAULT_LOOK });
  });
  it('a cleaned look carries nothing but its four fields', () => {
    expect(Object.keys(cleanLook({ body: '#123456', evil: 1 })).sort()).toEqual(['body', 'edge', 'finish', 'ink']);
  });
});

describe('presets', () => {
  it('every preset is a clean look, and is recognised', () => {
    for (const p of PRESETS) {
      const { id, name, ...look } = p;
      expect(cleanLook(look)).toEqual(look);
      expect(presetOf(look)).toBe(id);
    }
  });
  it('the default is the Lantern gold preset; a mix is no preset', () => {
    expect(presetOf(DEFAULT_LOOK)).toBe('lantern');
    expect(presetOf({ ...DEFAULT_LOOK, ink: '#ffffff' })).toBe(null);
  });
  it('two looks share a texture key only when they look the same', () => {
    expect(lookKey(DEFAULT_LOOK)).toBe(lookKey({ ...DEFAULT_LOOK }));
    expect(lookKey(DEFAULT_LOOK)).not.toBe(lookKey({ ...DEFAULT_LOOK, finish: 'matte' }));
  });
});

describe('my look', () => {
  it('a change is kept, cleaned, and saved for next time', async () => {
    vi.useFakeTimers();
    setMyLook({ body: '#336699', finish: 'metal' });
    setMyLook({ ink: 'not a colour' });
    expect(myLook()).toMatchObject({ body: '#336699', finish: 'metal', ink: DEFAULT_LOOK.ink });
    await vi.runAllTimersAsync();
    expect(store['dice-look']).toMatchObject({ body: '#336699', finish: 'metal' });
    vi.useRealTimers();
  });
  it('loads what was saved, cleaned', async () => {
    store['dice-look'] = { body: '#010203', ink: 'javascript:', edge: '#0a0b0c', finish: 'glass' };
    expect(await loadMyLook()).toEqual({ body: '#010203', ink: DEFAULT_LOOK.ink, edge: '#0a0b0c', finish: 'glass' });
  });
});
