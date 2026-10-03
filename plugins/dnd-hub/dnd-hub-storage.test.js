// plugins/dnd-hub/dnd-hub-storage.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
vi.mock('../plugin-sdk.js', () => ({
  storageGet: vi.fn(async k => (store.has(k) ? JSON.parse(store.get(k)) : null)),
  storageSet: vi.fn(async (k, v) => { store.set(k, JSON.stringify(v)); }),
}));

let mod;
beforeEach(async () => {
  store.clear();
  vi.resetModules();
  mod = await import('./dnd-hub-storage.js');
});

describe('saveHubDm merges with what is stored', () => {
  it('keeps a concurrent edit to another token', async () => {
    store.set('hub-index', JSON.stringify({ campaignIds: ['c'], rest: {} }));
    store.set('hub-camp-c', JSON.stringify({ id: 'c', tokens: { a: { x: 1 }, b: { x: 1 } } }));
    const data = await mod.loadHubDm();
    // someone else moves b after we loaded
    store.set('hub-camp-c', JSON.stringify({ id: 'c', tokens: { a: { x: 1 }, b: { x: 9 } } }));
    data.campaigns.c.tokens.a.x = 5;
    await mod.saveHubDm(data);
    expect(JSON.parse(store.get('hub-camp-c')).tokens).toEqual({ a: { x: 5 }, b: { x: 9 } });
    // and our in-memory copy adopted their change
    expect(data.campaigns.c.tokens.b.x).toBe(9);
  });

  it('calls the merged hook only when remote contributed something', async () => {
    store.set('hub-index', JSON.stringify({ campaignIds: ['c'], rest: {} }));
    store.set('hub-camp-c', JSON.stringify({ id: 'c', v: 1, w: 1 }));
    const data = await mod.loadHubDm();
    const hook = vi.fn();
    mod.setOnRemoteMerged(hook);
    data.campaigns.c.v = 2;
    await mod.saveHubDm(data);
    expect(hook).not.toHaveBeenCalled();
    store.set('hub-camp-c', JSON.stringify({ id: 'c', v: 2, w: 7 }));
    data.campaigns.c.v = 3;
    await mod.saveHubDm(data);
    expect(hook).toHaveBeenCalledWith('c');
  });
});

describe('saveHubDm under a burst of moves (owner report 2026-10-03: the token jumped back)', () => {
  const setup = async () => {
    store.set('hub-index', JSON.stringify({ campaignIds: ['c'], rest: {} }));
    store.set('hub-camp-c', JSON.stringify({ id: 'c', tokens: { bob: { x: 125 }, dm: { x: 0 } } }));
    return mod.loadHubDm();
  };
  it('keeps a move made while the write was in flight, and still adopts the other side', async () => {
    const data = await setup();
    const sdk = await import('../plugin-sdk.js');
    store.set('hub-camp-c', JSON.stringify({ id: 'c', tokens: { bob: { x: 125 }, dm: { x: 7 } } })); // someone else
    sdk.storageSet.mockImplementationOnce(async (k, v) => {
      data.campaigns.c.tokens.bob.x = 475;          // the token keeps moving during the write
      store.set(k, JSON.stringify(v));
    });
    data.campaigns.c.tokens.bob.x = 175;
    await mod.saveHubDm(data);
    expect(data.campaigns.c.tokens.bob.x).toBe(475);
    expect(data.campaigns.c.tokens.dm.x).toBe(7);
  });
  it('runs overlapping saves one at a time and ends with the newest position stored', async () => {
    const data = await setup();
    (await import('../plugin-sdk.js')).storageSet.mockClear();
    const saves = [];
    for (let x = 175; x <= 475; x += 50) { data.campaigns.c.tokens.bob.x = x; saves.push(mod.saveHubDm(data)); }
    await Promise.all(saves);
    expect(JSON.parse(store.get('hub-camp-c')).tokens.bob.x).toBe(475);
    expect(data.campaigns.c.tokens.bob.x).toBe(475);
    const sdk = await import('../plugin-sdk.js');
    // 7 asks, collapsed: the first save and one more (each writes the shard and the index).
    expect(sdk.storageSet.mock.calls.filter(c => c[0] === 'hub-camp-c').length).toBeLessThanOrEqual(2);
  });
});
