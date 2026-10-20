import { describe, it, expect } from 'vitest';
import { Input, padKeys, applyPad } from './ul-input.js';

describe('Input', () => {
  it('keeps a tap that was released before any step ran', () => {
    const inp = new Input();
    inp.down(' '); inp.up(' ');
    expect(inp.read().jump).toBe(true);
    expect(inp.read().jumpHeld).toBe(false);
    inp.consume();
    expect(inp.read().jump).toBe(false);
  });
  it('a held key is one press, however long it repeats', () => {
    const inp = new Input();
    inp.down('j'); inp.consume(); inp.down('j');
    expect(inp.read().attack).toBe(false);
  });
  it('gives a direction from left and right together', () => {
    const inp = new Input();
    inp.down('a'); expect(inp.read().dir).toBe(-1);
    inp.down('d'); expect(inp.read().dir).toBe(0);
    inp.up('a'); expect(inp.read().dir).toBe(1);
  });
  it('clear forgets everything (the window lost focus)', () => {
    const inp = new Input();
    inp.down('d'); inp.clear();
    expect(inp.read()).toMatchObject({ dir: 0, jump: false });
  });
});

describe('controller', () => {
  const pad = (axes, pressed) => ({ axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) });
  it('maps the stick and buttons to virtual keys', () => {
    expect([...padKeys(pad([-0.9, 0], [0, 5]))].sort()).toEqual(['pad:block', 'pad:jump', 'pad:left']);
    expect(padKeys(null).size).toBe(0);
  });
  it('turns new buttons into presses and released ones into let-go', () => {
    const inp = new Input();
    let prev = applyPad(inp, new Set(), new Set(['pad:jump']));
    expect(inp.read().jump).toBe(true);
    inp.consume();
    prev = applyPad(inp, prev, new Set(['pad:jump']));
    expect(inp.read().jump).toBe(false);
    applyPad(inp, prev, new Set());
    expect(inp.read().jumpHeld).toBe(false);
  });
});
