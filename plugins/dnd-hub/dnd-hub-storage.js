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
import { storageGet, storageSet } from '../plugin-sdk.js';
import { mergeCampaign } from './dnd-campaign-merge.js';
import { splitCampaign, joinCampaign, isCampaignDm, secretKey, withoutStubs } from './lk-secrets.js';

export const HUB_LEGACY_KEY = 'hub-dm';
export const HUB_INDEX_KEY = 'hub-index';
export const hubCampKey = id => `hub-camp-${id}`;

// Serialized form of what we last persisted per campaign. A save writes only the
// campaigns that actually changed — call sites hand us the whole object on every
// pin drag / light tweak / token move, and rewriting all shards each time would
// burn the 60 writes/min plugin-data rate limit.
const _lastWritten = new Map();

// Campaign ids the index advertised at last successful read. `null` means we
// have not seen a valid index this session, which is NOT "there are none".
let _indexIds = null;

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
  const sec = await storageGet(secretKey(id), 'user');
  return { sec, ok: !!sec || !pub?.secretsKept };
}

/** Reassemble the DM blob from its shards, falling back to the legacy value. */
export async function loadHubDm() {
  const idx = await storageGet(HUB_INDEX_KEY);
  if (idx && Array.isArray(idx.campaignIds)) {
    _indexIds = [...idx.campaignIds];
    const campaigns = {};
    let moveOut = false;
    for (const id of idx.campaignIds) {
      const pub = await storageGet(hubCampKey(id));
      if (!pub) continue; // shard missing — skip rather than resurrect a stub
      const { sec, ok } = await readSecret(id, pub);
      if (!ok) _secretUnreadable.add(id); else _secretUnreadable.delete(id);
      const camp = isCampaignDm(pub, _me) ? joinCampaign(pub, sec) : pub;
      campaigns[id] = camp;
      // A DM's campaign whose public record still holds secrets (written before the split) is left unmarked, so the
      // next save moves them out; the load below starts that save.
      if (isCampaignDm(pub, _me) && (!pub.secretsKept || splitCampaign(pub).sec)) {
        _lastWritten.delete(id); moveOut = true;
      } else _lastWritten.set(id, JSON.stringify(camp));
    }
    const data = { ...(idx.rest ?? {}), campaigns };
    if (moveOut) queueMicrotask(() => saveHubDm(data).catch(e => console.warn('[dnd-hub-storage] moving DM secrets out failed', e)));
    return data;
  }

  const legacy = await storageGet(HUB_LEGACY_KEY);
  if (!legacy) return legacy;
  // First run after the split: force every campaign to be written out once by
  // leaving _lastWritten empty, so the next save materialises the shards.
  _lastWritten.clear();
  _indexIds = null;
  return legacy;
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
  if (_saving) {
    _again = { data, allowRemovals: !!(_again?.allowRemovals || opts.allowRemovals) };
    _againPromise ??= _saving.catch(() => {}).then(() => {
      const a = _again; _again = null; _againPromise = null;
      return saveHubDm(a.data, { allowRemovals: a.allowRemovals });
    });
    return _againPromise;
  }
  _saving = _saveOnce(data, opts).finally(() => { _saving = null; });
  return _saving;
}

async function _saveOnce(data, { allowRemovals = false } = {}) {
  const { campaigns = {}, ...rest } = data;
  const nextIds = Object.keys(campaigns);

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

  for (const [id, camp] of Object.entries(campaigns)) {
    const json = JSON.stringify(camp);
    if (_lastWritten.get(id) === json) continue;
    // Re-read and three-way merge, so edits made elsewhere since we loaded survive.
    // See dnd-campaign-merge.js for why this replaces a plain overwrite.
    const baseJson = _lastWritten.get(id);
    const localNow = JSON.parse(JSON.stringify(camp)); // what this save merges and writes
    const merged = await _writeCampaign(id, baseJson ? JSON.parse(baseJson) : undefined, localNow);
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
  }

  for (const id of [..._lastWritten.keys()]) {
    if (!(id in campaigns)) _lastWritten.delete(id);
  }

  // Index last: if a shard write fails, the index still points at the previous
  // consistent set rather than advertising a campaign that was never stored.
  await storageSet(HUB_INDEX_KEY, { campaignIds: nextIds, rest });
  _indexIds = [...nextIds];
}

/**
 * Merge one campaign with what is stored and write it; returns the merged whole. On the DM's screen the stored
 * whole is the public record joined with the secret one, and the result is split again: a secret that reached the
 * public record some other way (an old record, a player's save) moves to the secret one.
 */
async function _writeCampaign(id, base, localNow) {
  const remotePub = await storageGet(hubCampKey(id));
  if (!isCampaignDm(localNow, _me)) {
    const merged = mergeCampaign(base, withoutStubs(localNow), remotePub);
    await storageSet(hubCampKey(id), merged);
    return merged;
  }
  let { sec: remoteSec, ok } = await readSecret(id, remotePub || localNow);
  if (!ok) _secretUnreadable.add(id);
  const blind = _secretUnreadable.has(id);
  // Unreadable: treat the stored secrets as this screen's own, so the merge neither deletes nor writes them.
  if (blind) remoteSec = splitCampaign(localNow).sec;
  const remote = remotePub ? joinCampaign(remotePub, remoteSec) : null;
  const merged = mergeCampaign(base, localNow, remote);
  const { pub, sec } = splitCampaign(merged);
  await storageSet(hubCampKey(id), pub);
  if (blind) console.warn('[dnd-hub-storage] the DM-only part of campaign %s could not be read; not writing it', id);
  // Written even when empty: a public record marked secretsKept with no secret record reads as a failed read.
  else if (!remoteSec || JSON.stringify(sec || {}) !== JSON.stringify(remoteSec)) await storageSet(secretKey(id), sec || {}, 'user');
  return joinCampaign(pub, sec);
}
