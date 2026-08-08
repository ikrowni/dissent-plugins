import { describe, it, expect, afterEach } from 'vitest';
import { getJson, setFetcher, resetFetcher, HttpError } from './http.js';

afterEach(() => { resetFetcher(); });

// The exact payload the host resolves fetch:external with. Verified 2026-08-08 against
// dissent-core plugins_fetch.go (which builds { status, body, content_type }) and
// dissent-client providers/network.ts (which passes it through as ok(res.data)).
//
// NOTE THE ABSENT `ok`. That is the whole point of this file: an earlier getJson tested
// `if (!res.ok) throw`, so every 200 threw and every panel in the plugin read
// "could not load" while the node logged only 200s. Every other test stub in this repo
// invents an `ok` field, so none of them could catch it.
const hostShape = (status, body) => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
  content_type: 'application/json',
});

describe('getJson — against the REAL host payload shape', () => {
  it('parses a 200 that carries no `ok` field', async () => {
    setFetcher(async () => hostShape(200, { week: 1, season: '2026' }));
    await expect(getJson('https://x/y')).resolves.toEqual({ week: 1, season: '2026' });
  });

  it('accepts every 2xx, not just 200', async () => {
    for (const s of [200, 201, 204, 299]) {
      setFetcher(async () => hostShape(s, { s }));
      await expect(getJson('https://x/y')).resolves.toEqual({ s });
    }
  });

  it('throws on a real upstream error status, carrying it through', async () => {
    setFetcher(async () => hostShape(403, '{}'));
    await expect(getJson('https://x/y')).rejects.toMatchObject({
      name: 'HttpError', status: 403,
    });
  });

  it('throws on 3xx and 5xx too', async () => {
    for (const s of [301, 404, 500, 502]) {
      setFetcher(async () => hostShape(s, '{}'));
      await expect(getJson('https://x/y')).rejects.toBeInstanceOf(HttpError);
    }
  });
});

describe('getJson — tolerances', () => {
  it('still honours an explicit ok:true from a stub that supplies one', async () => {
    setFetcher(async () => ({ ok: true, status: 200, body: '{"a":1}' }));
    await expect(getJson('https://x/y')).resolves.toEqual({ a: 1 });
  });

  it('treats an explicit ok:false as a failure even with a 2xx status', async () => {
    setFetcher(async () => ({ ok: false, status: 200, body: '{}' }));
    await expect(getJson('https://x/y')).rejects.toBeInstanceOf(HttpError);
  });

  it('accepts an already-parsed object body', async () => {
    setFetcher(async () => ({ status: 200, body: { a: 1 } }));
    await expect(getJson('https://x/y')).resolves.toEqual({ a: 1 });
  });

  it('reports unparseable json rather than leaking a SyntaxError', async () => {
    setFetcher(async () => hostShape(200, 'not json at all'));
    await expect(getJson('https://x/y')).rejects.toMatchObject({ name: 'HttpError' });
  });

  it('wraps a transport rejection (the 15s timeout path) as status 0', async () => {
    setFetcher(async () => { throw new Error('timeout'); });
    await expect(getJson('https://x/y')).rejects.toMatchObject({ status: 0 });
  });

  it('treats a missing status as a failure rather than a silent success', async () => {
    setFetcher(async () => ({ body: '{}' }));
    await expect(getJson('https://x/y')).rejects.toBeInstanceOf(HttpError);
  });
});
