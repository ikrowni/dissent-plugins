import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { openDb } from './db.mjs';
import { createLimits } from './limits.mjs';
import { createHandler } from './app.mjs';
import { pluginData } from './data.mjs';
import { createParty, PARTY_TTL_MS, FINISHED_TTL_MS, MAX_FINISHED, MAX_BLOB } from './party.mjs';

const CH = 'a'.repeat(32);
const blob = (n = 100, fill = 'Q') => fill.repeat(n);

describe('party store (memory only)', () => {
  let t; let party;
  beforeEach(() => { t = 1_000_000; party = createParty({ now: () => t, budgetBytes: 10_000 }); });

  it('keeps the latest current run per channel, and forgets it after the TTL', () => {
    party.putCurrent(CH, blob(10, 'A'));
    party.putCurrent(CH, blob(10, 'B'));
    expect(party.getCurrent(CH)).toEqual({ data: blob(10, 'B'), updatedAt: t });
    t += PARTY_TTL_MS + 1;
    expect(party.getCurrent(CH)).toBeNull();
  });

  it('keeps finished runs by key, newest last, at most MAX_FINISHED, each for FINISHED_TTL', () => {
    for (let i = 0; i < MAX_FINISHED + 3; i++) { party.putFinished(CH, `k${i}`, blob(10)); t += 1; }
    party.putFinished(CH, 'k5', blob(10)); // a repeat is not a second copy
    const list = party.getFinished(CH);
    expect(list.map((x) => x.key)).toEqual(Array.from({ length: MAX_FINISHED }, (_, i) => `k${i + 3}`));
    t += FINISHED_TTL_MS + 100;
    expect(party.getFinished(CH)).toEqual([]);
  });

  it('evicts the least recently written channels past the memory budget', () => {
    for (let i = 0; i < 30; i++) { party.putCurrent(String(i).padStart(32, '0'), blob(1000)); t += 1; }
    expect(party.bytes()).toBeLessThanOrEqual(10_000);
    expect(party.getCurrent('29'.padStart(32, '0'))).not.toBeNull();
    expect(party.getCurrent('0'.padStart(32, '0'))).toBeNull();
  });
});

describe('party routes', () => {
  let server; let base; let db;
  beforeEach(async () => {
    db = openDb(':memory:');
    server = http.createServer(createHandler({ db, data: pluginData(), limits: createLimits(), party: createParty() }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(() => new Promise((r) => server.close(r)));

  const req = (method, path, body) => fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

  it('stores and returns the current run as opaque data', async () => {
    expect((await req('GET', `/v1/party/${CH}/current`)).status).toBe(404);
    expect(await req('POST', `/v1/party/${CH}/current`, { data: 'c2VhbGVk' })).toEqual({ status: 200, body: { ok: true } });
    const r = await req('GET', `/v1/party/${CH}/current`);
    expect(r.body).toMatchObject({ ok: true, data: 'c2VhbGVk' });
  });

  it('stores finished runs and lists them', async () => {
    await req('POST', `/v1/party/${CH}/finished`, { key: 'b'.repeat(32), data: 'c2VhbGVk' });
    const r = await req('GET', `/v1/party/${CH}/finished`);
    expect(r.body.runs).toEqual([expect.objectContaining({ key: 'b'.repeat(32), data: 'c2VhbGVk' })]);
  });

  it('refuses a bad channel, a bad key, data that is not base64, and data over the cap', async () => {
    expect((await req('POST', '/v1/party/short/current', { data: 'c2VhbGVk' })).status).toBe(400);
    expect((await req('POST', `/v1/party/${CH}/finished`, { key: 'x', data: 'c2VhbGVk' })).status).toBe(400);
    expect((await req('POST', `/v1/party/${CH}/current`, { data: '{"deck":[]}' })).status).toBe(400);
    expect((await req('POST', `/v1/party/${CH}/current`, { data: 'A'.repeat(MAX_BLOB + 4) })).status).toBe(413);
  });

  // 🔴 Nothing a party sends is written to the database.
  it('🔴 writes nothing to the database', async () => {
    await req('POST', `/v1/party/${CH}/current`, { data: 'c2VhbGVk' });
    await req('POST', `/v1/party/${CH}/finished`, { key: 'b'.repeat(32), data: 'c2VhbGVk' });
    expect(db.prepare('SELECT count(*) AS n FROM runs').get().n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM contributors').get().n).toBe(0);
  });
});
