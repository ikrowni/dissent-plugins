// dnd-hub-tavern.js — taverns and the NPCs who run games, on this screen.
//
// A game is run by an NPC whose token stands on the map (type 'npc', `npcActorId`). A hero right-clicks it to talk
// (dnd-hub-tokens.js → talkToNpc), sits down to play (dnd-hub-tavern-seat.js), and the DM's Hub is the house wherever
// the NPC stands (dnd-hub-tavern-ref.js). A TAVERN is the DM's NPCs on a map of their choosing with a sound: the DM's
// sidebar has already put the NPCs on the map (dnd-master-taverns.js); `tavern:open` switches every screen to that
// map and plays the sound. The drawn tavern scene and the row of hosts are gone (owner, 2026-10-07).
import { MAP, userId } from './dnd-hub-state.js?v=20261015m';
import { localPublish } from '../plugin-sdk.js';
import { fileUrl } from './dnd-hub-file-url.js?v=20261015m';
import { cleanTavern, gameType } from './lk-tavern.js';
import { publishTo } from './lk-bus.js';
import { stopShopScene } from './dnd-hub-shop-scene.js';
import { playWhenAllowed } from './dnd-hub-ambience.js';
import { moveToast } from './dnd-hub-turn-move.js';
import { renderTokens } from './dnd-hub-tokens.js?v=20261015m';
import { openTalk, closeTalk, setHero } from './dnd-hub-tavern-talk.js?v=20261015m';
import { onSeatEvent, leaveTable, seatedAt } from './dnd-hub-tavern-seat.js?v=20261015m';
import { refereeEvent, refereeOpen, refereeClose } from './dnd-hub-tavern-ref.js?v=20261015m';
import { setNpcTalk, talkFor, setupOf, actorOf, heroInReach } from './dnd-hub-tavern-npcs.js?v=20261015m';

/** open: the loaded tavern { id, mapId } or null. busy: who is playing with which NPC, { actorId: [names] }. */
export const TAVERN = { open: null, busy: {} };

export const setupFor = setupOf;
export const actorFor = actorOf;
export const isTavernDM = () => MAP.isDM;

let _loadMap = null; // dnd-hub-events.js hands this in: switch this screen to a map the way `map:set` does
export function setTavernMapLoader(fn) { _loadMap = fn; }

/** Every `tavern:*` event comes here (dnd-hub-events.js); open/close/volume/npcs/busy are DM-only there. */
export async function handleTavernEvent(p) {
  if (p.campaignId && p.campaignId !== MAP.campaignId) return;
  switch (p.type) {
    case 'tavern:open': return openHere(p);
    case 'tavern:close': return closeTavernHere();
    case 'tavern:volume':
      if (TAVERN.open?.id === p.tavernId && MAP._tavernAudio) MAP._tavernAudio.volume = Math.min(1, Math.max(0, p.volume ?? 0.5));
      return;
    case 'tavern:npcs': return setNpcTalk(p);       // the DM changed an NPC or a game
    case 'tavern:hero': return setHero(p);           // my sheet answered: my purse and my numbers
    case 'tavern:busy': return setBusy(p.busy || {}, p.users || {}); // the DM's Hub says who is playing with whom
  }
  if (MAP.isDM) await refereeEvent(p);
  await onSeatEvent(p);
}

async function openHere(p) {
  if (!p.tavern) return;
  const t = cleanTavern(p.tavern);
  closeTavernHere();
  setNpcTalk(p);
  TAVERN.open = { id: t.id, mapId: t.mapId };
  // a shop or a soundtrack gives way
  if (MAP._activeShopId) { document.getElementById('lk-shop-exit')?.remove(); stopShopScene(); MAP._activeShopId = null; }
  for (const k of ['_shopAudio', '_soundtrackAudio']) if (MAP[k]) { MAP[k].pause(); MAP[k].src = ''; MAP[k] = null; }
  if (t.mapId && t.mapId !== MAP.mapId) await _loadMap?.(t.mapId);
  if (TAVERN.open?.id !== t.id) return; // closed meanwhile
  // The NPCs the sidebar just stood here travel with the event: a storage read refused under HTTP 429 lost them.
  const fresh = (Array.isArray(p.npcTokens) ? p.npcTokens : []).filter(k => k?.id && MAP.mapData?.tokens && !MAP.mapData.tokens[k.id]);
  if (fresh.length) { for (const k of fresh) MAP.mapData.tokens[k.id] = k; renderTokens(); }
  if (t.soundFileId) fileUrl(t.soundFileId).then(res => {
    if (!res?.url || TAVERN.open?.id !== t.id) return;
    const aud = new Audio(res.url);
    aud.loop = true; aud.crossOrigin = 'anonymous'; aud.volume = t.ambientVolume; aud.preload = 'auto';
    playWhenAllowed(() => aud.play());
    MAP._tavernAudio = aud;
  });
  if (MAP.isDM) { refereeOpen(); showClose(); }
  else localPublish('dnd-player', 'tavern:hero?', { type: 'tavern:hero?', campaignId: MAP.campaignId });
}

/** The tavern ends on this screen (the DM's close, a scene, a shop, or another map): its sound stops, games end. */
export function closeTavernHere() {
  if (!TAVERN.open) return;
  leaveTable();
  closeTalk();
  if (MAP.isDM) refereeClose();
  TAVERN.open = null;
  document.getElementById('lk-tavern-exit')?.remove();
  if (MAP._tavernAudio) { MAP._tavernAudio.pause(); MAP._tavernAudio.src = ''; MAP._tavernAudio = null; }
}

/** A hero right-clicked an NPC's token (dnd-hub-tokens.js). The DM may talk from anywhere, to see what players see. */
export function talkToNpc(token) {
  const host = talkFor(token?.npcActorId);
  if (!host) return;
  if (!MAP.isDM && !heroInReach(userId, host.actorId)) { moveToast('Walk closer to talk.'); return; }
  if (!MAP.isDM) localPublish('dnd-player', 'tavern:hero?', { type: 'tavern:hero?', campaignId: MAP.campaignId });
  return openTalk(host, setupOf(host));
}

/** The round portrait of a host: their picture, or their initial. */
export async function medal(host) {
  const url = host.portraitFileId ? (await fileUrl(host.portraitFileId))?.url || null : null;
  const el = document.createElement('div');
  el.className = 'tv-medal';
  if (url) { const img = new Image(); img.src = url; img.alt = ''; el.appendChild(img); }
  else el.textContent = (host.name || '?').trim()[0]?.toUpperCase() || '?';
  return el;
}

/** Who is playing with whom. A whole-table game that just started calls every other hero over to join. */
export function setBusy(busy, users = {}) {
  const before = TAVERN.busy;
  TAVERN.busy = busy;
  if (MAP.isDM) return;
  for (const [actorId, names] of Object.entries(busy)) {
    if (!names?.length || before[actorId]?.length) continue;
    const host = talkFor(actorId), g = gameType(setupOf(host)?.type);
    if (!host || g?.mode !== 'table' || seatedAt() || users[actorId]?.includes(userId)) continue;
    joinCall(`${host.name} is starting ${g.name} — right-click them to join`);
  }
}

function joinCall(text) {
  document.getElementById('lk-tavern-call')?.remove();
  const el = document.createElement('div');
  el.id = 'lk-tavern-call';
  el.setAttribute('role', 'status');
  el.textContent = `🎲 ${text}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 30000);
}

function showClose() {
  const wrap = document.getElementById('map-canvas-wrap');
  if (!wrap) return;
  document.getElementById('lk-tavern-exit')?.remove();
  const b = document.createElement('button');
  b.id = 'lk-tavern-exit';
  b.className = 'map-tool-btn';
  b.style.cssText = 'position:absolute;top:12px;left:12px;z-index:60';
  b.textContent = '✕ Close tavern';
  b.title = 'Stops the tavern\'s sound and ends any game in progress. The NPCs stay on the map.';
  b.onclick = async () => {
    await publishTo([], 'tavern:close', { type: 'tavern:close', campaignId: MAP.campaignId, fromUserId: userId });
    closeTavernHere();
  };
  wrap.appendChild(b);
}
