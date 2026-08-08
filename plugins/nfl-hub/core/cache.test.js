import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCache, TTL } from './cache.js';

describe('createCache', () => {
  let cache;
  beforeEach(() => { vi.useFakeTimers(); cache = createCache(); });

  it('calls the loader once and caches the result', async () => {
    const load = vi.fn().mockResolvedValue('v');
    expect(await cache.get('k', load, 1000)).toBe('v');
    expect(await cache.get('k', load, 1000)).toBe('v');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent callers into a single in-flight load', async () => {
    let resolve;
    const load = vi.fn(() => new Promise((r) => { resolve = r; }));
    const a = cache.get('k', load, 1000);
    const b = cache.get('k', load, 1000);
    const c = cache.get('k', load, 1000);
    // The loader runs on a microtask, so let it start before asserting.
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    resolve('shared');
    expect(await Promise.all([a, b, c])).toEqual(['shared', 'shared', 'shared']);
  });

  it('reloads after the ttl expires', async () => {
    const load = vi.fn().mockResolvedValueOnce('one').mockResolvedValueOnce('two');
    expect(await cache.get('k', load, 1000)).toBe('one');
    vi.advanceTimersByTime(1001);
    expect(await cache.get('k', load, 1000)).toBe('two');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps entries with distinct keys separate', async () => {
    await cache.get('a', () => Promise.resolve(1), 1000);
    await cache.get('b', () => Promise.resolve(2), 1000);
    expect(cache.peek('a')).toBe(1);
    expect(cache.peek('b')).toBe(2);
  });

  it('does not cache a rejection, and lets the next caller retry', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    await expect(cache.get('k', load, 1000)).rejects.toThrow('boom');
    expect(await cache.get('k', load, 1000)).toBe('recovered');
  });

  it('serves a stale value when the loader fails and staleOnError is set', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce('fresh')
      .mockRejectedValueOnce(new Error('offline'));
    expect(await cache.get('k', load, 1000, { staleOnError: true })).toBe('fresh');
    vi.advanceTimersByTime(1001);
    expect(await cache.get('k', load, 1000, { staleOnError: true })).toBe('fresh');
  });

  it('still rejects with staleOnError when there is no previous value', async () => {
    const load = vi.fn().mockRejectedValue(new Error('cold'));
    await expect(cache.get('k', load, 1000, { staleOnError: true })).rejects.toThrow('cold');
  });

  it('peek returns undefined for a missing or expired key', async () => {
    expect(cache.peek('nope')).toBeUndefined();
    await cache.get('k', () => Promise.resolve('v'), 1000);
    vi.advanceTimersByTime(1001);
    expect(cache.peek('k')).toBeUndefined();
  });

  it('peekStale still returns an expired value', async () => {
    await cache.get('k', () => Promise.resolve('v'), 1000);
    vi.advanceTimersByTime(1001);
    expect(cache.peek('k')).toBeUndefined();
    expect(cache.peekStale('k')).toBe('v');
  });

  it('invalidate drops one key, clear drops all', async () => {
    await cache.get('a', () => Promise.resolve(1), 1000);
    await cache.get('b', () => Promise.resolve(2), 1000);
    cache.invalidate('a');
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.peek('b')).toBe(2);
    cache.clear();
    expect(cache.peek('b')).toBeUndefined();
  });

  it('caches a falsy value rather than treating it as a miss', async () => {
    const load = vi.fn().mockResolvedValue(0);
    expect(await cache.get('k', load, 1000)).toBe(0);
    expect(await cache.get('k', load, 1000)).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('TTL', () => {
  it('polls live data far more often than static data', () => {
    expect(TTL.GAME_LIVE).toBeLessThan(TTL.STANDINGS);
    expect(TTL.SCOREBOARD_LIVE).toBeLessThan(TTL.SCOREBOARD_IDLE);
    expect(TTL.SLEEPER_MATCHUPS).toBeLessThan(TTL.SLEEPER_LEAGUE);
  });

  it('treats a finished game as effectively immutable', () => {
    expect(TTL.GAME_FINAL).toBeGreaterThanOrEqual(3_600_000);
  });
});

describe('wave 3B TTLs', () => {
  it('caches a completed week far longer than a live one', () => {
    expect(TTL.SLEEPER_WEEK_FINAL).toBeGreaterThan(TTL.SLEEPER_MATCHUPS);
  });

  it('caches a completed draft and a bracket for at least an hour', () => {
    expect(TTL.SLEEPER_DRAFT).toBeGreaterThanOrEqual(3_600_000);
    expect(TTL.SLEEPER_BRACKET).toBeGreaterThanOrEqual(3_600_000);
  });

  it('refreshes transactions faster than league metadata', () => {
    expect(TTL.SLEEPER_TRANSACTIONS).toBeLessThan(TTL.SLEEPER_LEAGUE);
  });
});
