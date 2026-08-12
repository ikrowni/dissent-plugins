import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, KEY, MAX_KEY_BYTES } from './store.js';

describe('KEY builders', () => {
  it('shards the week-scoped keys', () => {
    expect(KEY.picks(2026, 3)).toBe('pickem:2026:w3');
    expect(KEY.powerBallots(2026, 12)).toBe('power:2026:w12');
  });
  it('keeps season-scoped keys unsharded', () => {
    expect(KEY.pickemStandings(2026)).toBe('pickem:standings:2026');
    // ⚠️ `tradeBlock` was here and is gone. It was a season-scoped key belonging to
    // the Broadcast Center's unbuilt social layer, never written by anything; the
    // live trade block is `KEY.tradeBlock(lg)` in server/store.js, league-scoped.
    // Removed with the Sleeper mirror on 2026-08-12.
    expect(KEY.tradeBlock).toBeUndefined();
    expect(KEY.bets(2026)).toBe('bets:2026');
    expect(KEY.awards(2026)).toBe('awards:2026');
  });
  it('names the single user-scoped preferences key', () => {
    expect(KEY.prefs()).toBe('prefs');
  });
});

describe('createStore', () => {
  let get, set, store;
  beforeEach(() => {
    get = vi.fn();
    set = vi.fn().mockResolvedValue(true);
    store = createStore({ storageGet: get, storageSet: set });
  });

  it('reads a server-scoped key', async () => {
    get.mockResolvedValue({ a: 1 });
    await expect(store.getShared('k')).resolves.toEqual({ a: 1 });
    expect(get).toHaveBeenCalledWith('k', 'server');
  });

  it('reads a user-scoped key', async () => {
    get.mockResolvedValue({ b: 2 });
    await expect(store.getUser('prefs')).resolves.toEqual({ b: 2 });
    expect(get).toHaveBeenCalledWith('prefs', 'user');
  });

  it('returns the fallback when a key is absent', async () => {
    get.mockResolvedValue(null);
    await expect(store.getShared('k', { picks: {} })).resolves.toEqual({ picks: {} });
  });

  it('returns the fallback rather than throwing when the host errors', async () => {
    get.mockRejectedValue(new Error('offline'));
    await expect(store.getShared('k', 'fb')).resolves.toBe('fb');
  });

  it('writes a server-scoped key', async () => {
    await store.setShared('k', { a: 1 });
    expect(set).toHaveBeenCalledWith('k', { a: 1 }, 'server');
  });

  it('writes a user-scoped key', async () => {
    await store.setUser('prefs', { team: 'KC' });
    expect(set).toHaveBeenCalledWith('prefs', { team: 'KC' }, 'user');
  });

  it('refuses a value over the 64 KB per-key limit instead of failing at the host', async () => {
    const huge = { blob: 'x'.repeat(MAX_KEY_BYTES + 1) };
    await expect(store.setShared('k', huge)).rejects.toThrow(/64 KB/);
    expect(set).not.toHaveBeenCalled();
  });

  it('names the offending key in the size error, so the fix is obvious', async () => {
    const huge = { blob: 'x'.repeat(MAX_KEY_BYTES + 1) };
    await expect(store.setShared('pickem:2026:w1', huge)).rejects.toThrow(/pickem:2026:w1/);
  });

  it('allows a value just under the limit', async () => {
    const ok = { blob: 'x'.repeat(1000) };
    await expect(store.setShared('k', ok)).resolves.toBe(true);
  });

  it('reports false rather than throwing when a write fails', async () => {
    set.mockRejectedValue(new Error('quota'));
    await expect(store.setShared('k', { a: 1 })).resolves.toBe(false);
  });

  it('merges shared state read-modify-write so concurrent writers do not clobber', async () => {
    get.mockResolvedValue({ alice: ['KC'] });
    await store.mergeShared('pickem:2026:w1', (cur) => ({ ...cur, bob: ['BUF'] }));
    expect(set).toHaveBeenCalledWith(
      'pickem:2026:w1', { alice: ['KC'], bob: ['BUF'] }, 'server');
  });

  it('merges from the fallback when the key does not exist yet', async () => {
    get.mockResolvedValue(null);
    await store.mergeShared('k', (cur) => ({ ...cur, x: 1 }), {});
    expect(set).toHaveBeenCalledWith('k', { x: 1 }, 'server');
  });

  it('re-reads immediately before writing, not at some earlier point', async () => {
    get.mockResolvedValue({});
    await store.mergeShared('k', (cur) => ({ ...cur, x: 1 }));
    // One read per merge, ordered before the write.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.invocationCallOrder[0]).toBeLessThan(set.mock.invocationCallOrder[0]);
  });
});

describe('KEY.playoffOdds', () => {
  it('shards by league, season and week so a stale sim is never shown', () => {
    expect(KEY.playoffOdds('123', 2025, 14)).toBe('odds:123:2025:w14');
  });

  it('differs across weeks', () => {
    expect(KEY.playoffOdds('123', 2025, 14)).not.toBe(KEY.playoffOdds('123', 2025, 15));
  });
});
