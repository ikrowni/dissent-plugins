// dnd-hub-storage.js — sharded persistence for the DM campaign blob.
//
// WHY: every campaign used to live in one 'hub-dm' value. Plugin KV values are
// capped at 64 KB per key (maxKeyBytes, dissent-core), and the combined blob
// reached ~57 KB across 4 campaigns — so saves started failing with 413 and the
// DM's changes silently stopped persisting.
//
// Each campaign now gets its own key, so every campaign has the full 64 KB to
// itself and adding campaigns no longer moves anyone else toward the ceiling.
// (Measured at migration time: 18.7 / 18.7 / 18.7 / 0.6 KB.)
//
// The legacy 'hub-dm' value is deliberately NEVER written or deleted by this
// module. It stays exactly as it was as a rollback point; loadHubDm() only reads
// it when no sharded index exists yet.
import { storageGet, storageSet, request } from '../plugin-sdk.js';
import { mergeCampaign } from './dnd-campaign-merge.js';
import { splitCampaign, joinCampaign, isCampaignDm, secretKey, withoutStubs } from './lk-secrets.js';
import { needsCampaign, summariesForIndex, idsForIndex, summariesChanged, deletedIdsOf, deletedForIndex } from './lk-campaign-index.js';
import { noteSave } from './dnd-hub-undo.js';

export const HUB_LEGACY_KEY = 'hub-dm';
export const HUB_INDEX_KEY = 'hub-index';
export const hubCampKey = id => `hub-camp-${id}`;

// Serialized form of what we last persisted per campaign. A save writes only the
// campaigns that actually changed — call sites hand us the whole object on every
// pin drag / light tweak / token move, and rewriting all shards each time would
// burn the 60 writes/min plugin-data rate limit.
const _lastWritten = new Map();
// 🔴 The merge base of each campaign OBJECT: what that copy was loaded or last written as (dnd-hub-shared-storage.js
// has the story: a save of an older copy merged against a newer copy's base, and its older values won). Falls back
// to the id's last-written copy.
const _baseOf = new WeakMap();
const seen = (id, camp, json = JSON.stringify(camp)) => { _lastWritten.set(id, json); _baseOf.set(camp, json); };

// 🔴 A save reads and writes with these, never storageGet/storageSet: those return null for a REFUSED read (HTTP 429)
// as for an empty one, and swallow a refused write. A save that took a refused read for "nothing stored" wrote its
// own older copy over everyone's newer edits (a shop's restock and the DM's log went back; rules playtest
// 2026-10-08), and a refused write was recorded as written, so the change was never sent again.
const pause = ms => new Promise(r => setTimeout(r, ms));
async function readStrict(key, scope = 'server', tries = 3) {
  for (let i = 0; ; i++) {
    try { const r = await request('storage:get', { key, scope }); return r?.value ?? null; } // null: nothing stored
    catch (e) { if (i >= tries - 1) throw e; await pause(1500 * (i + 1)); }
  }
}
const writeStrict = (key, value, scope = 'server') => request('storage:set', { key, value, scope });

// Campaign ids the index advertised at last successful read. `null` means we
// have not seen a valid index this session, which is NOT "there are none".
let _indexIds = null;

// 🔴 Campaigns this screen is not in are not read (lk-campaign-index.js): hub-index carries a summary of each, and a
// load reads only the campaigns this user runs or plays in. `_skipped` = ids the index lists that this screen left
// unread; a save keeps them in the index (they are not deletions). `_summaries`/`_indexRest` = what the index said
// at our last read or write, so a save that changes nothing in it does not write it.
const _skipped = new Set();
const _deleted = new Set(); // campaigns the index says were deleted (lk-campaign-index.js): never read, never written back
let _summaries = {};
let _indexRest = null;

// Called with a campaign id when a save pulled in somebody else's edits, so the open
// map can re-render them. Wired in dnd-hub-main.js.
let _onRemoteMerged = null;
export function setOnRemoteMerged(fn) { _onRemoteMerged = fn; }

// 🔴 DM secrets (lk-secrets.js): on the campaign DM's screen a campaign is TWO records, the public `hub-camp-<id>`
// (server scope, every member reads it) and `dm-camp-<id>` (this user's own scope). Everything here works on the
// joined whole; only the DM's screen joins, splits or writes the secret record. A player's screen never strips:
// before the DM's first save the public record still holds the secrets, and stripping them there would delete them.
let _me = null;
/** Who this screen is signed in as; set before the first load. Unset = never treated as the DM. */
export function setSecretsUser(id) { _me = id || null; }
// Campaigns whose secret record read as null although the public one says it exists: a failed read. Never write
// the secret record for these this session, or one bad read replaces the traps with nothing.
const _secretUnreadable = new Set();

/** The secret record when this screen is the campaign's DM: `{ sec, ok }` (ok false = a failed read). */
async function readSecret(id, pub) {
  if (!isCampaignDm(pub, _me)) return { sec: null, ok: true };
  let sec;
  try { sec = await readStrict(secretKey(id), 'user'); } catch { return { sec: null, ok: false }; } // refused: unknown
  return { sec, ok: !!sec || !pub?.secretsKept };
}

// 🔴 Secret records are read only for the campaigns that need them (the one the DM has open: joinSecrets), not for
// every campaign the DM runs. Reading all of them doubled a DM's load, and a couple of reloads then passed the node's
// 120 reads a minute: the Hub came back with "Campaign not found" (2026-10-04). A campaign saved without its secret
// part joined is still safe: base and local both lack the secrets, so the merge keeps the stored ones.
const _joined = new Set();         // campaign ids kept joined across reloads (the open one)
const _joinedObjs = new WeakSet(); // the campaign objects that already hold their secret part

/** Join the DM's secret record into campaign `id` of `data`, in place (callers hold references into it). */
export async function joinSecrets(data, id) {
  const camp = data?.campaigns?.[id];
  if (!camp || !isCampaignDm(camp, _me) || _joinedObjs.has(camp)) return camp;
  const { sec, ok } = await readSecret(id, camp);
  if (!ok) _secretUnreadable.add(id); else _secretUnreadable.delete(id);
  const joined = joinCampaign(camp, sec);
  for (const k of Object.keys(camp)) if (!(k in joined)) delete camp[k];
  Object.assign(camp, joined);
  _joined.add(id); _joinedObjs.add(camp);
  seen(id, camp);
  return camp;
}

/** Reassemble the DM blob from its shards, falling back to the legacy value. */
export async function loadHubDm() {
  const idx = await storageGet(HUB_INDEX_KEY);
  if (idx && Array.isArray(idx.campaignIds)) {
    _indexIds = [...idx.campaignIds];
    _summaries = idx.summaries && typeof idx.summaries === 'object' ? idx.summaries : {};
    _indexRest = JSON.stringify(idx.rest ?? {});
    _skipped.clear();
    for (const id of deletedIdsOf(idx)) _deleted.add(id);
    const campaigns = {};
    let moveOut = false;
    const keepJoined = new Set(_joined); // the open campaign stays joined across a reload of the list
    _joined.clear();
    for (const id of idx.campaignIds) {
      if (_deleted.has(id)) continue;
      if (!needsCampaign(_summaries, id, _me)) { _skipped.add(id); _lastWritten.delete(id); continue; }
      const pub = await storageGet(hubCampKey(id));
      if (!pub) continue; // shard missing — skip rather than resurrect a stub
      const dm = isCampaignDm(pub, _me);
      // A DM's campaign whose public record still holds secrets (written before the split): joined now and left
      // unmarked, so the save the load starts below moves them out with the whole picture.
      const moving = dm && (!pub.secretsKept || !!splitCampaign(pub).sec);
      let camp = pub;
      if (dm && (moving || keepJoined.has(id))) {
        const { sec, ok } = await readSecret(id, pub);
        if (!ok) _secretUnreadable.add(id); else _secretUnreadable.delete(id);
        camp = joinCampaign(pub, sec);
        _joined.add(id); _joinedObjs.add(camp);
      }
      campaigns[id] = camp;
      if (moving) { _lastWritten.delete(id); moveOut = true; } else seen(id, camp);
    }
    const data = { ...(idx.rest ?? {}), campaigns };
    if (moveOut) queueMicrotask(() => saveHubDm(data).catch(e => console.warn('[dnd-hub-storage] moving DM secrets out failed', e)));
    return data;
  }

  _skipped.clear(); _summaries = {}; _indexRest = null;
  const legacy = await storageGet(HUB_LEGACY_KEY);
  if (!legacy) return legacy;
  // First run after the split: force every campaign to be written out once by
  // leaving _lastWritten empty, so the next save materialises the shards.
  _lastWritten.clear();
  _indexIds = null;
  return legacy;
}

/** Campaigns the index lists that this screen did not read: their summaries (for the Join screen). */
export function otherCampaigns() {
  return [..._skipped].map(id => _summaries[id] && { ..._summaries[id], id }).filter(Boolean);
}
/** Whether campaign `id` is listed but was left unread because this user is not in it. */
export const isUnreadCampaign = id => _skipped.has(id);

/** Read one campaign this screen left unread (asking to join it) into `data`; returns it, or null. */
export async function loadCampaign(data, id) {
  if (data?.campaigns?.[id]) return data.campaigns[id];
  const pub = await storageGet(hubCampKey(id));
  if (!pub || !data) return null;
  data.campaigns = data.campaigns || {};
  data.campaigns[id] = pub;
  _skipped.delete(id);
  seen(id, pub);
  return pub;
}

/**
 * Persist the DM blob as one key per campaign plus a small index.
 *
 * `allowRemovals` must be passed by any caller that genuinely means to drop a
 * campaign — today only deleteCampaign(). Without it a save can only add or
 * update, never shrink the index.
 *
 * ⚠️ Why: storageGet swallows errors and returns null, so a failed read is
 * indistinguishable from "no data". If the index reads fine but the shard reads
 * fail, loadHubDm returns `{ campaigns: {} }` — truthy and empty — and writing
 * that back sets `campaignIds: []`. The hub-camp-* shards survive but nothing
 * points at them, so every campaign on the server vanishes for everyone. A
 * stale id left in the index is harmless by comparison: the loader skips a
 * shard that is missing.
 */
// 🔴 One save at a time. Callers fire saves without waiting (every arrow press, every drop), and overlapping saves
// each merged against an old copy; a stale one finishing last wrote its result over the live map, and the token
// jumped back to where it was seconds earlier (owner report 2026-10-03, reproduced). Saves asked for while one runs
// collapse into ONE more save of the newest data, which also keeps a burst of moves under the node's write limit.
let _saving = null, _again = null, _againPromise = null;
export function saveHubDm(data, opts = {}) {
  if (!data) return Promise.resolve();
  noteSave(); // the DM's map tools: what this save changed becomes an undo step (dnd-hub-undo.js)
  return queueSave(data, opts);
}
function queueSave(data, opts = {}) {
  if (_saving) {
    _again = { data, allowRemovals: !!(_again?.allowRemovals || opts.allowRemovals) };
    _againPromise ??= _saving.catch(() => {}).then(() => {
      const a = _again; _again = null; _againPromise = null;
      return queueSave(a.data, { allowRemovals: a.allowRemovals });
    });
    return _againPromise;
  }
  _saving = _saveOnce(data, opts).finally(() => { _saving = null; });
  return _saving;
}

// A save storage refused is tried again with the newest data (nothing was recorded as written, so it still differs).
let _retryTimer = 0, _retryData = null;
function retryLater(data) {
  _retryData = data;
  if (_retryTimer) return;
  _retryTimer = setTimeout(() => { _retryTimer = 0; const d = _retryData; _retryData = null; queueSave(d).catch(() => {}); }, 5000);
}

async function _saveOnce(data, { allowRemovals = false } = {}) {
  const { campaigns = {}, ...rest } = data;
  // Campaigns left unread are still the server's: keep them (a deletion only ever removes a loaded campaign).
  const nextIds = [...Object.keys(campaigns), ...[..._skipped].filter(id => !(id in campaigns))];
  const removed = allowRemovals && _indexIds ? _indexIds.filter(id => !nextIds.includes(id)) : [];

  if (!allowRemovals) {
    let knownIds = _indexIds;
    if (knownIds === null) {
      const current = await storageGet(HUB_INDEX_KEY);
      knownIds = Array.isArray(current?.campaignIds) ? current.campaignIds : [];
    }
    const dropped = knownIds.filter(id => !nextIds.includes(id));
    if (dropped.length) {
      console.warn('[dnd-hub-storage] refusing to drop %d campaign(s) from hub-index without ' +
        'allowRemovals — treating it as a failed read, not a deletion:', dropped.length, dropped);
      nextIds.push(...dropped);
    }
  }

  const written = {}; // campaigns this save merged with what is stored: the only ones whose summary is current
  for (const [id, camp] of Object.entries(campaigns)) {
    const json = JSON.stringify(camp);
    const baseJson = _baseOf.has(camp) ? _baseOf.get(camp) : _lastWritten.get(id);
    if (baseJson === json) continue; // this copy changed nothing since it was read
    // Re-read and three-way merge, so edits made elsewhere since we loaded survive.
    // See dnd-campaign-merge.js for why this replaces a plain overwrite.
    const localNow = JSON.parse(JSON.stringify(camp)); // what this save merges and writes
    let merged;
    try { merged = await _writeCampaign(id, baseJson ? JSON.parse(baseJson) : undefined, localNow); }
    catch (e) { console.warn('[dnd-hub-storage] campaign %s not saved (storage refused); trying again', id, e?.message); retryLater(data); continue; }
    if (!merged) continue; // deleted on another screen: not written back
    const mergedJson = JSON.stringify(merged);
    _lastWritten.set(id, mergedJson);
    if (mergedJson !== JSON.stringify(localNow)) {
      // Adopt what OTHERS changed, keeping what changed HERE while the write was in flight (a token kept moving):
      // a merge with the written snapshot as its base. Adopting `merged` whole put the token back.
      const adopted = mergeCampaign(localNow, camp, merged);
      // In place: callers hold references into this object (MAP.mapData is campaigns[id].maps[mapId]).
      for (const k of Object.keys(camp)) if (!(k in adopted)) delete camp[k];
      Object.assign(camp, adopted);
      _onRemoteMerged?.(id);
    }
    _baseOf.set(camp, mergedJson); // this copy now stands on what was written
    written[id] = merged;
  }

  for (const id of [..._lastWritten.keys()]) {
    if (!(id in campaigns)) _lastWritten.delete(id);
  }

  // Index last: if a shard write fails, the index still points at the previous
  // consistent set rather than advertising a campaign that was never stored.
  // Written only when it changes (a token move changes nothing in it), and from a FRESH read: campaigns created
  // elsewhere since we loaded stay listed, and summaries of campaigns we did not write come from the stored index.
  const restJson = JSON.stringify(rest);
  const idsSame = _indexIds && _indexIds.length === nextIds.length && nextIds.every(id => _indexIds.includes(id));
  if (idsSame && restJson === _indexRest && !summariesChanged(written, _summaries)) return;
  const fresh = await storageGet(HUB_INDEX_KEY);
  const freshOk = !!fresh && Array.isArray(fresh.campaignIds);
  if (freshOk) for (const id of deletedIdsOf(fresh)) _deleted.add(id);
  const deletedIds = deletedForIndex([..._deleted], removed);
  for (const id of removed) _deleted.add(id);
  const ids = idsForIndex(nextIds, freshOk ? fresh.campaignIds : [], removed, deletedIds);
  const summaries = summariesForIndex(ids, written, freshOk ? (fresh.summaries || {}) : null);
  await storageSet(HUB_INDEX_KEY, { campaignIds: ids, rest, summaries, deletedIds });
  _indexIds = [...ids];
  _summaries = summaries;
  _indexRest = restJson;
  // A campaign another screen created since our load is listed now but unread here: kept by later saves, never
  // counted as removed by a deletion. The next load decides whether to read it.
  for (const id of ids) if (!(id in campaigns)) _skipped.add(id);
}

/** Whether campaign `id` was deleted, asking the index when this screen does not know yet (one read, rare). */
async function _isDeleted(id) {
  if (!_deleted.has(id)) for (const d of deletedIdsOf(await storageGet(HUB_INDEX_KEY))) _deleted.add(d);
  return _deleted.has(id);
}

/**
 * Merge one campaign with what is stored and write it; returns the merged whole. On the DM's screen the stored
 * whole is the public record joined with the secret one, and the result is split again: a secret that reached the
 * public record some other way (an old record, a player's save) moves to the secret one.
 */
async function _writeCampaign(id, base, localNow) {
  const remotePub = await readStrict(hubCampKey(id)); // throws when refused: the caller tries the save again later
  // Its record is gone: deleted on another screen (the index says so: not written back), or never written.
  if (base && !remotePub && await _isDeleted(id)) return null;
  if (!isCampaignDm(localNow, _me)) {
    const merged = mergeCampaign(base, withoutStubs(localNow), remotePub);
    await writeStrict(hubCampKey(id), merged);
    return merged;
  }
  let { sec: remoteSec, ok } = await readSecret(id, remotePub || localNow);
  // A failed read guards THIS write only. It used to mark the campaign unreadable for the rest of the session, so one
  // refused read (the node's per-minute limit) silently stopped every later save of the DM's secrets — traps, hidden
  // monsters, notes, scenes (rules playtest, 2026-10-04). A good read lifts it.
  if (!ok) _secretUnreadable.add(id); else _secretUnreadable.delete(id);
  const blind = _secretUnreadable.has(id);
  // Unreadable: treat the stored secrets as this screen's own, so the merge neither deletes nor writes them.
  if (blind) remoteSec = splitCampaign(localNow).sec;
  const remote = remotePub ? joinCampaign(remotePub, remoteSec) : null;
  const merged = mergeCampaign(base, localNow, remote);
  const { pub, sec } = splitCampaign(merged);
  await writeStrict(hubCampKey(id), pub);
  if (blind) console.warn('[dnd-hub-storage] the DM-only part of campaign %s could not be read; not writing it', id);
  // Written even when empty: a public record marked secretsKept with no secret record reads as a failed read.
  else if (!remoteSec || JSON.stringify(sec || {}) !== JSON.stringify(remoteSec)) await writeStrict(secretKey(id), sec || {}, 'user');
  return joinCampaign(pub, sec);
}
