import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { openDb } from '../../../services/sts2-stats/src/db.mjs';
import { createLimits } from '../../../services/sts2-stats/src/limits.mjs';
import { createHandler } from '../../../services/sts2-stats/src/app.mjs';
import { pluginData } from '../../../services/sts2-stats/src/data.mjs';
import {
  readSettings, optIn, optOut, setBackfill, selectRuns, syncRuns, deleteSharedData, previewContribution,
  SETTINGS_KEY, SENT_KEY, BACKFILL_CAP,
} from './sharing.js';

const ROOT = process.cwd();
const RUN = JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/run-1773796874.json`));
const START = Number(RUN.summary.id);

/** `n` REAL runs, each a copy of the fixture with its own id (start time) and one field varied so no two contribute alike. */
function history(n, { firstId = START } = {}) {
  const runs = new Map();
  for (let i = 0; i < n; i++) {
    const id = String(firstId + i * 10_000);
    const floors = 10 + (i % 70);
    runs.set(id, { ...RUN, summary: { ...RUN.summary, id, started_at: Number(id), floors } });
  }
  return runs;
}

/** game.saves as the desktop app answers it: newest first, pages of `limit`, next_before. */
function fakeSaves(runs) {
  return async (action, params = {}) => {
    const all = [...runs.values()].sort((a, b) => Number(b.summary.id) - Number(a.summary.id));
    if (action === 'runs') {
      const from = params.before ? all.findIndex((r) => r.summary.id === params.before) + 1 : 0;
      const page = all.slice(from, from + (params.limit ?? 100));
      const more = from + page.length < all.length;
      return { status: 'ok', runs: page.map((r) => r.summary), skipped: 0, next_before: more ? page.at(-1).summary.id : null };
    }
    if (action === 'run') return runs.get(params.id) ?? { status: 'not_found' };
    return { status: 'error' };
  };
}

const memory = () => {
  const m = new Map();
  return { m, get: async (k) => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async (k) => { m.delete(k); } };
};

let server; let db; let requests; let net; let offline;
beforeEach(async () => {
  db = openDb(':memory:');
  server = http.createServer(createHandler({ db, data: pluginData(), limits: createLimits() }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  requests = [];
  offline = false;
  // net.fetch as the SDK answers it: { status, body, … }, rejecting when the request cannot be made.
  net = async (url, { method = 'GET', body, headers } = {}) => {
    if (offline) throw new Error('net:direct: error sending request');
    requests.push({ url, method, body: body ? JSON.parse(body) : undefined });
    const r = await fetch(base + new URL(url).pathname, { method, body, headers });
    return { status: r.status, body: await r.text(), content_type: r.headers.get('content-type'), etag: null, truncated: false };
  };
});
afterEach(() => new Promise((r) => server.close(r)));

const storedRuns = () => db.prepare('SELECT count(*) AS n FROM runs').get().n;
const NOW = (START + 5_000_000) * 1000;

describe('settings', () => {
  it('is off by default', async () => {
    expect(await readSettings(memory())).toEqual({ enabled: false, backfill: false });
  });

  it('opting in makes a random identity once, and keeps it across off and on', async () => {
    const store = memory();
    const a = await optIn(store, { now: NOW });
    expect(a).toMatchObject({ enabled: true, backfill: false, since: NOW / 1000 });
    expect(a.contributorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.deleteToken).toMatch(/^[0-9a-f]{64}$/);
    await optOut(store);
    expect(await readSettings(store)).toMatchObject({ enabled: false, contributorId: a.contributorId });
    expect((await optIn(store, { now: NOW + 1000 })).contributorId).toBe(a.contributorId);
    expect((await optIn(memory(), { now: NOW })).contributorId).not.toBe(a.contributorId);
  });

  it('a store that refuses reads as off', async () => {
    expect(await readSettings({ get: async () => { throw new Error('refused'); } })).toEqual({ enabled: false, backfill: false });
  });
});

describe('selectRuns', () => {
  const summaries = [...history(5).values()].map((r) => r.summary).reverse();
  const since = Number(summaries[1].id) + 1; // runs 0 and 1 (newest) finished after; the rest before

  it('sends only runs that finished after opting in, unless past runs are shared too', () => {
    const settings = { enabled: true, backfill: false, since };
    expect(selectRuns(summaries, settings, new Set())).toEqual([summaries[0].id, summaries[1].id]);
    expect(selectRuns(summaries, { ...settings, backfill: true }, new Set())).toHaveLength(5);
  });

  it('never picks what was sent, abandoned, unfinished or not standard', () => {
    const odd = [
      { ...summaries[0], abandoned: true }, { ...summaries[1], win: false, killed_by: null },
      { ...summaries[2], game_mode: 'daily' }, summaries[3], summaries[4],
    ];
    expect(selectRuns(odd, { enabled: true, backfill: true, since: 0 }, new Set([summaries[3].id]))).toEqual([summaries[4].id]);
  });

  it(`caps past runs at the ${BACKFILL_CAP} newest`, () => {
    const many = [...history(BACKFILL_CAP + 30).values()].map((r) => r.summary).reverse();
    expect(selectRuns(many, { enabled: true, backfill: true, since: Number.MAX_SAFE_INTEGER }, new Set())).toHaveLength(BACKFILL_CAP);
  });
});

describe('syncRuns against the REAL service handler', () => {
  it('does nothing while sharing is off', async () => {
    const r = await syncRuns({ saves: fakeSaves(history(3)), store: memory(), local: memory(), net, now: () => NOW });
    expect(r).toEqual({ status: 'off' });
    expect(requests).toEqual([]);
  });

  it('sends past runs in batches of 20, remembers them, and sends nothing twice', async () => {
    const store = memory(); const local = memory();
    await optIn(store, { now: NOW, backfill: true });
    const saves = fakeSaves(history(45));
    const first = await syncRuns({ saves, store, local, net, now: () => NOW });
    expect(first).toMatchObject({ status: 'ok', sent: 45, accepted: 45, refused: 0, waiting: 0 });
    expect(requests.map((q) => q.body.runs.length)).toEqual([20, 20, 5]);
    expect(storedRuns()).toBe(45);
    requests = [];
    expect(await syncRuns({ saves, store, local, net, now: () => NOW })).toMatchObject({ status: 'ok', sent: 0 });
    expect(requests).toEqual([]);
  });

  // 🔴 The preview is what is sent: the same function builds both.
  it('🔴 sends exactly the previewed contribution — no id, no timestamp', async () => {
    const store = memory();
    await optIn(store, { now: NOW, backfill: true });
    const saves = fakeSaves(history(1));
    const preview = await previewContribution(saves);
    await syncRuns({ saves, store, local: memory(), net, now: () => NOW });
    expect(requests[0].body.runs[0]).toEqual(preview);
    expect(JSON.stringify(requests[0].body.runs)).not.toContain(String(START));
  });

  it('offline: keeps runs waiting and backs off, then sends them once back', async () => {
    const store = memory(); const local = memory();
    await optIn(store, { now: NOW, backfill: true });
    const saves = fakeSaves(history(3));
    offline = true;
    expect(await syncRuns({ saves, store, local, net, now: () => NOW })).toMatchObject({ status: 'offline', waiting: 3 });
    offline = false;
    expect(await syncRuns({ saves, store, local, net, now: () => NOW + 1000 })).toMatchObject({ status: 'backoff', waiting: 3 });
    expect(requests).toEqual([]);
    expect(await syncRuns({ saves, store, local, net, now: () => NOW + 61_000 })).toMatchObject({ status: 'ok', sent: 3 });
    expect(storedRuns()).toBe(3);
  });

  // Not a network failure: no backoff, and the user is told what to do.
  for (const reason of ['net:direct not granted', 'net:direct needs the Dissent desktop app', 'net:direct: sts2-stats.plugins.dissent.chat is not an approved domain']) {
    it(`"${reason}" reads as unavailable, not offline`, async () => {
      const store = memory(); const local = memory();
      await optIn(store, { now: NOW, backfill: true });
      const refuse = async () => { throw new Error(reason); };
      expect(await syncRuns({ saves: fakeSaves(history(2)), store, local, net: refuse, now: () => NOW })).toMatchObject({ status: 'unavailable', waiting: 2 });
      expect(await syncRuns({ saves: fakeSaves(history(2)), store, local, net, now: () => NOW + 1 })).toMatchObject({ status: 'ok', sent: 2 });
    });
  }

  it('an implausible run is counted as refused and not retried', async () => {
    const store = memory(); const local = memory();
    await optIn(store, { now: NOW, backfill: true });
    const runs = history(2);
    const [bad] = runs.keys();
    runs.set(bad, { ...runs.get(bad), summary: { ...runs.get(bad).summary, ascension: 99 } });
    const saves = fakeSaves(runs);
    expect(await syncRuns({ saves, store, local, net, now: () => NOW })).toMatchObject({ status: 'ok', accepted: 1, refused: 1 });
    requests = [];
    await syncRuns({ saves, store, local, net, now: () => NOW });
    expect(requests).toEqual([]);
  });

  it('game saves unavailable (web, no desktop) reads as that status', async () => {
    const store = memory();
    await optIn(store, { now: NOW });
    expect(await syncRuns({ saves: async () => ({ status: 'desktop_only' }), store, local: memory(), net, now: () => NOW }))
      .toEqual({ status: 'desktop_only' });
  });
});

describe('deleteSharedData', () => {
  it('erases every shared run, forgets the identity and the sent list', async () => {
    const store = memory(); const local = memory();
    const a = await optIn(store, { now: NOW, backfill: true });
    await syncRuns({ saves: fakeSaves(history(4)), store, local, net, now: () => NOW });
    expect(await deleteSharedData({ store, local, net })).toEqual({ status: 'ok', deleted: 4 });
    expect(storedRuns()).toBe(0);
    expect(await readSettings(store)).toEqual({ enabled: false, backfill: false });
    expect(local.m.has(SENT_KEY)).toBe(false);
    expect((await optIn(store, { now: NOW })).contributorId).not.toBe(a.contributorId);
  });

  it('offline: says so and forgets nothing', async () => {
    const store = memory();
    await optIn(store, { now: NOW });
    offline = true;
    expect(await deleteSharedData({ store, local: memory(), net })).toMatchObject({ status: 'offline' });
    expect((await readSettings(store)).contributorId).toBeTruthy();
  });

  it('setBackfill changes only that switch', async () => {
    const store = memory();
    const a = await optIn(store, { now: NOW });
    await setBackfill(store, true);
    expect(store.m.get(SETTINGS_KEY)).toEqual({ ...a, backfill: true });
  });
});
