// dnd-hub-shared-storage.js — companion-side access to dnd-hub's sharded campaign data.
//
// dnd-hub used to keep every campaign in one 'hub-dm' value. That hit the 64 KB
// per-key plugin-data cap, so dnd-hub now stores one 'hub-camp-<id>' key per
// campaign plus a small 'hub-index' (see dnd-hub/dnd-hub-storage.js).
//
// dnd-player and dnd-master read AND write that same data through companion
// storage, so they must use the identical layout — otherwise they read a frozen
// 'hub-dm' and write blobs dnd-hub never reads back.
//
// The legacy 'hub-dm' key is still read as a fallback and is never written here.
import { storageGetCompanion, storageSetCompanion } from './plugin-sdk.js';

const HUB = 'dnd-hub';

// Serialized form of what we last saw per campaign, so a save only rewrites what
// actually changed — companion writes go through the same 60/min plugin-data
// rate limit as everything else.
const _lastSeen = new Map();

// The campaign ids hub-index advertised the last time we successfully read it.
// `null` means we have not seen a valid index this session — which is NOT the
// same as "there are no campaigns", and the save guard below treats it that way.
let _indexIds = null;

/** Reassemble dnd-hub's campaign blob from its shards. */
export async function loadHubDmCompanion() {
  const idx = await storageGetCompanion(HUB, 'hub-index', 'server');
  if (idx && Array.isArray(idx.campaignIds)) {
    _indexIds = [...idx.campaignIds];
    const campaigns = {};
    for (const id of idx.campaignIds) {
      const camp = await storageGetCompanion(HUB, `hub-camp-${id}`, 'server');
      if (!camp) continue;
      campaigns[id] = camp;
      _lastSeen.set(id, JSON.stringify(camp));
    }
    return { ...(idx.rest ?? {}), campaigns };
  }
  // Pre-split fallback: dnd-hub has not written shards yet on this server.
  _lastSeen.clear();
  _indexIds = null;
  return (await storageGetCompanion(HUB, 'hub-dm', 'server')) || { campaigns: {} };
}

/**
 * Write the campaign blob back in dnd-hub's sharded layout.
 *
 * ⚠️ This never removes a campaign from hub-index, by design.
 *
 * Every read here goes through the SDK's storageGetCompanion, which swallows
 * errors and returns null — so a FAILED read is indistinguishable from "no
 * data". loadHubDmCompanion turns that into `{ campaigns: {} }`, a truthy value
 * with nothing in it, and a caller that loads-then-saves would write
 * `campaignIds: []` straight over a healthy index. The hub-camp-* shards would
 * survive but nothing would point at them, so every campaign on the server
 * disappears for every user at once — from a read failure in one sidebar.
 * The same happens if the index reads fine but the shard reads fail, since the
 * loader skips a missing shard.
 *
 * Deleting a campaign is dnd-hub's job (deleteCampaign → saveHubDm), never a
 * companion's, so the asymmetry costs nothing: keeping a stale id is harmless
 * because the loader skips a shard that is gone, while dropping a live one is
 * unrecoverable.
 */
export async function saveHubDmCompanion(data) {
  if (!data) return;
  const { campaigns = {}, ...rest } = data;
  const nextIds = Object.keys(campaigns);

  let knownIds = _indexIds;
  if (knownIds === null) {
    // Never saw an index this session — re-read before writing rather than
    // assuming the absence was real. This costs one extra read on a path that
    // only runs when a load already came back empty.
    const current = await storageGetCompanion(HUB, 'hub-index', 'server');
    knownIds = Array.isArray(current?.campaignIds) ? current.campaignIds : [];
  }
  const dropped = knownIds.filter(id => !nextIds.includes(id));
  if (dropped.length) {
    console.warn('[dnd-hub-shared-storage] refusing to drop %d campaign(s) from hub-index — ' +
      'a companion cannot delete campaigns, so this is a failed read, not a deletion:', dropped.length, dropped);
    nextIds.push(...dropped);
  }

  for (const [id, camp] of Object.entries(campaigns)) {
    const json = JSON.stringify(camp);
    if (_lastSeen.get(id) === json) continue;
    await storageSetCompanion(HUB, `hub-camp-${id}`, 'server', camp);
    _lastSeen.set(id, json);
  }
  for (const id of [..._lastSeen.keys()]) {
    if (!(id in campaigns)) _lastSeen.delete(id);
  }
  await storageSetCompanion(HUB, 'hub-index', 'server', { campaignIds: nextIds, rest });
  _indexIds = [...nextIds];
}
