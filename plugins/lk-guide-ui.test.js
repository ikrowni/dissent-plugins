// @vitest-environment jsdom
// plugins/lk-guide-ui.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

let store, mod;
beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '';
  store = { on: false, seen: [] };
  mod = await import('./lk-guide-ui.js');
  mod.initGuides({ get: async () => JSON.parse(JSON.stringify(store)), set: async v => { store = JSON.parse(JSON.stringify(v)); } });
});
const tick = () => new Promise(r => setTimeout(r, 0));

describe('guide cards', () => {
  it('off: nothing shows', async () => {
    await mod.guide('player:table'); await tick();
    expect(document.getElementById('lk-tip')).toBeNull();
  });
  it('turned on, the tip shows; Got it closes it for good', async () => {
    expect(await mod.guidesOn()).toBe(false);
    await mod.setGuidesOn(true);
    expect(await mod.guidesOn()).toBe(true);
    await mod.guide('player:table'); await tick();
    expect(document.querySelector('#lk-tip b')?.textContent).toBe('Welcome to the table');
    document.querySelector('#lk-tip .lk-tip-ok').click(); await tick(); await tick();
    expect(document.getElementById('lk-tip')).toBeNull();
    expect(store.seen).toContain('player:table');
    await mod.guide('player:table'); await tick();
    expect(document.getElementById('lk-tip')).toBeNull();
  });
  it('Turn guides off closes the card and stores off', async () => {
    await mod.setGuidesOn(true);
    await mod.guide('player:table'); await tick();
    document.querySelector('#lk-tip .lk-tip-off').click(); await tick(); await tick();
    expect(document.getElementById('lk-tip')).toBeNull();
    expect(store.on).toBe(false);
  });
});

describe('before storage is connected', () => {
  it('a choice made early is saved once initGuides runs', async () => {
    vi.resetModules();
    const m = await import('./lk-guide-ui.js');
    let saved = { on: true, seen: [] };
    await m.setGuidesOn(false);            // no storage yet
    m.initGuides({ get: async () => saved, set: async v => { saved = v; } });
    await new Promise(r => setTimeout(r, 0));
    expect(saved.on).toBe(false);
    expect(await m.guidesOn()).toBe(false);
  });
});
