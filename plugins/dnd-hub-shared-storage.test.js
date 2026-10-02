// plugins/dnd-hub-shared-storage.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
vi.mock('./plugin-sdk.js', () => ({
  storageGetCompanion: vi.fn(async (_r, k) => (store.has(k) ? JSON.parse(store.get(k)) : null)),
  storageSetCompanion: vi.fn(async (_r, k, _s, v) => { store.set(k, JSON.stringify(v)); }),
}));

let mod;
beforeEach(async () => { store.clear(); vi.resetModules(); mod = await import('./dnd-hub-shared-storage.js'); });

it('a sidebar save keeps an edit the hub made meanwhile', async () => {
  store.set('hub-index', JSON.stringify({ campaignIds: ['c'], rest: {} }));
  store.set('hub-camp-c', JSON.stringify({ id: 'c', a: 1, b: 1 }));
  const data = await mod.loadHubDmCompanion();
  store.set('hub-camp-c', JSON.stringify({ id: 'c', a: 1, b: 2 }));
  data.campaigns.c.a = 5;
  await mod.saveHubDmCompanion(data);
  expect(JSON.parse(store.get('hub-camp-c'))).toEqual({ id: 'c', a: 5, b: 2 });
  expect(data.campaigns.c.b).toBe(2);
});
