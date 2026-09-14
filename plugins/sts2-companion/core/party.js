// core/party.js — co-op parties: the host's Companion shares the run with the guests'.
//
// 🔴 Why this exists: in Slay the Spire 2 co-op only the HOST's game keeps the run (a guest has no
// current_run_mp.save and no history file, confirmed 2026-09-14), so a guest's Companion has nothing to
// read. Members share a party code; whoever has the run on disk sends it, sealed with the code
// (core/partyCrypto.js), through the stats service's memory-only relay; the others open it.
//
// Being in a party IS the opt-in: starting or joining one says, on screen, what is sent. Only co-op runs
// are sent — never a solo run — and finished runs only if they ended after the member joined.
//
// Storage: the party (code, member id, joined time) in storage:user, so it follows the user between their
// devices; what was sent and what was received in storage:local, as the digest cache is.

import { STATS_HOST } from './sharing.js';
import { newPartyCode, normalizeCode, formatCode, deriveParty, seal, openSealed } from './partyCrypto.js';
import { listRunSummaries } from './runList.js';

export const PARTY_KEY = 'party';
const CURRENT_KEY = 'party:current';
const SENT_CURRENT_KEY = 'party:sentCurrent';
const SENT_FINISHED_KEY = 'party:sentFinished';
const SEEN_KEY = 'party:seen';
const IMPORTED_KEY = 'party:imported';
const runKey = (id) => `party:run:${id}`;
/** The relay forgets a run in progress 2 h after its last update; so does a guest. */
export const CURRENT_TTL_MS = 2 * 3600 * 1000;
const MAX_FINISHED_PER_SYNC = 5;
const PULL_EVERY_MS = 4000;

const safe = async (fn, fallback = null) => { try { return await fn(); } catch { return fallback; } };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const isCoop = (run) => (run?.players?.length ?? 0) > 1;
const finished = (s) => !s.abandoned && (s.win || s.killed_by);

export async function readParty(store) {
  const p = await safe(() => store.get(PARTY_KEY));
  return p && normalizeCode(p.code) ? p : null;
}

export async function startParty(store, { now = Date.now() } = {}) {
  return joinParty(store, newPartyCode(), { now });
}

export async function joinParty(store, input, { now = Date.now() } = {}) {
  const code = formatCode(input);
  if (!code) return { ok: false, error: 'not a party code' };
  const party = { code, memberId: (await sha(`${crypto.getRandomValues(new Uint32Array(4)).join('.')}|${now}`)).slice(0, 16), joinedAt: Math.floor(now / 1000) };
  await store.set(PARTY_KEY, party);
  return { ok: true, ...party };
}

/** Leave: nothing more is sent or received. Runs already received stay in this computer's history. */
export async function leaveParty(store) {
  await store.set(PARTY_KEY, null);
}

/** The guest's position: in a two-player run, the player the sender was not. Otherwise unknown. */
export function guessYou(senderYou, players) {
  if (players !== 2 || (senderYou !== 1 && senderYou !== 2)) return null;
  return 3 - senderYou;
}

const post = (net, path, payload) => net(`${STATS_HOST}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
const getJson = async (net, path) => {
  const r = await net(`${STATS_HOST}${path}`, {});
  let body = null;
  try { body = JSON.parse(r.body); } catch { /* not JSON */ }
  return { status: r.status, body };
};

/**
 * Send what this computer's game has: the co-op run in progress when it changed, and co-op runs that
 * finished since joining and were not sent. `saves` must be the LOCAL saves, never makePartySaves.
 */
export async function pushParty({ saves, store, local, net, now = Date.now() }) {
  const party = await readParty(store);
  if (!party) return { status: 'off' };
  const { channel, key } = await deriveParty(party.code);
  const out = { status: 'ok', current: 'none', finished: 0 };

  const cur = await saves('currentRun');
  if (cur?.status === 'ok') {
    if (!isCoop(cur)) {
      out.current = 'not_coop';
    } else {
      const digest = await sha(JSON.stringify(cur));
      if (digest === await safe(() => local.get(SENT_CURRENT_KEY))) {
        out.current = 'unchanged';
      } else {
        const data = await seal(key, { v: 1, kind: 'current', from: party.memberId, you: cur.you ?? null, sentAt: now, run: cur });
        const r = await safe(() => post(net, `/v1/party/${channel}/current`, { data }));
        out.current = r?.status === 200 ? 'sent' : 'failed';
        if (out.current === 'sent') await safe(() => local.set(SENT_CURRENT_KEY, digest));
      }
    }
  }

  const list = await listRunSummaries(saves);
  if (list.status === 'ok') {
    const sent = new Set((await safe(() => local.get(SENT_FINISHED_KEY))) ?? []);
    const due = list.runs.filter((s) => s.players > 1 && finished(s) && !sent.has(String(s.id))
      && Number(s.id) + (Number(s.run_time) || 0) >= party.joinedAt).slice(0, MAX_FINISHED_PER_SYNC);
    for (const s of due) {
      const run = await saves('run', { id: String(s.id) });
      if (run?.status !== 'ok') continue;
      const data = await seal(key, { v: 1, kind: 'finished', from: party.memberId, you: run.summary?.you ?? null, sentAt: now, run });
      const itemKey = (await sha(`${party.memberId}:${s.id}`)).slice(0, 32);
      const r = await safe(() => post(net, `/v1/party/${channel}/finished`, { key: itemKey, data }));
      if (r?.status !== 200) break;
      sent.add(String(s.id));
      out.finished += 1;
    }
    if (out.finished) await safe(() => local.set(SENT_FINISHED_KEY, [...sent].slice(-500)));
  }
  return out;
}

/** Receive from the party: the run in progress, and finished runs not yet imported. */
export async function pullParty({ store, local, net, now = Date.now() }) {
  const party = await readParty(store);
  if (!party) return { status: 'off' };
  const { channel, key } = await deriveParty(party.code);
  const out = { status: 'ok', current: false, imported: 0 };

  const cur = await safe(() => getJson(net, `/v1/party/${channel}/current`));
  if (cur?.status === 200 && cur.body?.data) {
    const env = await safe(() => openSealed(key, cur.body.data));
    if (env?.kind === 'current' && env.from !== party.memberId && isCoop(env.run)) {
      const previous = await safe(() => local.get(CURRENT_KEY));
      if (previous?.sentAt !== env.sentAt) {
        await safe(() => local.set(CURRENT_KEY, { from: env.from, you: env.you, sentAt: env.sentAt, run: env.run }));
        out.current = true;
      }
    }
  }

  const fin = await safe(() => getJson(net, `/v1/party/${channel}/finished`));
  if (fin?.status === 200 && Array.isArray(fin.body?.runs)) {
    const seen = new Set((await safe(() => local.get(SEEN_KEY))) ?? []);
    const index = (await safe(() => local.get(IMPORTED_KEY))) ?? [];
    for (const item of fin.body.runs) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      const env = await safe(() => openSealed(key, item.data));
      if (env?.kind !== 'finished' || env.from === party.memberId || env.run?.status !== 'ok') continue;
      const id = String(env.run.summary?.id ?? '');
      if (!/^\d+$/.test(id) || index.some((x) => x.id === id)) continue;
      const you = guessYou(env.you, env.run.players?.length ?? 0);
      const run = { ...env.run, summary: { ...env.run.summary, you, shared: 'party' } };
      await safe(() => local.set(runKey(id), run));
      index.push({ id, summary: run.summary });
      out.imported += 1;
    }
    await safe(() => local.set(SEEN_KEY, [...seen].slice(-500)));
    if (out.imported) await safe(() => local.set(IMPORTED_KEY, index));
  }
  return out;
}

/** The party's run in progress as last received, or null (none, or older than the relay keeps it). */
export async function sharedCurrent(local, { now = Date.now() } = {}) {
  const c = await safe(() => local.get(CURRENT_KEY));
  return c?.run && now - c.sentAt <= CURRENT_TTL_MS ? c : null;
}

/** Finished runs received from the party, newest first: `[{ id, summary }]`. */
export async function importedRuns(local) {
  const index = (await safe(() => local.get(IMPORTED_KEY))) ?? [];
  return [...index].sort((a, b) => Number(b.id) - Number(a.id));
}

/**
 * game.saves as the views should see it: this computer's saves, with the party's filled in where this
 * computer has none — the run in progress when the local one is missing or older, and finished runs
 * merged into the history pages. Outside a party it is exactly `saves`.
 */
export function makePartySaves({ saves, store, local, net, now = () => Date.now() }) {
  let lastPull = 0;
  return async (action, params = {}) => {
    const localAnswer = await saves(action, params);
    const party = await readParty(store);
    if (!party) return localAnswer;

    if (action === 'currentRun') {
      if (now() - lastPull >= PULL_EVERY_MS) { lastPull = now(); await safe(() => pullParty({ store, local, net, now: now() })); }
      const shared = await sharedCurrent(local, { now: now() });
      if (!shared) return localAnswer;
      const localSaved = localAnswer?.status === 'ok' ? (Number(localAnswer.saved_at) || 0) * 1000 : -Infinity;
      if (localSaved >= shared.sentAt - 60_000) return localAnswer;
      const you = guessYou(shared.you, shared.run.players.length);
      const mine = shared.run.players.find((p) => p.player === you);
      return { ...shared.run, you, character: mine?.character ?? shared.run.character, shared: { by: 'party', sentAt: shared.sentAt } };
    }

    if (action === 'runs' && localAnswer?.status === 'ok') {
      const imported = await importedRuns(local);
      if (!imported.length) return localAnswer;
      const have = new Set(localAnswer.runs.map((r) => String(r.id)));
      const upper = params.before ? Number(params.before) : Infinity;
      const lower = localAnswer.next_before != null ? Number(localAnswer.next_before) : -Infinity;
      const extra = imported.filter((r) => !have.has(r.id) && Number(r.id) < upper && Number(r.id) >= lower).map((r) => r.summary);
      const runs = [...localAnswer.runs, ...extra].sort((a, b) => Number(b.id) - Number(a.id));
      return { ...localAnswer, runs };
    }

    if (action === 'run' && localAnswer?.status !== 'ok') {
      const stored = await safe(() => local.get(runKey(String(params.id))));
      return stored ?? localAnswer;
    }
    return localAnswer;
  };
}
