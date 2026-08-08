import { describe, it, expect, vi } from 'vitest';
import { probeRange, resolveCfId, CF_URL } from './ufc-cf-client.js';

const evt = (id, start, name) => ({
  status: 200,
  body: JSON.stringify({ LiveEventDetail: { EventId: id, StartTime: start, Name: name } }),
});

describe('CF_URL', () => {
  it('builds the live event url', () => {
    expect(CF_URL(1324)).toBe('https://d29dxerjsp82wz.cloudfront.net/api/v3/event/live/1324.json');
  });
});

describe('probeRange', () => {
  it('returns every id that resolves, skipping the misses', async () => {
    const fetcher = vi.fn(async (url) => {
      const id = Number(url.match(/(\d+)\.json/)[1]);
      if (id === 1324) return evt(1324, '2026-08-08T21:00Z', 'A');
      if (id === 1325) return evt(1325, '2026-08-28T09:00Z', 'B');
      return { status: 404, body: 'Page not found' };
    });
    const out = await probeRange(1323, 1326, { fetcher });
    expect(out.map((e) => e.eventId)).toEqual([1324, 1325]);
  });

  it('never exceeds the requested span, so a bad anchor cannot fan out', async () => {
    const fetcher = vi.fn(async () => ({ status: 404, body: '' }));
    await probeRange(1000, 1007, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it('tolerates a throwing transport', async () => {
    const fetcher = vi.fn(async () => { throw new Error('down'); });
    await expect(probeRange(1, 3, { fetcher })).resolves.toEqual([]);
  });
});

describe('resolveCfId', () => {
  const target = { id: '600060621', date: '2026-08-08', name: 'UFC Fight Night: Gamrot vs Salkilld' };

  it('returns a cached id without probing at all', async () => {
    const fetcher = vi.fn();
    const store = { getUser: async () => 1324, setUser: async () => true };
    await expect(resolveCfId(target, { store, fetcher })).resolves.toBe(1324);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('probes and caches the id on a miss', async () => {
    const setUser = vi.fn(async () => true);
    const store = { getUser: async () => null, setUser };
    const fetcher = vi.fn(async (url) => {
      const id = Number(url.match(/(\d+)\.json/)[1]);
      return id === 1324
        ? evt(1324, '2026-08-08T21:00Z', 'UFC Fight Night: Gamrot vs. Salkilld')
        : { status: 404, body: '' };
    });
    const got = await resolveCfId(target, { store, fetcher, anchorId: 1322, span: 4 });
    expect(got).toBe(1324);
    expect(setUser).toHaveBeenCalledWith('cfid:600060621', 1324);
  });

  it('caches EVERY event the probe discovers, so a neighbour costs no fetches', async () => {
    // The probe of 25 ids learns ~25 events. Caching only the requested one would re-pay
    // all 25 requests for the very next event in the same month.
    const mem = new Map();
    const store = {
      getUser: async (k) => mem.get(k) ?? null,
      setUser: async (k, v) => { mem.set(k, v); return true; },
    };
    const fetcher = vi.fn(async (url) => {
      const id = Number(url.match(/(\d+)\.json/)[1]);
      if (id === 1324) return evt(1324, '2026-08-08T21:00Z', 'Gamrot vs. Salkilld');
      if (id === 1323) return evt(1323, '2026-08-22T21:00Z', 'Hernandez vs. Rodrigues');
      return { status: 404, body: '' };
    });

    await resolveCfId(target, { store, fetcher, anchorId: 1324, span: 2 });
    const afterFirst = fetcher.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // A DIFFERENT event, on a date the same probe already saw.
    const neighbour = { id: '600060999', date: '2026-08-22', name: 'Hernandez vs Rodrigues' };
    const got = await resolveCfId(neighbour, { store, fetcher, anchorId: 1324, span: 2 });
    expect(got).toBe(1323);
    expect(fetcher.mock.calls.length).toBe(afterFirst);
  });

  it('returns null rather than throwing when nothing matches the date', async () => {
    const store = { getUser: async () => null, setUser: async () => true };
    const fetcher = vi.fn(async () => ({ status: 404, body: '' }));
    await expect(resolveCfId(target, { store, fetcher, anchorId: 1322, span: 2 }))
      .resolves.toBe(null);
  });
});
