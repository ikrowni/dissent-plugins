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

/** Reassemble the DM blob from its shards, falling back to the legacy value. */
export async function loadHubDm() {
  const idx = await storageGet(HUB_INDEX_KEY);
  if (idx && Array.isArray(idx.campaignIds)) {
    _indexIds = [...idx.campaignIds];
    const campaigns = {};
    for (const id of idx.campaignIds) {
      const camp = await storageGet(hubCampKey(id));
      if (!camp) continue; // shard missing — skip rather than resurrect a stub
      campaigns[id] = camp;
      _lastWritten.set(id, JSON.stringify(camp));
    }
    return { ...(idx.rest ?? {}), campaigns };
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
export async function saveHubDm(data, { allowRemovals = false } = {}) {
  if (!data) return;
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
    await storageSet(hubCampKey(id), camp);
    _lastWritten.set(id, json);
  }

  for (const id of [..._lastWritten.keys()]) {
    if (!(id in campaigns)) _lastWritten.delete(id);
  }

  // Index last: if a shard write fails, the index still points at the previous
  // consistent set rather than advertising a campaign that was never stored.
  await storageSet(HUB_INDEX_KEY, { campaignIds: nextIds, rest });
  _indexIds = [...nextIds];
}
