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

/** Reassemble dnd-hub's campaign blob from its shards. */
export async function loadHubDmCompanion() {
  const idx = await storageGetCompanion(HUB, 'hub-index', 'server');
  if (idx && Array.isArray(idx.campaignIds)) {
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
  return (await storageGetCompanion(HUB, 'hub-dm', 'server')) || { campaigns: {} };
}

/** Write the campaign blob back in dnd-hub's sharded layout. */
export async function saveHubDmCompanion(data) {
  if (!data) return;
  const { campaigns = {}, ...rest } = data;

  for (const [id, camp] of Object.entries(campaigns)) {
    const json = JSON.stringify(camp);
    if (_lastSeen.get(id) === json) continue;
    await storageSetCompanion(HUB, `hub-camp-${id}`, 'server', camp);
    _lastSeen.set(id, json);
  }
  for (const id of [..._lastSeen.keys()]) {
    if (!(id in campaigns)) _lastSeen.delete(id);
  }
  await storageSetCompanion(HUB, 'hub-index', 'server', {
    campaignIds: Object.keys(campaigns), rest,
  });
}
