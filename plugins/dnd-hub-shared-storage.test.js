// plugins/dnd-hub-shared-storage.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
const failReads = new Set();
const sk = (k, scope) => (scope === 'user' ? 'user:' + k : k);
vi.mock('./plugin-sdk.js', () => ({
  storageGetCompanion: vi.fn(async (_r, k, scope) => { k = sk(k, scope); return store.has(k) && !failReads.has(k) ? JSON.parse(store.get(k)) : null; }),
  storageSetCompanion: vi.fn(async (_r, k, scope, v) => { store.set(sk(k, scope), JSON.stringify(v)); }),
}));

let mod;
beforeEach(async () => { store.clear(); failReads.clear(); vi.resetModules(); mod = await import('./dnd-hub-shared-storage.js'); });

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

describe('DM secrets (lk-secrets.js)', () => {
  const seed = camp => {
    store.set('hub-index', JSON.stringify({ campaignIds: ['c'], rest: {} }));
    store.set('hub-camp-c', JSON.stringify(camp));
  };
  const pub = () => JSON.parse(store.get('hub-camp-c'));
  const sec = () => JSON.parse(store.get('user:dm-camp-c'));

  it('the DM sidebar joins the secret record and saves a new DM note to it only', async () => {
    seed({ id: 'c', dmUserId: 'dm', secretsKept: true, maps: {} });
    store.set('user:dm-camp-c', JSON.stringify({ encounters: { e: { name: 'Ghouls' } } }));
    mod.setSecretsUser('dm');
    const data = await mod.loadHubDmCompanion();
    expect(data.campaigns.c.encounters).toBeUndefined(); // not read until the sidebar opens it
    await mod.joinSecrets(data, 'c');
    expect(data.campaigns.c.encounters.e.name).toBe('Ghouls');
    data.campaigns.c.dmNotes = 'twist';
    await mod.saveHubDmCompanion(data);
    expect(pub().dmNotes).toBeUndefined();
    expect(pub().encounters).toBeUndefined();
    expect(sec()).toEqual({ encounters: { e: { name: 'Ghouls' } }, dmNotes: 'twist' });
  });

  it('a player sidebar sees no secret record and never strips the public one', async () => {
    seed({ id: 'c', dmUserId: 'dm', dmNotes: 'old', members: [] });
    mod.setSecretsUser('bob');
    const data = await mod.loadHubDmCompanion();
    data.campaigns.c.members = ['bob'];
    await mod.saveHubDmCompanion(data);
    expect(pub().dmNotes).toBe('old');
    expect(store.has('user:dm-camp-c')).toBe(false);
  });

  it('a failed read of the secret record never overwrites it', async () => {
    seed({ id: 'c', dmUserId: 'dm', secretsKept: true, maps: {} });
    store.set('user:dm-camp-c', JSON.stringify({ dmNotes: 'keep me' }));
    failReads.add('user:dm-camp-c');
    mod.setSecretsUser('dm');
    const data = await mod.loadHubDmCompanion();
    data.campaigns.c.name = 'Renamed';
    await mod.saveHubDmCompanion(data);
    expect(sec()).toEqual({ dmNotes: 'keep me' });
    expect(pub().name).toBe('Renamed');
  });
});
