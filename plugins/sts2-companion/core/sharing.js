// core/sharing.js — opt-in sharing of finished runs with STS2 community stats (spec §4).
//
// Off by default. Settings — the switches and the random identity — live in storage:user, so the choice
// follows the user between their own devices. The list of runs already sent lives in storage:local: it
// holds run ids, which are start timestamps, and must never leave this computer.
//
// 🔴 A personal plugin runs only while its page or a panel is open, so sending is not tied to a run
// ending: every sync sends every finished run not yet sent. The service deduplicates, so two panels
// syncing at once cost a duplicate count, never a duplicate run.

import { buildContribution } from './contribution.js';
import { listRunSummaries } from './runList.js';

export const STATS_HOST = 'https://sts2-stats.plugins.dissent.chat';
export const SETTINGS_KEY = 'community:sharing';
export const SENT_KEY = 'community:sent';
export const BACKFILL_CAP = 200;
export const BATCH = 20; // the service's per-request maximum
const BATCH_BYTES = 900_000; // under the 1 MB request cap net:direct and the service both enforce
const MAX_BATCHES = 15; // per sync: 300 runs, the service's daily allowance per contributor
const BACKOFF_MIN_S = 60;
const BACKOFF_MAX_S = 3600;

const OFF = { enabled: false, backfill: false };

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A random v4 UUID from getRandomValues — randomUUID needs a secure context, which a sandboxed frame may not be. */
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = hex(b);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export async function readSettings(store) {
  const s = await Promise.resolve().then(() => store.get(SETTINGS_KEY)).catch(() => null);
  return s && typeof s === 'object' ? { ...OFF, ...s } : { ...OFF };
}

/** Turn sharing on. The identity is made once, from nothing about the user, and kept until data is deleted. */
export async function optIn(store, { now = Date.now(), backfill = false } = {}) {
  const s = await readSettings(store);
  const next = {
    ...s,
    enabled: true,
    backfill: backfill || s.backfill,
    since: s.since ?? Math.floor(now / 1000),
    contributorId: s.contributorId ?? uuid(),
    deleteToken: s.deleteToken ?? hex(crypto.getRandomValues(new Uint8Array(32))),
  };
  await store.set(SETTINGS_KEY, next);
  return next;
}

/** Stop sending. The identity stays, so the shared runs can still be deleted. */
export async function optOut(store) {
  const s = await readSettings(store);
  await store.set(SETTINGS_KEY, { ...s, enabled: false });
}

export async function setBackfill(store, on) {
  const s = await readSettings(store);
  await store.set(SETTINGS_KEY, { ...s, backfill: Boolean(on) });
}

const shareable = (s) => !s.abandoned && s.game_mode === 'standard' && (s.win || s.killed_by);

/** Ids to send, newest first: runs finished since opting in, plus the newest past runs when backfilling. */
export function selectRuns(summaries, settings, sent) {
  const candidates = summaries.filter((s) => shareable(s) && !sent.has(String(s.id)));
  const since = settings.since ?? Number.MAX_SAFE_INTEGER;
  const finishedAfter = (s) => Number(s.id) + (Number(s.run_time) || 0) >= since;
  const future = candidates.filter(finishedAfter);
  const past = settings.backfill
    ? summaries.filter((s) => shareable(s) && !finishedAfter(s)).slice(0, BACKFILL_CAP).filter((s) => !sent.has(String(s.id)))
    : [];
  return [...future, ...past].map((s) => String(s.id));
}

async function readSent(local) {
  const v = await Promise.resolve().then(() => local.get(SENT_KEY)).catch(() => null);
  return { ids: Array.isArray(v?.ids) ? v.ids : [], refused: v?.refused ?? 0, failures: v?.failures ?? 0, retryAt: v?.retryAt ?? 0 };
}

const post = async (net, path, payload) => {
  const r = await net(`${STATS_HOST}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  let body = null;
  try { body = JSON.parse(r.body); } catch { /* not JSON: treated by status */ }
  return { status: r.status, body };
};

/** The host refused before any request left the computer: no permission, not desktop, or host not approved. */
export const UNAVAILABLE = /not granted|needs the Dissent desktop|not an approved domain|unknown action/;

let inFlight = null;

/**
 * Send what is due. `{ status }`: 'off', a game.saves status, 'backoff' (waiting after a failure),
 * 'offline', 'error', or 'ok' with { sent, accepted, duplicates, refused, waiting }.
 */
export function syncRuns(deps) {
  inFlight ??= doSync(deps).finally(() => { inFlight = null; });
  return inFlight;
}

async function doSync({ saves, store, local, net, now = () => Date.now() }) {
  const settings = await readSettings(store);
  if (!settings.enabled || !settings.contributorId) return { status: 'off' };
  const list = await listRunSummaries(saves);
  if (list.status !== 'ok') return { status: list.status };

  const state = await readSent(local);
  const sent = new Set(state.ids);
  const due = selectRuns(list.runs, settings, sent);
  const nowS = Math.floor(now() / 1000);
  if (state.retryAt > nowS) return { status: 'backoff', waiting: due.length, retryAt: state.retryAt };

  const totals = { sent: 0, accepted: 0, duplicates: 0, refused: 0 };
  const save = () => local.set(SENT_KEY, { ...state, ids: [...sent] }).catch(() => {});
  let queue = due;
  for (let b = 0; b < MAX_BATCHES && queue.length; b++) {
    const ids = []; const runs = []; let bytes = 0;
    while (queue.length && ids.length < BATCH) {
      const id = queue[0];
      const run = await saves('run', { id });
      const c = run?.status === 'ok' ? buildContribution(run) : null;
      if (!c) { queue = queue.slice(1); continue; } // unreadable or no longer finished-standard: skip, not sent
      const size = JSON.stringify(c).length;
      if (ids.length && bytes + size > BATCH_BYTES) break;
      queue = queue.slice(1);
      ids.push(id); runs.push(c); bytes += size;
    }
    if (!ids.length) break;

    let r;
    try {
      r = await post(net, '/v1/runs', { contributor_id: settings.contributorId, delete_token: settings.deleteToken, runs });
    } catch (e) {
      if (UNAVAILABLE.test(String(e?.message ?? e))) {
        await save();
        return { status: 'unavailable', ...totals, waiting: ids.length + queue.length };
      }
      r = null;
    }
    if (!r || r.status >= 500 || r.status === 429) {
      state.failures += 1;
      state.retryAt = nowS + Math.min(BACKOFF_MAX_S, BACKOFF_MIN_S * 2 ** (state.failures - 1));
      await save();
      return { status: 'offline', ...totals, waiting: ids.length + queue.length };
    }
    if (r.status !== 200 || !r.body?.ok) {
      await save();
      return { status: 'error', error: r.body?.error ?? `HTTP ${r.status}`, ...totals, waiting: ids.length + queue.length };
    }

    state.failures = 0;
    state.retryAt = 0;
    const limited = new Set((r.body.refused ?? []).filter((x) => x.reason === 'rate_limited').map((x) => x.index));
    ids.forEach((id, i) => { if (!limited.has(i)) sent.add(id); });
    const refused = (r.body.refused ?? []).length - limited.size;
    state.refused += refused;
    Object.assign(totals, {
      sent: totals.sent + ids.length - limited.size,
      accepted: totals.accepted + (r.body.accepted ?? 0),
      duplicates: totals.duplicates + (r.body.duplicates ?? 0),
      refused: totals.refused + refused,
    });
    if (limited.size) {
      // Today's allowance is used up: try again in an hour rather than hammering.
      state.retryAt = nowS + BACKOFF_MAX_S;
      await save();
      return { status: 'ok', ...totals, waiting: limited.size + queue.length };
    }
  }
  await save();
  return { status: 'ok', ...totals, waiting: queue.length };
}

/** Erase every shared run on the service, then forget the identity and the sent list. */
export async function deleteSharedData({ store, local, net }) {
  const s = await readSettings(store);
  if (!s.contributorId) return { status: 'ok', deleted: 0 };
  let r;
  try {
    r = await post(net, '/v1/contributors/delete', { contributor_id: s.contributorId, delete_token: s.deleteToken });
  } catch (e) {
    const error = String(e?.message ?? e);
    return { status: UNAVAILABLE.test(error) ? 'unavailable' : 'offline', error };
  }
  if (r.status !== 200 || !r.body?.ok) return { status: 'error', error: r.body?.error ?? `HTTP ${r.status}` };
  await store.set(SETTINGS_KEY, { ...OFF });
  await Promise.resolve().then(() => local.del(SENT_KEY)).catch(() => {});
  return { status: 'ok', deleted: r.body.deleted };
}

/** The newest shareable run exactly as it would be sent, or null. */
export async function previewContribution(saves) {
  const list = await listRunSummaries(saves);
  if (list.status !== 'ok') return null;
  const newest = list.runs.find(shareable);
  if (!newest) return null;
  return buildContribution(await saves('run', { id: String(newest.id) }));
}

/** What has been sent from this computer. */
export async function sharingState(local) {
  const s = await readSent(local);
  return { sent: s.ids.length, refused: s.refused, retryAt: s.retryAt };
}
