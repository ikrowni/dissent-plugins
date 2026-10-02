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
