// plugins/dnd-hub/dnd-hub-storage.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
const failReads = new Set(); // keys whose reads fail (the SDK returns null on any error)
vi.mock('../plugin-sdk.js', () => ({
  storageGet: vi.fn(async (k, scope) => { k = scope === 'user' ? 'user:' + k : k; return store.has(k) && !failReads.has(k) ? JSON.parse(store.get(k)) : null; }),
  storageSet: vi.fn(async (k, v, scope) => { store.set(scope === 'user' ? 'user:' + k : k, JSON.stringify(v)); }),
}));

let mod;
beforeEach(async () => {
  store.clear();
  failReads.clear();
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

describe('DM secrets stay with the DM (lk-secrets.js)', () => {
  const secretCamp = () => ({
    id: 'c', dmUserId: 'dm', dmNotes: 'twist',
    maps: { m: { tokens: { g: { id: 'g', visible: false }, b: { id: 'b', visible: true } }, triggers: [{ id: 't' }], pins: [] } },
  });
  const seed = camp => {
    store.set('hub-index', JSON.stringify({ campaignIds: ['c'], rest: {} }));
    store.set('hub-camp-c', JSON.stringify(camp));
  };
  const flush = () => new Promise(r => setTimeout(r, 0));
  const pub = () => JSON.parse(store.get('hub-camp-c'));
  const sec = () => JSON.parse(store.get('user:dm-camp-c'));

  it('the DM\'s first load moves secrets out of the public record, and the DM still sees them', async () => {
    seed(secretCamp());
    mod.setSecretsUser('dm');
    const data = await mod.loadHubDm();
    await flush(); await flush();
    expect(pub().dmNotes).toBeUndefined();
    expect(pub().maps.m.tokens.g).toBeUndefined();
    expect(pub().maps.m.triggers).toEqual([]);
    expect(pub().secretsKept).toBe(true);
    expect(sec().dmNotes).toBe('twist');
    expect(sec().maps.m.tokens.g).toBeTruthy();
    expect(data.campaigns.c.dmNotes).toBe('twist');
    // a fresh DM screen joins both
    vi.resetModules(); mod = await import('./dnd-hub-storage.js'); mod.setSecretsUser('dm');
    const again = await mod.loadHubDm();
    expect(again.campaigns.c.maps.m.triggers).toEqual([{ id: 't' }]);
    expect(again.campaigns.c.maps.m.tokens.g).toBeTruthy();
  });

  it('a player\'s screen never strips (that would delete the DM\'s traps before the DM moved them)', async () => {
    seed(secretCamp());
    mod.setSecretsUser('bob');
    const data = await mod.loadHubDm();
    data.campaigns.c.maps.m.tokens.b.x = 4;
    await mod.saveHubDm(data);
    expect(pub().dmNotes).toBe('twist');
    expect(pub().maps.m.triggers).toEqual([{ id: 't' }]);
    expect(store.has('user:dm-camp-c')).toBe(false);
  });

  it('a new trap is saved to the secret record only', async () => {
    seed({ id: 'c', dmUserId: 'dm', maps: { m: { tokens: {}, triggers: [], pins: [] } } });
    mod.setSecretsUser('dm');
    const data = await mod.loadHubDm();
    await flush(); await flush();
    data.campaigns.c.maps.m.triggers.push({ id: 'pit' });
    await mod.saveHubDm(data);
    expect(pub().maps.m.triggers).toEqual([]);
    expect(sec().maps.m.triggers).toEqual([{ id: 'pit' }]);
    expect(data.campaigns.c.maps.m.triggers).toEqual([{ id: 'pit' }]);
  });

  it('a secret that reached the public record (a player\'s old copy) is moved out by the DM\'s next save', async () => {
    seed(secretCamp());
    mod.setSecretsUser('dm');
    const data = await mod.loadHubDm();
    await flush(); await flush();
    const leaked = pub(); leaked.maps.m.pins = [{ id: 'p', visible: 'dm' }];
    store.set('hub-camp-c', JSON.stringify(leaked));
    data.campaigns.c.maps.m.tokens.b.x = 2;
    await mod.saveHubDm(data);
    expect(pub().maps.m.pins).toEqual([]);
    expect(sec().maps.m.pins).toEqual([{ id: 'p', visible: 'dm' }]);
  });

  it('a failed read of the secret record never overwrites it', async () => {
    seed(secretCamp());
    mod.setSecretsUser('dm');
    await mod.loadHubDm();
    await flush(); await flush();
    const kept = store.get('user:dm-camp-c');
    // a new screen whose secret read fails
    vi.resetModules(); mod = await import('./dnd-hub-storage.js'); mod.setSecretsUser('dm');
    failReads.add('user:dm-camp-c');
    const data = await mod.loadHubDm();
    data.campaigns.c.maps.m.tokens.b.x = 3;
    await mod.saveHubDm(data);
    expect(store.get('user:dm-camp-c')).toBe(kept);
    expect(pub().maps.m.tokens.b.x).toBe(3);
  });
});
