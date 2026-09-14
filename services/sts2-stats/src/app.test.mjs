import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { openDb } from './db.mjs';
import { createLimits } from './limits.mjs';
import { createHandler, MAX_RUNS } from './app.mjs';
import { pluginData } from './data.mjs';
import { buildContribution } from '../../../plugins/sts2-companion/core/contribution.js';

const run = JSON.parse(readFileSync(new URL('../../../scripts/sts2/fixtures/saves/run-1773796874.json', import.meta.url)));
const contribution = () => structuredClone(buildContribution(run));
const ID = 'c0ffee00-1111-4222-8333-444455556666';
const TOKEN = 'ab'.repeat(32);

let server; let base; let db;
beforeEach(async () => {
  db = openDb(':memory:');
  server = http.createServer(createHandler({ db, data: pluginData(), limits: createLimits({ perContributor: 30, perIp: 60 }) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

describe('POST /v1/runs', () => {
  it('stores a plausible run once, and counts a repeat as a duplicate', async () => {
    const first = await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs: [contribution()] });
    expect(first).toEqual({ status: 200, body: { ok: true, accepted: 1, duplicates: 0, refused: [] } });
    const again = await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs: [contribution()] });
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM runs').get().n).toBe(1);
  });

  it('refuses an implausible run by index and reason, storing the rest', async () => {
    const bad = contribution(); bad.ascension = 99;
    const r = await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs: [bad, contribution()] });
    expect(r.body).toMatchObject({ accepted: 1, refused: [{ index: 0, reason: 'ascension' }] });
  });

  it('refuses a batch over the limit, a missing contributor, and a wrong token', async () => {
    expect((await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs: Array(MAX_RUNS + 1).fill(contribution()) })).status).toBe(400);
    expect((await post('/v1/runs', { runs: [contribution()] })).status).toBe(400);
    await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs: [contribution()] });
    expect((await post('/v1/runs', { contributor_id: ID, delete_token: 'cd'.repeat(32), runs: [contribution()] })).status).toBe(403);
  });

  it('refuses runs past the daily limit as rate_limited', async () => {
    const runs = Array.from({ length: 20 }, (_, i) => ({ ...contribution(), ascension: i % 20 }));
    await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs });
    const more = Array.from({ length: 20 }, (_, i) => ({ ...contribution(), floors: 1 + i }));
    const r = await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs: more });
    expect(r.body.refused.filter((x) => x.reason === 'rate_limited')).toHaveLength(10);
  });

  // 🔴 The spec's promise, checked where it would break: nothing in the database holds the address.
  it('🔴 never writes the caller\'s address anywhere', async () => {
    await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs: [contribution()] }, { 'x-forwarded-for': '203.0.113.9' });
    const everything = JSON.stringify([
      db.prepare('SELECT * FROM runs').all(), db.prepare('SELECT * FROM contributors').all(),
    ]);
    expect(everything).not.toContain('203.0.113.9');
    expect(everything).not.toContain(TOKEN); // the token is stored hashed
  });

  it('refuses a body over 1 MB', async () => {
    const r = await fetch(base + '/v1/runs', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
    expect(r.status).toBe(413);
  });
});

describe('POST /v1/contributors/delete', () => {
  it('deletes every run and forgets the contributor, only with the right token', async () => {
    await post('/v1/runs', { contributor_id: ID, delete_token: TOKEN, runs: [contribution()] });
    expect((await post('/v1/contributors/delete', { contributor_id: ID, delete_token: 'cd'.repeat(32) })).status).toBe(403);
    expect(await post('/v1/contributors/delete', { contributor_id: ID, delete_token: TOKEN })).toEqual({ status: 200, body: { ok: true, deleted: 1 } });
    expect(db.prepare('SELECT count(*) AS n FROM contributors').get().n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM runs').get().n).toBe(0);
  });
});

describe('everything else', () => {
  it('is 404 or 405', async () => {
    expect((await fetch(base + '/v1/runs')).status).toBe(405);
    expect((await post('/v1/other', {})).status).toBe(404);
  });
});
