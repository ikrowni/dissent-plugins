// dnd-hub-tavern.js — a tavern on this screen: the scene, its sound, the hosts at their tables, and the events.
//
// The DM opens a tavern from the Taverns tab (`tavern:open`, DM only); every Hub draws it over the map the way a
// shop is drawn, and puts each table's HOST along the bottom. A hero clicks a host to talk (dnd-hub-tavern-talk.js),
// sits down to play (dnd-hub-tavern-seat.js), and the DM's Hub referees every seat and pays out
// (dnd-hub-tavern-ref.js). The tavern and its game setups are read from the campaign, never from the event.
import { MAP, serverData, userId, setServerData } from './dnd-hub-state.js?v=20261014b';
import { request, localPublish } from '../plugin-sdk.js';
import { cleanTavern, cleanSetup, gameType } from './lk-tavern.js';
import { publishTo } from './lk-bus.js';
import { loadHubDm } from './dnd-hub-storage.js?v=20261014b';
import { startTavernScene, startTavernMedia, stopTavernScene } from './dnd-hub-tavern-scene.js?v=20261014b';
import { stopShopScene } from './dnd-hub-shop-scene.js';
import { clearTokenCache, renderTokens } from './dnd-hub-tokens.js?v=20261014b';
import { renderWalls } from './dnd-hub-walls.js?v=20261014b';
import { renderFog } from './dnd-hub-fog.js?v=20261014b';
import { playWhenAllowed } from './dnd-hub-ambience.js';
import { openTalk, closeTalk, setHero } from './dnd-hub-tavern-talk.js?v=20261014b';
import { onSeatEvent, leaveTable } from './dnd-hub-tavern-seat.js?v=20261014b';
import { refereeEvent, refereeOpen, refereeClose } from './dnd-hub-tavern-ref.js?v=20261014b';

/** The open tavern on this screen: { id, campaignId, busy: { hostId: [names] } }, or null. */
export const TAVERN = { open: null, portraits: {} };

const campaign = () => serverData?.campaigns?.[MAP.campaignId];
export const openTavernData = () => {
  const t = campaign()?.taverns?.[TAVERN.open?.id];
  return t ? cleanTavern(t) : null;
};
export const setupFor = host => {
  const s = campaign()?.gameSetups?.[host?.setupId];
  return s ? cleanSetup(s) : null;
};
export const actorFor = host => (host?.actorId ? campaign()?.customActors?.[host.actorId] || null : null);
export const isTavernDM = () => MAP.isDM;

/** Every `tavern:*` event comes here (dnd-hub-events.js); the open/close/volume ones are DM-only there. */
export async function handleTavernEvent(p) {
  if (p.campaignId && p.campaignId !== MAP.campaignId) return;
  switch (p.type) {
    case 'tavern:open': return openHere(p.tavernId);
    case 'tavern:close': return closeTavernHere();
    case 'tavern:volume':
      if (TAVERN.open?.id === p.tavernId && MAP._tavernAudio) MAP._tavernAudio.volume = Math.min(1, Math.max(0, p.volume ?? 0.5));
      return;
    case 'tavern:hero': return setHero(p);            // my sheet answered: my purse and my numbers
    case 'tavern:busy': return setBusy(p.busy || {}); // the DM's Hub says who is at which table
  }
  if (MAP.isDM) await refereeEvent(p);
  await onSeatEvent(p);
}

async function openHere(tavernId) {
  setServerData(await loadHubDm()); // the DM saved the tavern just before announcing it
  const t = cleanTavern(campaign()?.taverns?.[tavernId] || {});
  if (!campaign()?.taverns?.[tavernId]) return;
  closeTavernHere({ restore: false });
  // a shop or a soundtrack gives way
  if (MAP._activeShopId) { document.getElementById('lk-shop-exit')?.remove(); stopShopScene(); MAP._activeShopId = null; }
  for (const k of ['_shopAudio', '_soundtrackAudio']) if (MAP[k]) { MAP[k].pause(); MAP[k].src = ''; MAP[k] = null; }
  TAVERN.open = { id: tavernId, campaignId: MAP.campaignId, busy: {} };
  const wrap = document.getElementById('map-canvas-wrap');
  if (!wrap) return;
  let media = null;
  if (t.videoFileId) media = await request('files:getUrl', { fileId: t.videoFileId }).catch(() => null);
  if (media?.url) startTavernMedia(wrap, media.url, t.videoMime || media.mime || '');
  else startTavernScene(wrap, t.name);
  // the map's tokens and walls leave the view (the map itself is unchanged), and the fog with them
  MAP.layers?.tokens?.removeChildren(); MAP.layers?.walls?.removeChildren();
  MAP.tokenSprites = {};
  MAP._shopFogHidden = true;
  renderFog();
  if (t.soundFileId) {
    const res = await request('files:getUrl', { fileId: t.soundFileId }).catch(() => null);
    if (res?.url && TAVERN.open?.id === tavernId) {
      const aud = new Audio(res.url);
      aud.loop = true; aud.crossOrigin = 'anonymous'; aud.volume = t.ambientVolume;
      playWhenAllowed(() => aud.play());
      MAP._tavernAudio = aud;
    }
  }
  await renderHall(wrap, t);
  showExit(wrap);
  if (MAP.isDM) refereeOpen(tavernId);
  else localPublish('dnd-player', 'tavern:hero?', { type: 'tavern:hero?', campaignId: MAP.campaignId });
}

/** Leave the tavern on this screen (the DM's close, a scene or map taking over, or my own way out). */
export function closeTavernHere({ restore = true } = {}) {
  if (!TAVERN.open) return;
  leaveTable();
  closeTalk();
  if (MAP.isDM) refereeClose();
  TAVERN.open = null;
  document.getElementById('lk-tavern-hall')?.remove();
  document.getElementById('lk-tavern-exit')?.remove();
  if (MAP._tavernAudio) { MAP._tavernAudio.pause(); MAP._tavernAudio.src = ''; MAP._tavernAudio = null; }
  stopTavernScene();
  MAP._shopFogHidden = false;
  if (restore) { clearTokenCache(); renderTokens(); renderWalls(); renderFog(); }
}

async function portraitUrl(fileId) {
  if (!fileId) return null;
  if (!(fileId in TAVERN.portraits)) {
    TAVERN.portraits[fileId] = (await request('files:getUrl', { fileId }).catch(() => null))?.url || null;
  }
  return TAVERN.portraits[fileId];
}

/** The round portrait of a host: their picture, or their initial. */
export async function medal(host) {
  const url = await portraitUrl(host.portraitFileId);
  const el = document.createElement('div');
  el.className = 'tv-medal';
  if (url) { const img = new Image(); img.src = url; img.alt = ''; el.appendChild(img); }
  else el.textContent = (host.name || '?').trim()[0]?.toUpperCase() || '?';
  return el;
}

async function renderHall(wrap, t) {
  document.getElementById('lk-tavern-hall')?.remove();
  const hall = document.createElement('div');
  hall.id = 'lk-tavern-hall';
  const row = document.createElement('div');
  row.className = 'tv-tables';
  hall.appendChild(row);
  wrap.appendChild(hall);
  for (const [i, h] of t.hosts.entries()) {
    const s = setupFor(h);
    const b = document.createElement('button');
    b.className = 'tv-host';
    b.dataset.host = h.id;
    b.style.animationDelay = `${0.08 * i}s`;
    b.title = `Talk to ${h.name}`;
    b.appendChild(await medal(h));
    const plaque = document.createElement('div');
    plaque.className = 'tv-plaque';
    plaque.innerHTML = '<b></b><span></span>';
    plaque.querySelector('b').textContent = h.name;
    plaque.querySelector('span').textContent = s ? (gameType(s.type)?.name || s.name) : 'Just talking';
    b.append(plaque, Object.assign(document.createElement('div'), { className: 'tv-table-top' }),
      Object.assign(document.createElement('div'), { className: 'tv-busy' }));
    b.onclick = () => openTalk(h, s);
    row.appendChild(b);
  }
  setBusy(TAVERN.open?.busy || {});
}

/** Who is playing at each table, under its host: { hostId: ['Bob', …] }. */
export function setBusy(busy) {
  if (!TAVERN.open) return;
  TAVERN.open.busy = busy;
  document.querySelectorAll('#lk-tavern-hall .tv-host').forEach(b => {
    const names = busy[b.dataset.host] || [];
    b.querySelector('.tv-busy').textContent = names.length ? `🎲 ${names.join(', ')}` : '';
  });
}

function showExit(wrap) {
  document.getElementById('lk-tavern-exit')?.remove();
  const b = document.createElement('button');
  b.id = 'lk-tavern-exit';
  b.className = 'map-tool-btn';
  b.style.cssText = 'position:absolute;top:12px;left:12px;z-index:60';
  b.textContent = MAP.isDM ? '✕ Close tavern for everyone' : '← Back to the map';
  b.onclick = async () => {
    if (MAP.isDM) await publishTo([], 'tavern:close', { type: 'tavern:close', campaignId: MAP.campaignId, fromUserId: userId });
    closeTavernHere();
  };
  wrap.appendChild(b);
}
