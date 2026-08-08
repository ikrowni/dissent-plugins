import { describe, it, expect, afterEach } from 'vitest';
import { getJson, setFetcher, resetFetcher, HttpError } from './http.js';

afterEach(() => resetFetcher());

describe('getJson', () => {
  // The host's real reply is { status, body, content_type } with NO `ok` field. An
  // earlier nfl-hub version tested `if (!res.ok) throw`, so every 200 threw and every
  // panel read "could not load". Every stub here mirrors the REAL shape.
  it('parses a 200 that carries no `ok` field', async () => {
    setFetcher(async () => ({ status: 200, body: '{"a":1}', content_type: 'application/json' }));
    await expect(getJson('u')).resolves.toEqual({ a: 1 });
  });

  it('throws on a 404', async () => {
    setFetcher(async () => ({ status: 404, body: 'nope' }));
    await expect(getJson('u')).rejects.toBeInstanceOf(HttpError);
  });

  it('throws on unparseable json', async () => {
    setFetcher(async () => ({ status: 200, body: 'not json' }));
    await expect(getJson('u')).rejects.toBeInstanceOf(HttpError);
  });

  it('surfaces a transport failure as HttpError status 0', async () => {
    setFetcher(async () => { throw new Error('boom'); });
    await expect(getJson('u')).rejects.toMatchObject({ status: 0 });
  });
});
