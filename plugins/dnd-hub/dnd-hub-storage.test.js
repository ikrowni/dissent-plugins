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
    // a fresh DM screen joins both when the DM opens the campaign
    vi.resetModules(); mod = await import('./dnd-hub-storage.js'); mod.setSecretsUser('dm');
    const again = await mod.loadHubDm();
    expect(again.campaigns.c.maps.m.triggers).toEqual([]);
    await mod.joinSecrets(again, 'c');
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
    await mod.joinSecrets(data, 'c');
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

  it('one failed read does not stop the session saving secrets: the next good read lets a trap change through', async () => {
    seed(secretCamp());
    mod.setSecretsUser('dm');
    await mod.loadHubDm();
    await flush(); await flush();
    vi.resetModules(); mod = await import('./dnd-hub-storage.js'); mod.setSecretsUser('dm');
    failReads.add('user:dm-camp-c');
    const data = await mod.loadHubDm();
    data.campaigns.c.maps.m.tokens.b.x = 3;
    await mod.saveHubDm(data);            // blind: secrets left alone
    failReads.clear();                    // the next read works
    data.campaigns.c.maps.m.triggers.push({ id: 'pit', disabled: true });
    await mod.saveHubDm(data);
    expect(sec().maps.m.triggers).toEqual([{ id: 't' }, { id: 'pit', disabled: true }]);
    expect(sec().dmNotes).toBe('twist'); // nothing it did not know about is lost
  });
});

describe('secret records are read only for the open campaign', () => {
  const seedMany = () => {
    store.set('hub-index', JSON.stringify({ campaignIds: ['a', 'b'], rest: {} }));
    for (const id of ['a', 'b']) {
      store.set('hub-camp-' + id, JSON.stringify({ id, dmUserId: 'dm', secretsKept: true, maps: { m: { tokens: {}, triggers: [], pins: [] } } }));
      store.set('user:dm-camp-' + id, JSON.stringify({ dmNotes: 'secret ' + id }));
    }
  };
  it('a DM\'s load reads no secret record until a campaign is opened, then that one only', async () => {
    seedMany();
    mod.setSecretsUser('dm');
    const sdk = await import('../plugin-sdk.js');
    sdk.storageGet.mockClear();
    const data = await mod.loadHubDm();
    expect(sdk.storageGet.mock.calls.filter(c => c[1] === 'user')).toEqual([]);
    await mod.joinSecrets(data, 'b');
    expect(sdk.storageGet.mock.calls.filter(c => c[1] === 'user').map(c => c[0])).toEqual(['dm-camp-b']);
    expect(data.campaigns.b.dmNotes).toBe('secret b');
    // and a reload of the list keeps the open one joined
    const again = await mod.loadHubDm();
    expect(again.campaigns.b.dmNotes).toBe('secret b');
    expect(again.campaigns.a.dmNotes).toBeUndefined();
  });
  it('saving a campaign whose secrets were never joined keeps the stored secrets', async () => {
    seedMany();
    mod.setSecretsUser('dm');
    const data = await mod.loadHubDm();
    data.campaigns.a.name = 'Renamed';
    await mod.saveHubDm(data);
    expect(JSON.parse(store.get('hub-camp-a')).name).toBe('Renamed');
    expect(JSON.parse(store.get('user:dm-camp-a'))).toEqual({ dmNotes: 'secret a' });
  });
});

describe('a load reads only the campaigns this user is in (lk-campaign-index.js)', () => {
  const sum = (id, dm, members = [], extra = {}) => ({ id, name: id, dmUserId: dm, members, visibility: 'open', ...extra });
  const seed = () => {
    store.set('hub-index', JSON.stringify({ campaignIds: ['mine', 'theirs', 'old'], rest: {},
      summaries: { mine: sum('mine', 'dm', ['bob']), theirs: sum('theirs', 'carol') } })); // 'old': no summary yet
    store.set('hub-camp-mine', JSON.stringify({ id: 'mine', dmUserId: 'dm', members: ['bob'], secretsKept: true, tokens: {} }));
    store.set('hub-camp-theirs', JSON.stringify({ id: 'theirs', dmUserId: 'carol', members: [], secretsKept: true }));
    store.set('hub-camp-old', JSON.stringify({ id: 'old', dmUserId: 'carol', members: [], secretsKept: true }));
  };
  const reads = async () => (await import('../plugin-sdk.js')).storageGet.mock.calls.map(c => c[0]);
  beforeEach(async () => { (await import('../plugin-sdk.js')).storageGet.mockClear(); });

  it('skips a campaign whose summary leaves the user out; one without a summary is still read', async () => {
    seed(); mod.setSecretsUser('bob');
    const data = await mod.loadHubDm();
    expect(Object.keys(data.campaigns).sort()).toEqual(['mine', 'old']);
    expect(await reads()).not.toContain('hub-camp-theirs');
    expect(mod.otherCampaigns().map(c => c.id)).toEqual(['theirs']);
    expect(mod.isUnreadCampaign('theirs')).toBe(true);
  });

  it('with no known user, reads everything (the old behaviour)', async () => {
    seed();
    expect(Object.keys((await mod.loadHubDm()).campaigns).sort()).toEqual(['mine', 'old', 'theirs']);
  });

  it('a save keeps the unread campaigns in the index, and a token move does not rewrite the index', async () => {
    seed(); mod.setSecretsUser('bob');
    const data = await mod.loadHubDm();
    data.campaigns.mine.tokens.a = { x: 1 };
    await mod.saveHubDm(data);
    let idx = JSON.parse(store.get('hub-index'));
    expect(idx.campaignIds.sort()).toEqual(['mine', 'old', 'theirs']);
    expect(idx.summaries.theirs.dmUserId).toBe('carol');
    expect(idx.summaries.mine.members).toEqual(['bob']);
    const sdk = await import('../plugin-sdk.js');
    sdk.storageSet.mockClear();
    data.campaigns.mine.tokens.a = { x: 2 };
    await mod.saveHubDm(data);
    expect(sdk.storageSet.mock.calls.map(c => c[0])).toEqual(['hub-camp-mine']);
  });

  it('deleting your own campaign never drops one you did not read', async () => {
    seed(); mod.setSecretsUser('dm');
    const data = await mod.loadHubDm();
    expect(mod.isUnreadCampaign('theirs')).toBe(true);
    delete data.campaigns.mine;
    await mod.saveHubDm(data, { allowRemovals: true });
    expect(JSON.parse(store.get('hub-index')).campaignIds.sort()).toEqual(['old', 'theirs']);
  });

  it('a campaign created on another screen since our load survives our save', async () => {
    seed(); mod.setSecretsUser('dm');
    const data = await mod.loadHubDm();
    const idx = JSON.parse(store.get('hub-index'));
    store.set('hub-index', JSON.stringify({ ...idx, campaignIds: [...idx.campaignIds, 'new'], summaries: { ...idx.summaries, new: sum('new', 'carol') } }));
    data.campaigns.mine.name = 'Renamed';
    await mod.saveHubDm(data);
    const after = JSON.parse(store.get('hub-index'));
    expect(after.campaignIds).toContain('new');
    expect(after.summaries.new.dmUserId).toBe('carol');
    // ...and a later deletion of our own campaign still keeps it
    delete data.campaigns.mine;
    await mod.saveHubDm(data, { allowRemovals: true });
    expect(JSON.parse(store.get('hub-index')).campaignIds.sort()).toEqual(['new', 'old', 'theirs']);
  });

  it('an older copy never writes a new member back out of the summary (Bob would lose his table)', async () => {
    seed();
    store.set('hub-camp-two', JSON.stringify({ id: 'two', dmUserId: 'dm', members: [], secretsKept: true }));
    const i0 = JSON.parse(store.get('hub-index'));
    store.set('hub-index', JSON.stringify({ ...i0, campaignIds: [...i0.campaignIds, 'two'], summaries: { ...i0.summaries, two: sum('two', 'dm') } }));
    mod.setSecretsUser('dm');
    const data = await mod.loadHubDm(); // the DM's screen holds 'two' with no members
    // Charlie joins 'two' on his own screen: its record and its summary now list him
    store.set('hub-camp-two', JSON.stringify({ id: 'two', dmUserId: 'dm', members: ['charlie'], secretsKept: true }));
    const i1 = JSON.parse(store.get('hub-index'));
    store.set('hub-index', JSON.stringify({ ...i1, summaries: { ...i1.summaries, two: sum('two', 'dm', ['charlie']) } }));
    data.campaigns.mine.name = 'Renamed'; // the DM changes a different campaign
    await mod.saveHubDm(data);
    expect(JSON.parse(store.get('hub-index')).summaries.two.members).toEqual(['charlie']);
  });

  it('asking to join reads that one campaign', async () => {
    seed(); mod.setSecretsUser('bob');
    const data = await mod.loadHubDm();
    const camp = await mod.loadCampaign(data, 'theirs');
    expect(camp.dmUserId).toBe('carol');
    expect(mod.isUnreadCampaign('theirs')).toBe(false);
    camp.members = ['bob'];
    await mod.saveHubDm(data);
    expect(JSON.parse(store.get('hub-camp-theirs')).members).toEqual(['bob']);
    expect(JSON.parse(store.get('hub-index')).summaries.theirs.members).toEqual(['bob']);
  });
});

describe('a deleted campaign stays deleted (hub-index deletedIds)', () => {
  const seed = () => {
    store.set('hub-index', JSON.stringify({ campaignIds: ['a', 'b'], rest: {} }));
    store.set('hub-camp-a', JSON.stringify({ id: 'a', n: 1 }));
    store.set('hub-camp-b', JSON.stringify({ id: 'b', n: 1 }));
  };

  it('deleting records the campaign in deletedIds', async () => {
    seed();
    const data = await mod.loadHubDm();
    delete data.campaigns.b;
    await mod.saveHubDm(data, { allowRemovals: true });
    const idx = JSON.parse(store.get('hub-index'));
    expect(idx.campaignIds).toEqual(['a']);
    expect(idx.deletedIds).toEqual(['b']);
  });

  it("another screen's Hub that still holds the campaign does not put it back", async () => {
    seed();
    const bob = await mod.loadHubDm();                 // Bob's Hub loaded both
    store.set('hub-index', JSON.stringify({ campaignIds: ['a'], deletedIds: ['b'], rest: {} })); // the DM deleted b
    store.delete('hub-camp-b');
    bob.campaigns.b.n = 2;                             // Bob moves a token in b
    bob.campaigns.a.n = 2;
    bob.rest2 = 1;                                     // and something forces an index write
    await mod.saveHubDm(bob);
    const idx = JSON.parse(store.get('hub-index'));
    expect(idx.campaignIds).toEqual(['a']);
    expect(idx.deletedIds).toEqual(['b']);
    expect(store.has('hub-camp-b')).toBe(false);
  });

  it('a load skips a deleted campaign whose record survived', async () => {
    seed();
    store.set('hub-index', JSON.stringify({ campaignIds: ['a', 'b'], deletedIds: ['b'], rest: {} }));
    const data = await mod.loadHubDm();
    expect(Object.keys(data.campaigns)).toEqual(['a']);
  });
});
