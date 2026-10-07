// dnd-master-actor-talk.js — the NPCs who talk and run games, from the DM's side: telling every Hub who they are,
// changing an NPC's game, and standing NPCs' tokens on a map.
//
// Hubs keep a copy of the campaign that can be older than this sidebar's edits, so every change to an NPC or a game
// setup is sent as `tavern:npcs` (dnd-hub-tavern-npcs.js). Placing puts the new tokens on, saves, and only then tells
// the Hubs.
import { localPublish, realtimePublishCompanion } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { publicPayload } from './lk-secrets.js';
import { EV } from './dnd-hub-event-types.js?v=20261014y';
import { talkingNpcs, npcToken, npcTokenId, npcSpots } from './lk-tavern.js';

let _state = null;
export function setActorTalkState(s) { _state = s; }

/** Every talking NPC and the setups they run, as the Hubs need them. */
export const npcTalkPayload = () => talkingNpcs(_state?.dmCampaign);

/** Tell every Hub (mine too) who talks and what they play. */
export async function publishNpcTalk() {
  if (!_state?.dmCampaignId) return;
  const payload = { type: 'tavern:npcs', ...npcTalkPayload(), campaignId: _state.dmCampaignId, fromUserId: _state.userId };
  localPublish('dnd-hub', 'tavern:npcs', payload);
  await realtimePublishCompanion('dnd-hub', 'tavern:npcs', payload).catch(() => {});
}

/** Save the campaign's NPCs (they live in the campaign only, not the dm-catalog backup) and tell the Hubs. */
export async function saveActors() {
  _state.serverData.campaigns[_state.dmCampaignId].customActors = _state.dmCampaign.customActors;
  await saveHubDmCompanion(_state.serverData);
  await publishNpcTalk();
}

/** Give an NPC a game ('' = just talks). */
export async function setNpcGame(actorId, setupId) {
  const a = _state.dmCampaign.customActors?.[actorId];
  if (!a) return;
  a.setupId = setupId || '';
  await saveActors();
}

/**
 * Stand these NPCs on map `mapId` (default: the active map), which becomes the active map. NPCs already on it stay
 * where they are; the rest take free squares near the middle. Returns the new tokens (also sent with `tavern:open`,
 * so a Hub has them even if its storage read is refused), or false when there is no such map.
 *
 * Works on this sidebar's own copy: the save is a three-way merge (dnd-hub-shared-storage.js), so what the Hub
 * changed on the map since (tokens moved) is kept. A fresh read here used to be refused under HTTP 429 and the
 * tavern did not load (playtest, 2026-10-07); it also reset the merge's base under the sidebar's other edits.
 */
export async function placeNpcs(actorIds, mapId = null) {
  const c = _state.dmCampaign, cid = _state.dmCampaignId;
  const id = mapId || c?.activeMapId;
  const map = c?.maps?.[id];
  if (!map) return false;
  map.tokens ||= {};
  const todo = actorIds.map(a => c.customActors?.[a]).filter(a => a && !map.tokens[npcTokenId(a.id)]);
  const spots = npcSpots(map, todo.length);
  const tokens = todo.map((a, i) => (map.tokens[npcTokenId(a.id)] = npcToken(a, spots[i])));
  const switching = c.activeMapId !== id;
  c.activeMapId = id;
  await saveHubDmCompanion(_state.serverData).catch(e => console.warn('[dnd-master] placing NPCs', e));
  // On a map the Hubs already show, the new tokens arrive as a spawn. On another map they would land on the wrong
  // one: a tavern sends them with `tavern:open`, applied after the switch (dnd-hub-tavern.js).
  if (tokens.length && !switching) {
    const payload = { type: EV.TOKENS_SPAWN, campaignId: cid, mapId: id, tokens, fromUserId: _state.userId };
    localPublish('dnd-hub', EV.TOKENS_SPAWN, payload);
    await realtimePublishCompanion('dnd-hub', EV.TOKENS_SPAWN, publicPayload(EV.TOKENS_SPAWN, payload));
  }
  return tokens;
}
