// core/party.js — co-op with Dissent friends: whoever hosts shares the run with the friends playing it.
//
// 🔴 Why this exists: in Slay the Spire 2 co-op only the HOST's game keeps the run (a guest has no
// current_run_mp.save and no history file, confirmed 2026-09-14), so a guest's Companion has nothing to
// read. The host's Companion sends the run, sealed (core/partyCrypto.js), through the stats service's
// memory-only relay; friends' Companions open it.
//
// Who receives is Dissent friends:link (dissent-core plugin_links.go):
//   - AUTOMATIC: `friends.match(run)` — the Dissent app reads the players of THIS run from the save, and the
//     node links the friends whose verified Steam accounts are among them. A run goes only to the friends
//     matched IN THAT RUN, marked with which player each was.
//   - INVITE (fallback, e.g. a friend without Steam connected): an accepted invite receives every co-op run
//     this user hosts, because accepting said so.
// Each link has its own random secret, so a friend on one link cannot open what was sent on another.
// Solo runs are never sent; finished runs only if they ended after the link was made.
//
// Storage: a member id in storage:user; links, what was sent and what was received in storage:local.

import { STATS_HOST } from './sharing.js';
import { deriveParty, seal, openSealed } from './partyCrypto.js';
import { listRunSummaries } from './runList.js';

export const PARTY_KEY = 'party';
const LINKS_KEY = 'coop:links';
const ME_KEY = 'coop:me';
const SHARING_KEY = 'coop:sharingNow';
const CURRENT_KEY = 'party:current';
const SEEN_KEY = 'party:seen';
const IMPORTED_KEY = 'party:imported';
const runKey = (id) => `party:run:${id}`;
const sentCurrentKey = (link) => `party:sentCurrent:${link}`;
const sentFinishedKey = (link) => `party:sentFinished:${link}`;
/** The relay forgets a run in progress 2 h after its last update; so does a guest. */
export const CURRENT_TTL_MS = 2 * 3600 * 1000;
const MAX_FINISHED_PER_SYNC = 5;
const PULL_EVERY_MS = 4000;

const safe = async (fn, fallback = null) => { try { return await fn(); } catch { return fallback; } };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const isCoop = (run) => (run?.players?.length ?? 0) > 1;
const finished = (s) => !s.abandoned && (s.win || s.killed_by);

/** This user's member id, made once: lets a Companion ignore what it sent itself. */
export async function myParty(store) {
  const p = await safe(() => store.get(PARTY_KEY));
  if (p?.memberId) return p;
  const fresh = { memberId: (await sha(crypto.getRandomValues(new Uint32Array(4)).join('.'))).slice(0, 16) };
  await store.set(PARTY_KEY, fresh);
  return fresh;
}

/** Channels from friends:link links: every accepted link with a secret. */
export function channelsFrom(links) {
  return (links ?? []).filter((l) => l?.status === 'accepted' && typeof l.secret === 'string' && l.secret.length >= 32)
    .map((l) => ({ linkId: l.id, secret: l.secret, auto: l.auto === true, since: Math.floor((Date.parse(l.created_at) || 0) / 1000), peer: l.peer ?? { handle: '', name: '' } }));
}

/** Ask the node for links (and this user's own handle), remember them on this device, and return the links. */
export async function refreshLinks({ friends, local }) {
  const r = await safe(() => friends.links());
  if (!Array.isArray(r?.links)) return cachedLinks(local);
  await safe(() => local.set(LINKS_KEY, { links: r.links }));
  if (!(await safe(() => local.get(ME_KEY)))) {
    const me = (await safe(() => friends.list()))?.me;
    if (me) await safe(() => local.set(ME_KEY, me));
  }
  return r.links;
}

export async function cachedLinks(local) {
  return (await safe(() => local.get(LINKS_KEY)))?.links ?? [];
}

/** Invite a friend (by handle) — the fallback for a friend automatic matching cannot find. */
export async function inviteToParty({ friends, local, handle }) {
  const r = await friends.invite(handle, {});
  await refreshLinks({ friends, local });
  return r;
}

/** Names of friends this computer is sending its run in progress to, as of the last send. */
export async function sharingNow(local, { now = Date.now() } = {}) {
  const s = await safe(() => local.get(SHARING_KEY));
  return s && now - s.at <= CURRENT_TTL_MS ? s.names : [];
}

/** A receiver's position when the sender could not name it: in a two-player run, the player the sender was not. */
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
 * Who receives one run: the links `friends.match` found in it, plus accepted invites. `positions` maps each
 * matched friend's handle to their player number, sent inside the sealed envelope.
 */
async function targetsFor({ friends, channels, run }) {
  const found = await safe(() => friends.match(run));
  const asked = Array.isArray(found?.matches); // false when refused (not approved yet), offline, or not desktop
  const matches = asked ? found.matches : [];
  const matchedIds = new Set(matches.map((m) => m.link_id));
  const positions = Object.fromEntries(matches.map((m) => [m.handle, m.player]));
  // A link matching just made is not in `channels` (read before it existed): add it from the match itself.
  const fromMatch = matches.filter((m) => m.status === 'accepted' && m.secret && !channels.some((c) => c.linkId === m.link_id))
    .map((m) => ({ linkId: m.link_id, secret: m.secret, auto: true, since: 0, peer: { handle: m.handle, name: m.name } }));
  const targets = [...channels.filter((c) => matchedIds.has(c.linkId) || !c.auto), ...fromMatch];
  return { targets, positions, asked };
}

/**
 * Send what this computer's game has: the co-op run in progress when it changed, and co-op runs that finished
 * after each link was made. `saves` must be the LOCAL saves, never makePartySaves.
 */
export async function pushParty({ saves, store, local, net, friends, channels = [], now = Date.now() }) {
  const { memberId } = await myParty(store);
  const out = { status: 'ok', current: 'none', finished: 0, sharingWith: [] };

  const cur = await saves('currentRun');
  if (cur?.status === 'ok' && !isCoop(cur)) out.current = 'not_coop';
  if (cur?.status === 'ok' && isCoop(cur)) {
    const digest = await sha(JSON.stringify(cur));
    const unsent = [];
    for (const c of channels) if (digest !== await safe(() => local.get(sentCurrentKey(c.linkId)))) unsent.push(c);
    // Ask who is in this run only when something would be sent: a room change, or a run not yet matched.
    const matchedDigest = await safe(() => local.get('party:matchedDigest'));
    if (unsent.length || digest !== matchedDigest) {
      const { targets, positions, asked } = await targetsFor({ friends, channels, run: undefined });
      // Remember the room as matched only when the node answered: a refused or failed match is tried again next sync.
      if (asked) await safe(() => local.set('party:matchedDigest', digest));
      for (const t of targets) {
        if (digest === await safe(() => local.get(sentCurrentKey(t.linkId)))) continue;
        const { channel, key } = await deriveParty(t.secret);
        const data = await seal(key, { v: 2, kind: 'current', from: memberId, you: cur.you ?? null, positions, sentAt: now, run: cur });
        const r = await safe(() => post(net, `/v1/party/${channel}/current`, { data }));
        if (r?.status === 200) {
          out.current = 'sent';
          await safe(() => local.set(sentCurrentKey(t.linkId), digest));
        } else if (out.current !== 'sent') {
          out.current = 'failed';
        }
      }
      out.sharingWith = targets.map((t) => t.peer.name).filter(Boolean);
      await safe(() => local.set(SHARING_KEY, { names: out.sharingWith, at: now }));
      if (out.current === 'none') out.current = targets.length ? 'unchanged' : 'no_friends';
    } else {
      out.current = 'unchanged';
    }
  }

  const list = await listRunSummaries(saves);
  if (list.status === 'ok') {
    const coopRuns = list.runs.filter((s) => s.players > 1 && finished(s));
    let budget = MAX_FINISHED_PER_SYNC;
    for (const s of coopRuns) {
      if (budget <= 0) break;
      const id = String(s.id);
      const endedAt = Number(s.id) + (Number(s.run_time) || 0);
      const due = [];
      for (const c of channels) {
        const sent = (await safe(() => local.get(sentFinishedKey(c.linkId)))) ?? [];
        if (!sent.includes(id) && endedAt >= c.since) due.push(c);
      }
      if (!due.length) continue;
      const { targets, positions, asked } = await targetsFor({ friends, channels: due, run: id });
      if (!asked && due.some((c) => c.auto)) continue; // cannot tell who played it yet: decide on a later sync
      const run = targets.length ? await saves('run', { id }) : null;
      for (const c of due) {
        const sent = (await safe(() => local.get(sentFinishedKey(c.linkId)))) ?? [];
        const target = targets.find((t) => t.linkId === c.linkId);
        if (target && run?.status === 'ok') {
          const { channel, key } = await deriveParty(c.secret);
          const data = await seal(key, { v: 2, kind: 'finished', from: memberId, you: run.summary?.you ?? null, positions, sentAt: now, run });
          const itemKey = (await sha(`${memberId}:${id}`)).slice(0, 32);
          const r = await safe(() => post(net, `/v1/party/${channel}/finished`, { key: itemKey, data }));
          if (r?.status !== 200) continue;
          out.finished += 1;
        }
        // Sent, or decided: an auto link whose friend was not in this run never receives it.
        await safe(() => local.set(sentFinishedKey(c.linkId), [...sent, id].slice(-500)));
      }
      budget -= 1;
    }
  }
  return out;
}

/** The receiver's position: named by the sender when matched, else inferred for two players. */
async function positionFor(local, env) {
  const me = await safe(() => local.get(ME_KEY));
  const named = me && env.positions ? env.positions[me] : undefined;
  return Number.isInteger(named) ? named : guessYou(env.you, env.run?.players?.length ?? 0);
}

/** Receive from every channel: the newest run in progress, and finished runs not yet imported. */
export async function pullParty({ store, local, net, channels }) {
  if (!channels?.length) return { status: 'off' };
  const { memberId } = await myParty(store);
  const out = { status: 'ok', current: false, imported: 0 };
  const seen = new Set((await safe(() => local.get(SEEN_KEY))) ?? []);
  const index = (await safe(() => local.get(IMPORTED_KEY))) ?? [];
  let newest = await safe(() => local.get(CURRENT_KEY));

  for (const ch of channels) {
    const { channel, key } = await deriveParty(ch.secret);
    const cur = await safe(() => getJson(net, `/v1/party/${channel}/current`));
    if (cur?.status === 200 && cur.body?.data) {
      const env = await safe(() => openSealed(key, cur.body.data));
      if (env?.kind === 'current' && env.from !== memberId && isCoop(env.run) && env.sentAt > (newest?.sentAt ?? 0)) {
        newest = { from: env.from, you: await positionFor(local, env), sentAt: env.sentAt, run: env.run, peer: ch.peer?.name ?? '' };
        out.current = true;
      }
    }

    const fin = await safe(() => getJson(net, `/v1/party/${channel}/finished`));
    if (fin?.status !== 200 || !Array.isArray(fin.body?.runs)) continue;
    for (const item of fin.body.runs) {
      const seenKey = `${ch.linkId}:${item.key}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      const env = await safe(() => openSealed(key, item.data));
      if (env?.kind !== 'finished' || env.from === memberId || env.run?.status !== 'ok') continue;
      const id = String(env.run.summary?.id ?? '');
      if (!/^\d+$/.test(id) || index.some((x) => x.id === id)) continue;
      const run = { ...env.run, summary: { ...env.run.summary, you: await positionFor(local, env), shared: 'party', sharedBy: ch.peer?.name ?? '' } };
      await safe(() => local.set(runKey(id), run));
      index.push({ id, summary: run.summary });
      out.imported += 1;
    }
  }
  if (out.current) await safe(() => local.set(CURRENT_KEY, newest));
  await safe(() => local.set(SEEN_KEY, [...seen].slice(-500)));
  if (out.imported) await safe(() => local.set(IMPORTED_KEY, index));
  return out;
}

/** The newest run in progress received from a friend, or null (none, or older than the relay keeps it). */
export async function sharedCurrent(local, { now = Date.now() } = {}) {
  const c = await safe(() => local.get(CURRENT_KEY));
  return c?.run && now - c.sentAt <= CURRENT_TTL_MS ? c : null;
}

/** Finished runs received from friends, newest first: `[{ id, summary }]`. */
export async function importedRuns(local) {
  const index = (await safe(() => local.get(IMPORTED_KEY))) ?? [];
  return [...index].sort((a, b) => Number(b.id) - Number(a.id));
}

/**
 * game.saves as the views should see it: this computer's saves, with friends' filled in where this computer
 * has none — the run in progress when the local one is missing or older, and finished runs merged into the
 * history pages. With no accepted link it is exactly `saves`.
 */
export function makePartySaves({ saves, store, local, net, now = () => Date.now() }) {
  let lastPull = 0;
  return async (action, params = {}) => {
    const localAnswer = await saves(action, params);
    const channels = channelsFrom(await cachedLinks(local));

    if (action === 'currentRun') {
      if (channels.length && now() - lastPull >= PULL_EVERY_MS) {
        lastPull = now();
        await safe(() => pullParty({ store, local, net, channels }));
      }
      const shared = await sharedCurrent(local, { now: now() });
      if (!shared) return localAnswer;
      const localSaved = localAnswer?.status === 'ok' ? (Number(localAnswer.saved_at) || 0) * 1000 : -Infinity;
      if (localSaved >= shared.sentAt - 60_000) return localAnswer;
      const mine = shared.run.players.find((p) => p.player === shared.you);
      return { ...shared.run, you: shared.you, character: mine?.character ?? shared.run.character, shared: { by: 'party', sentAt: shared.sentAt, peer: shared.peer ?? '' } };
    }

    if (action === 'runs' && localAnswer?.status === 'ok') {
      const imported = await importedRuns(local);
      if (!imported.length) return localAnswer;
      const have = new Set(localAnswer.runs.map((r) => String(r.id)));
      const upper = params.before ? Number(params.before) : Infinity;
      const lower = localAnswer.next_before != null ? Number(localAnswer.next_before) : -Infinity;
      const extra = imported.filter((r) => !have.has(r.id) && Number(r.id) < upper && Number(r.id) >= lower).map((r) => r.summary);
      return { ...localAnswer, runs: [...localAnswer.runs, ...extra].sort((a, b) => Number(b.id) - Number(a.id)) };
    }

    if (action === 'run' && localAnswer?.status !== 'ok') {
      return (await safe(() => local.get(runKey(String(params.id))))) ?? localAnswer;
    }
    return localAnswer;
  };
}
