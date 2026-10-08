// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/dnd-hub-shared-storage.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../dnd-hub-shared-storage.js' directly would make the plugin unmirrorable.

// dnd-hub-shared-storage.js — companion-side access to dnd-hub's sharded campaign data.
//
// ⚠️ NOT IMPORTED DIRECTLY. This is the SOURCE; dnd-master and dnd-player each import a
// generated copy in their own directory, because a mirror may only serve files from under
// a plugin's own directory. Edit here, then run `node scripts/vendor-shared.mjs` — the
// layout below must stay identical across all three or they read and write past each other.
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
import { storageGetCompanion, storageSetCompanion, request } from '../plugin-sdk.js';
import { mergeCampaign } from './dnd-campaign-merge.js';
import { splitCampaign, joinCampaign, isCampaignDm, secretKey, withoutStubs } from './lk-secrets.js';
import { needsCampaign, summariesForIndex, idsForIndex, summariesChanged, deletedIdsOf, deletedForIndex } from './lk-campaign-index.js';

const HUB = 'dnd-hub';

// Serialized form of what we last saw per campaign, so a save only rewrites what
// actually changed — companion writes go through the same 60/min plugin-data
// rate limit as everything else.
const _lastSeen = new Map();

// The campaign ids hub-index advertised the last time we successfully read it.
// `null` means we have not seen a valid index this session — which is NOT the
// same as "there are no campaigns", and the save guard below treats it that way.
let _indexIds = null;
/** The campaign ids from the last hub-index read, or null (not read, or a pre-split server). */
export const cachedIndexIds = () => (_indexIds ? [..._indexIds] : null);

// 🔴 A sidebar reads only the campaigns its user runs or plays in (lk-campaign-index.js; same rules as
// dnd-hub/dnd-hub-storage.js). `_skipped` = listed but unread; saves keep them in the index.
const _skipped = new Set();
const _deleted = new Set(); // campaigns the index says were deleted (lk-campaign-index.js): never read, never written back
let _summaries = {};
let _indexRest = null;

/** Reassemble dnd-hub's campaign blob from its shards. */
// 🔴 DM secrets: the same two-record layout as dnd-hub/dnd-hub-storage.js (read that header). Only the campaign's
// DM joins, splits or writes `dm-camp-<id>` (dnd-hub's USER scope); a player's save never strips.
let _me = null;
/** Who this screen is signed in as; set before the first load. Unset = never treated as the DM. */
export function setSecretsUser(id) { _me = id || null; }
const _secretUnreadable = new Set();

// 🔴 A save reads and writes with these, never storageGetCompanion/storageSetCompanion: those return null for a
// REFUSED read (HTTP 429) as for an empty one, and swallow a refused write. A save that took a refused read for
// "nothing stored" wrote its own older copy over everyone's newer edits (a player's sheet put a shop's restock and the
// DM's log back; rules playtest 2026-10-08), and a refused write was recorded as written, so it was never sent again.
const pause = ms => new Promise(r => setTimeout(r, ms));
async function readStrict(key, scope = 'server', tries = 3) {
  for (let i = 0; ; i++) {
    try { const r = await request('storage:get-companion', { registryId: HUB, key, scope }); return r?.value ?? null; }
    catch (e) { if (i >= tries - 1) throw e; await pause(1500 * (i + 1)); }
  }
}
const writeStrict = (key, scope, value) => request('storage:set-companion', { registryId: HUB, key, scope, value });

async function readSecret(id, pub) {
  if (!isCampaignDm(pub, _me)) return { sec: null, ok: true };
  let sec;
  try { sec = await readStrict(secretKey(id), 'user'); } catch { return { sec: null, ok: false }; } // refused: unknown
  return { sec, ok: !!sec || !pub?.secretsKept };
}

const _joined = new Set();       // campaign ids this sidebar keeps joined (its open campaign)
const _joinedObjs = new WeakSet(); // the campaign objects that already hold their secret part
/** Join the DM's secret record into campaign `id` of `data`, in place; it stays joined across reloads. */
export async function joinSecrets(data, id) {
  const camp = data?.campaigns?.[id];
  if (!camp || !isCampaignDm(camp, _me) || _joinedObjs.has(camp)) return camp;
  const { sec, ok } = await readSecret(id, camp);
  if (!ok) _secretUnreadable.add(id); else _secretUnreadable.delete(id);
  const joined = joinCampaign(camp, sec);
  for (const k of Object.keys(camp)) if (!(k in joined)) delete camp[k];
  Object.assign(camp, joined);
  _joined.add(id); _joinedObjs.add(camp);
  _lastSeen.set(id, JSON.stringify(camp));
  return camp;
}

export async function loadHubDmCompanion() {
  const idx = await storageGetCompanion(HUB, 'hub-index', 'server');
  if (idx && Array.isArray(idx.campaignIds)) {
    _indexIds = [...idx.campaignIds];
    _summaries = idx.summaries && typeof idx.summaries === 'object' ? idx.summaries : {};
    _indexRest = JSON.stringify(idx.rest ?? {});
    _skipped.clear();
    for (const id of deletedIdsOf(idx)) _deleted.add(id);
    const campaigns = {};
    for (const id of idx.campaignIds) {
      if (_deleted.has(id)) continue;
      if (!needsCampaign(_summaries, id, _me)) { _skipped.add(id); _lastSeen.delete(id); continue; }
      const pub = await storageGetCompanion(HUB, `hub-camp-${id}`, 'server');
      if (!pub) continue;
      // The secret record only for the campaign this sidebar runs (joinSecrets): reading every DM campaign's doubled
      // the load and passed the node's read limit (see dnd-hub-storage.js).
      let camp = pub;
      if (_joined.has(id) && isCampaignDm(pub, _me)) {
        const { sec, ok } = await readSecret(id, pub);
        if (!ok) _secretUnreadable.add(id); else _secretUnreadable.delete(id);
        camp = joinCampaign(pub, sec);
        _joinedObjs.add(camp);
      }
      campaigns[id] = camp;
      _lastSeen.set(id, JSON.stringify(camp));
    }
    return { ...(idx.rest ?? {}), campaigns };
  }
  // Pre-split fallback: dnd-hub has not written shards yet on this server.
  _skipped.clear(); _summaries = {}; _indexRest = null;
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
// Saves run one at a time: two at once (a DM clicking twice while the first save was slow, under HTTP 429) each
// merged with what was stored and wrote back, and one of the two edits was lost (tavern playtest, 2026-10-05).
let _saveChain = Promise.resolve();
export function saveHubDmCompanion(data) {
  const run = _saveChain.then(() => saveNow(data));
  _saveChain = run.catch(() => {});
  return run;
}

// A save storage refused is tried again with the newest data (nothing was recorded as written, so it still differs).
let _retryTimer = 0, _retryData = null;
function retryLater(data) {
  _retryData = data;
  if (_retryTimer) return;
  _retryTimer = setTimeout(() => { _retryTimer = 0; const d = _retryData; _retryData = null; saveHubDmCompanion(d).catch(() => {}); }, 5000);
}

async function saveNow(data) {
  if (!data) return;
  const { campaigns = {}, ...rest } = data;
  // Campaigns this sidebar left unread are kept (lk-campaign-index.js).
  const nextIds = [...Object.keys(campaigns), ...[..._skipped].filter(id => !(id in campaigns))];

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

  const written = {}; // merged with what is stored by this save: the only campaigns whose summary is current
  for (const [id, camp] of Object.entries(campaigns)) {
    const json = JSON.stringify(camp);
    if (_lastSeen.get(id) === json) continue;
    // Re-read and three-way merge (dnd-campaign-merge.js), so a sidebar save keeps what
    // the Hub or another player changed since this sidebar loaded.
    const baseJson = _lastSeen.get(id);
    let merged;
    try { merged = await writeCampaign(id, baseJson ? JSON.parse(baseJson) : undefined, JSON.parse(json)); }
    catch (e) { console.warn('[dnd-hub-shared-storage] campaign %s not saved (storage refused); trying again', id, e?.message); retryLater(data); continue; }
    if (!merged) continue; // deleted on the Hub: not written back
    _lastSeen.set(id, JSON.stringify(merged));
    // What the screen changed WHILE this save was out is kept: merged over the stored result, not overwritten by it
    // (it was: a host added during a slow save vanished). Left unsaved here; the next save writes it.
    const now = JSON.stringify(camp);
    const result = now === json ? merged : mergeCampaign(JSON.parse(json), JSON.parse(now), merged);
    for (const k of Object.keys(camp)) if (!(k in result)) delete camp[k];
    Object.assign(camp, result);
    written[id] = merged;
  }
  for (const id of [..._lastSeen.keys()]) {
    if (!(id in campaigns)) _lastSeen.delete(id);
  }
  // Written only when it changes, from a FRESH read (dnd-hub-storage.js explains both). A companion never removes.
  const restJson = JSON.stringify(rest);
  const idsSame = _indexIds && _indexIds.length === nextIds.length && nextIds.every(id => _indexIds.includes(id));
  if (idsSame && restJson === _indexRest && !summariesChanged(written, _summaries)) return;
  const fresh = await storageGetCompanion(HUB, 'hub-index', 'server');
  const freshOk = !!fresh && Array.isArray(fresh.campaignIds);
  if (freshOk) for (const id of deletedIdsOf(fresh)) _deleted.add(id);
  const deletedIds = deletedForIndex([..._deleted], []);
  const ids = idsForIndex(nextIds, freshOk ? fresh.campaignIds : [], [], deletedIds);
  const summaries = summariesForIndex(ids, written, freshOk ? (fresh.summaries || {}) : null);
  await storageSetCompanion(HUB, 'hub-index', 'server', { campaignIds: ids, rest, summaries, deletedIds });
  _indexIds = [...ids];
  _summaries = summaries;
  _indexRest = restJson;
  for (const id of ids) if (!(id in campaigns)) _skipped.add(id);
}

/** Whether campaign `id` was deleted, asking the index when this sidebar does not know yet (one read, rare). */
async function isDeleted(id) {
  if (!_deleted.has(id)) for (const d of deletedIdsOf(await storageGetCompanion(HUB, 'hub-index', 'server'))) _deleted.add(d);
  return _deleted.has(id);
}

/** Merge one campaign with what is stored and write it (the DM's screen: both records); returns the merged whole. */
async function writeCampaign(id, base, local) {
  const remotePub = await readStrict(`hub-camp-${id}`); // throws when refused: the caller tries the save again later
  // Gone: deleted on the Hub (the index says so: not written back), or never written.
  if (base && !remotePub && await isDeleted(id)) return null;
  if (!isCampaignDm(local, _me)) {
    const merged = mergeCampaign(base, withoutStubs(local), remotePub);
    await writeStrict(`hub-camp-${id}`, 'server', merged);
    return merged;
  }
  let { sec: remoteSec, ok } = await readSecret(id, remotePub || local);
  // A failed read guards THIS write only; a good read lifts it (it used to stop the DM's secrets saving all session).
  if (!ok) _secretUnreadable.add(id); else _secretUnreadable.delete(id);
  const blind = _secretUnreadable.has(id);
  if (blind) remoteSec = splitCampaign(local).sec;
  const remote = remotePub ? joinCampaign(remotePub, remoteSec) : null;
  const merged = mergeCampaign(base, local, remote);
  const { pub, sec } = splitCampaign(merged);
  await writeStrict(`hub-camp-${id}`, 'server', pub);
  if (blind) console.warn('[dnd-hub-shared-storage] the DM-only part of campaign %s could not be read; not writing it', id);
  // Written even when empty: a public record marked secretsKept with no secret record reads as a failed read.
  else if (!remoteSec || JSON.stringify(sec || {}) !== JSON.stringify(remoteSec)) {
    await writeStrict(secretKey(id), 'user', sec || {});
  }
  return joinCampaign(pub, sec);
}
