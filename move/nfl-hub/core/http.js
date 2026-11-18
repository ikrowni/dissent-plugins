// core/http.js — the single outbound path. Everything external goes through here.
import { request } from '../../plugin-sdk.js';

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * The host resolves `fetch:external` with the node's data payload:
 *
 *     { status: number, body: string, content_type: string }
 *
 * ⚠️ There is NO `ok` field. The provider does `ok(res.data)` (dissent-client
 * `providers/network.ts`) and the node builds that map in `plugins_fetch.go` — neither
 * adds one. An earlier version of this file tested `if (!res.ok) throw`, which threw on
 * every SUCCESSFUL response and made every panel in the plugin read "could not load"
 * while the node logged nothing but 200s.
 *
 * That survived because every test stub and every dev rig hand-wrote an `ok` field,
 * encoding the assumption instead of the contract. Success is decided by `status`.
 */
/**
 * Did this failure come from the node REFUSING us, rather than from the network?
 *
 * ⚠️ THE DIFFERENCE DECIDES WHETHER A RETRY BUTTON IS HONEST. A viewer who picks
 * "View Without Joining" grants the plugin nothing — dissent-client's
 * SidebarOrchestrator calls `runGrant([], "view anonymously")` — so the node
 * answers every outbound call with `fetch:external not granted` for as long as
 * that choice stands. Offering "Try again" for that is offering a button that
 * cannot ever work, which is the same mistake the League tab's "no draft yet"
 * pane made before it was fixed.
 *
 * ⚠️ MATCHED NARROWLY, on the node's own wording in `plugins_fetch.go`. Widening
 * this to anything mentioning "permission" would swallow real outages and tell a
 * user their setup is wrong when the network is down.
 */
export function isPermissionDenied(err) {
  const msg = typeof err === 'string' ? err : String(err?.message ?? '');
  return /\bnot granted\b/i.test(msg);
}

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
  // Decide on status, which the host actually sends. `ok` is honoured only when it is
  // explicitly present (some stubs and the SDK's own shape carry it) — never required,
  // because the real host omits it.
  const status = Number(res?.status ?? 0);
  const flag = res?.ok;
  // An explicit flag wins in BOTH directions when present; otherwise status decides.
  const succeeded = flag === true
    || (flag !== false && status >= 200 && status < 300);
  if (!succeeded) throw new HttpError(`HTTP ${status} for ${url}`, status);
  try {
    return typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  } catch {
    throw new HttpError(`unparseable json from ${url}`, res.status ?? 200);
  }
}
