import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, bindingsFor, keysOf, rebind, readSettings, withVolume, keyLabel } from './ul-settings.js';
import { Input } from './ul-input.js';

describe('rebinding', () => {
  it('replaces an action\'s keys with yours, and keeps its mouse and controller buttons', () => {
    const { settings } = rebind(DEFAULT_SETTINGS, 'attack', 'u');
    expect(bindingsFor(settings).attack).toEqual(['u', 'mouse0', 'pad:attack']);
    expect(keysOf(settings, 'attack')).toEqual(['u']);
  });
  it('swaps when the key is taken: the other action gets this one\'s key', () => {
    const { settings } = rebind(DEFAULT_SETTINGS, 'attack', 'k'); // k was block
    expect(keysOf(settings, 'attack')).toEqual(['k']);
    expect(keysOf(settings, 'block')).toEqual(['j']);
    const all = Object.values(bindingsFor(settings)).flat().filter((k) => !k.includes(':') && !k.startsWith('mouse'));
    expect(new Set(all).size).toBe(all.length); // no key does two things
  });
  it('keeps the menu keys for the menus', () => {
    for (const k of ['escape', 'enter', 'p', 'm', 'tab']) expect(rebind(DEFAULT_SETTINGS, 'jump', k).error).toMatch(/kept for the menus/);
  });
  it('drives the input', () => {
    const inp = new Input(bindingsFor(rebind(DEFAULT_SETTINGS, 'jump', 'x').settings));
    inp.down('x'); expect(inp.read().jump).toBe(true);
    inp.consume(); inp.up('x'); inp.down('w'); expect(inp.read().jump).toBe(false); // w no longer jumps
  });
});

describe('stored settings', () => {
  it('read back, and junk falls back to the defaults', () => {
    const s = withVolume(rebind(DEFAULT_SETTINGS, 'roll', 'c').settings, 0.4);
    expect(readSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(readSettings(null)).toBe(DEFAULT_SETTINGS);
    expect(readSettings({ v: 1, volume: 7, keys: { roll: 'escape', fly: 'q', jump: 'pad:jump', attack: 'u' } })).toEqual({ v: 1, volume: 1, keys: { attack: 'u' } });
  });
  it('names keys for people', () => { expect([keyLabel(' '), keyLabel('arrowleft'), keyLabel('j'), keyLabel('shift')]).toEqual(['Space', '←', 'J', 'Shift']); });
});
