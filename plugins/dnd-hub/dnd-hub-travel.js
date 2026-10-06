// dnd-hub-travel.js — travel pins in play: the DM's Hub loads the pin's scene for the whole table; a player's click
// asks the DM's Hub, which checks the pin's permission (dnd-hub-pin-travel.js) and loads it on their behalf.
// The rules are in dnd-hub-pin-travel.js; the pin dialogs in dnd-hub-pins.js.
import { MAP, serverData, userId } from './dnd-hub-state.js?v=20261014m';
import { storageGet } from '../plugin-sdk.js';
import { secretKey } from './lk-secrets.js';
import { publishTo } from './lk-bus.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { EV } from './dnd-hub-event-types.js?v=20261014m';
import { saveHubDm } from './dnd-hub-storage.js?v=20261014m';
import { canTravel, travelTooSoon } from './dnd-hub-pin-travel.js';

export const PIN_TRAVEL = 'pin:travel'; // a player → the DM's Hub: "take us through this pin"

// dnd-hub-events.js hands its handler over at start (it imports this module, so this one cannot import it).
let _applyScene = null;
export function setSceneApplier(fn) { _applyScene = fn; }

/**
 * The open campaign's scenes, read fresh from the DM's secret record: the DM sidebar makes and deletes scenes, and
 * this screen's copy is only as new as its last load. Falls back to that copy when the read fails.
 */
export async function campaignScenes() {
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (!camp || !MAP.isDM) return {};
  try {
    const sec = await storageGet(secretKey(MAP.campaignId), 'user');
    if (sec && typeof sec === 'object') camp.scenes = sec.scenes || {};
  } catch { /* keep this screen's copy */ }
  return camp.scenes || {};
}

let _lastTravelAt = 0;

/** DM only: load `sceneId` on every screen at the table, this one included. Resolves false when it could not. */
export async function travelToScene(sceneId) {
  if (!MAP.isDM || !sceneId) return false;
  const scene = (await campaignScenes())[sceneId];
  if (!scene) { travelNotice('That scene no longer exists.'); return false; }
  _lastTravelAt = Date.now();
  const camp = serverData.campaigns[MAP.campaignId];
  camp.lastSceneId = sceneId; // Start session offers it next time, as the sidebar's Load does
  saveHubDm(serverData).catch(() => {});
  const sent = await publishTo(['player'], EV.SCENE_LOAD, {
    campaignId: MAP.campaignId, sceneId, mapId: scene.mapId || null, shopId: scene.shopId || null,
    videoFileId: scene.videoFileId || null, soundtrackFileId: scene.soundtrackFileId || null,
    ambientVolume: scene.ambientVolume, fromUserId: userId,
  });
  // The same id as the copy the node echoes back, so that copy is dropped as a repeat.
  await _applyScene?.(sent);
  return true;
}

/** On the DM's Hub: a player asked to travel through a pin. `p.fromUserId` is the node's sender id by now. */
export async function handleTravelRequest(p) {
  if (!MAP.isDM || p.campaignId !== MAP.campaignId || p.mapId !== MAP.mapId) return;
  const pin = (MAP.mapData?.pins || []).find(x => x.id === p.pinId);
  const dmUserId = serverData?.campaigns?.[MAP.campaignId]?.dmUserId;
  if (!canTravel(pin, p.fromUserId, dmUserId) || travelTooSoon(_lastTravelAt)) return;
  await travelToScene(pin.sceneId);
}

// ── A player's side ────────────────────────────────────────────────────────────────────────────────────────────
let _waiting = null;

/** A player asks the DM's Hub to travel. Resolves true when a scene arrives, false when nobody answered. */
export function requestTravel(pin) {
  realtimePublish(PIN_TRAVEL, { type: PIN_TRAVEL, campaignId: MAP.campaignId, mapId: MAP.mapId, pinId: pin.id, fromUserId: userId });
  if (_waiting) _waiting.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => { _waiting = null; resolve(false); }, 8000);
    _waiting = { resolve: ok => { clearTimeout(timer); _waiting = null; resolve(ok); } };
  });
}

/** Called for every scene that loads on this screen: ends a player's wait. */
export function noteSceneLoaded() { _waiting?.resolve(true); }

export function travelNotice(text) {
  document.getElementById('lk-travel-notice')?.remove();
  const el = document.createElement('div');
  el.id = 'lk-travel-notice';
  el.className = 'lk-travel-notice';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
