import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadStats, pickCell, communityRates, STATS_URL, CACHE_KEY, DAY_MS } from './stats.js';
import { aggregate } from '../../../services/sts2-stats/src/aggregate.mjs';
import { pluginData } from '../../../services/sts2-stats/src/data.mjs';
import { buildContribution } from './contribution.js';
import { bandOf } from './builds.js';

const ROOT = process.cwd();
const RUN = JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/run-1773796874.json`));

/** Stats as the REAL aggregation writes them, from 60 copies of the real co-op run (4 of them wins). */
async function realStats() {
  const runs = Array.from({ length: 60 }, (_, i) => ({ ...buildContribution(RUN), ...(i < 4 ? { win: true, killedBy: null } : {}) }));
  return aggregate(runs, pluginData());
}

const memory = (initial) => {
  const m = new Map(initial ? [[CACHE_KEY, initial]] : []);
  return { m, get: async (k) => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); } };
};

describe('loadStats: cache → conditional fetch once a day → bundled snapshot', () => {
  const NOW = Date.UTC(2026, 8, 14, 12);

  it('fetches, caches with the ETag, and serves the cache for a day without asking again', async () => {
    const stats = await realStats();
    const calls = [];
    const net = async (url, opts) => { calls.push({ url, opts }); return { status: 200, body: JSON.stringify(stats), etag: '"abc"' }; };
    const local = memory();
    expect(await loadStats({ local, net, snapshot: async () => null, now: NOW })).toMatchObject({ source: 'network', stats });
    expect(calls).toEqual([{ url: STATS_URL, opts: { headers: {} } }]);
    expect(await loadStats({ local, net, snapshot: async () => null, now: NOW + DAY_MS - 1 })).toMatchObject({ source: 'cache' });
    expect(calls).toHaveLength(1);
  });

  it('after a day asks with If-None-Match, and a 304 keeps the cache', async () => {
    const stats = await realStats();
    const local = memory({ etag: '"abc"', checkedAt: NOW - DAY_MS, stats });
    const calls = [];
    const net = async (url, opts) => { calls.push(opts); return { status: 304, body: '', etag: '"abc"' }; };
    expect(await loadStats({ local, net, snapshot: async () => null, now: NOW })).toMatchObject({ source: 'cache', stats });
    expect(calls).toEqual([{ headers: { 'If-None-Match': '"abc"' } }]);
    expect(local.m.get(CACHE_KEY).checkedAt).toBe(NOW);
  });

  it('offline or refused: the old cache, then the bundled snapshot, then nothing', async () => {
    const stats = await realStats();
    const net = async () => { throw new Error('net:direct: not granted'); };
    expect(await loadStats({ local: memory({ etag: null, checkedAt: 0, stats }), net, snapshot: async () => null, now: NOW }))
      .toMatchObject({ source: 'cache', stale: true, stats });
    expect(await loadStats({ local: memory(), net, snapshot: async () => stats, now: NOW })).toMatchObject({ source: 'snapshot', stats });
    expect(await loadStats({ local: memory(), net, snapshot: async () => null, now: NOW })).toEqual({ source: 'none', stats: null });
  });

  it('a body that is not stats schema 1 is ignored', async () => {
    const net = async () => ({ status: 200, body: '{"schema":9}', etag: null });
    expect(await loadStats({ local: memory(), net, snapshot: async () => null, now: NOW })).toEqual({ source: 'none', stats: null });
  });
});

describe('pickCell', () => {
  it('finds the matching cell in the user\'s build, else the newest build, saying which', async () => {
    const stats = await realStats();
    const want = { character: 'CHARACTER.IRONCLAD', band: bandOf(0), mode: 'coop' };
    expect(pickCell(stats, { ...want, build: 'v0.99.1' })).toMatchObject({ build: 'v0.99.1', sameBuild: true, cell: { runs: 60 } });
    expect(pickCell(stats, { ...want, build: 'v1.4.0' })).toMatchObject({ build: 'v0.99.1', sameBuild: false });
    expect(pickCell(stats, { ...want, mode: 'solo', build: 'v0.99.1' })).toBeNull();
    expect(pickCell(null, { ...want, build: 'v0.99.1' })).toBeNull();
  });
});

describe('communityRates', () => {
  it('turns published counts into rates with intervals', async () => {
    const { cell } = pickCell(await realStats(), { character: 'CHARACTER.IRONCLAD', band: '0', mode: 'coop', build: 'v0.99.1' });
    const r = communityRates(cell);
    expect(r.winRate).toMatchObject({ n: 60, rate: 4 / 60 });
    const killer = r.encounters.find((e) => e.id === 'ENCOUNTER.SOUL_NEXUS_ELITE');
    expect(killer).toMatchObject({ fought: 60, deaths: 56, rate: { n: 60, rate: 56 / 60 } });
    expect(killer.rate.low).toBeLessThan(56 / 60);
    expect(r.encounters[0].rate.rate).toBeGreaterThanOrEqual(r.encounters.at(-1).rate.rate);
    expect(r.buildTypes.map((b) => b.label).sort()).toEqual(['Mixed', 'Vulnerable']);
    // Every copy is the same run, so picking a card goes with winning exactly as often as skipping it.
    expect(r.cards.length).toBeGreaterThan(0);
    expect(r.cards.every((c) => c.impact == null || Math.abs(c.impact) < 1e-9)).toBe(true);
  });
});
