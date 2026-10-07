// dnd-hub-undo-apply.js — how an undo puts each part of the map back on every screen: the same save and the same
// event its own tool sends (dnd-hub-undo.js decides what to put back).
import { MAP, serverData, userId, hubFogKey } from './dnd-hub-state.js?v=20261015b';
import { storageSet } from '../plugin-sdk.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { EV } from './dnd-hub-event-types.js?v=20261015b';
import { saveHubDm } from './dnd-hub-storage.js?v=20261015b';
import { CLIENT_ID } from './dnd-hub-client-id.js';
import { renderWalls } from './dnd-hub-walls.js?v=20261015b';
import { renderLights, saveLightsAndBroadcast } from './dnd-hub-lights.js?v=20261015b';
import { renderPins, savePinsAndBroadcast } from './dnd-hub-pins.js?v=20261015b';
import { saveZonesAndBroadcast } from './dnd-hub-audio-zones.js?v=20261015b';
import { saveTriggersAndBroadcast } from './dnd-hub-triggers.js?v=20261015b';
import { renderFog } from './dnd-hub-fog.js?v=20261015b';
import { savePicturesAndBroadcast } from './dnd-hub-pictures.js';
import { fogCells } from './dnd-hub-undo.js';

async function saveMap() {
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (camp) { camp.maps[MAP.mapId] = MAP.mapData; await saveHubDm(serverData); }
}

export const UNDO_APPLIERS = {
  async walls() {
    await saveMap(); renderWalls(); renderFog();
    await realtimePublish(EV.WALLS_UPDATE, { clientId: CLIENT_ID, type: EV.WALLS_UPDATE, campaignId: MAP.campaignId, walls: MAP.mapData.walls || [], fromUserId: userId });
  },
  async doors() {
    await saveMap(); renderWalls(); renderFog();
    await realtimePublish(EV.DOOR_STATE, { clientId: CLIENT_ID, type: EV.DOOR_STATE, campaignId: MAP.campaignId, doors: MAP.mapData.doors || {}, fromUserId: userId });
  },
  async lights() { await saveLightsAndBroadcast(); renderLights(); renderFog(); },
  async pins() { await savePinsAndBroadcast(); },
  async audioZones() { await saveZonesAndBroadcast(); },
  async triggers() { await saveTriggersAndBroadcast(); },
  async pictures() { await savePicturesAndBroadcast(); },
  // Every square the undo changes is sent; a square the old fog did not have goes back to unexplored.
  async fogState(previous) {
    const target = MAP.mapData.fogState || {};
    await storageSet(hubFogKey(MAP.campaignId, MAP.mapId), target);
    renderFog(); renderPins();
    await realtimePublish(EV.FOG_REVEAL, { type: EV.FOG_REVEAL, campaignId: MAP.campaignId, mapId: MAP.mapId,
      cells: fogCells(target, previous), fromUserId: userId });
  },
};
