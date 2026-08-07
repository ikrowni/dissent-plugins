// core/http.js — the single outbound path. Everything external goes through here.
import { request } from '../../plugin-sdk.js';

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** The host returns { ok, status, body } with body as a STRING, not a Response. */
async function hostFetch(url) {
  return request('fetch:external', { url, method: 'GET' }, 15_000);
}

let fetcher = hostFetch;

/** Swap the transport. Tests inject a stub; production never calls this. */
export function setFetcher(fn) { fetcher = fn; }
export function resetFetcher() { fetcher = hostFetch; }

export async function getJson(url) {
  let res;
  try {
    res = await fetcher(url);
  } catch (err) {
    throw new HttpError(`fetch failed: ${err?.message ?? err}`, 0);
  }
  if (!res?.ok) throw new HttpError(`HTTP ${res?.status ?? 0} for ${url}`, res?.status ?? 0);
  try {
    return typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  } catch {
    throw new HttpError(`unparseable json from ${url}`, res.status ?? 200);
  }
}
