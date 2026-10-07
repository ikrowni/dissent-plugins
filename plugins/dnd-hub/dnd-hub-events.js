// dnd-hub-events.js — onInit, onEvent, handleMapEvent (realtime event dispatcher)
import { MAP, serverData, userId, showScreen, setServerData, setUserId, effectiveGs, hubFogKey } from './dnd-hub-state.js?v=20261014w';
import { request, storageGet, storageSet, getIdentity, realtimePublishCompanion, localPublish, storageGetUser, storageSetUser } from '../plugin-sdk.js';
import { initGuides, guide } from './lk-guide-ui.js';
import { floatHp, secretRoll } from './dnd-hub-fx-combat.js';
import { GUIDES_KEY } from './lk-guides.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { receivedToken, receivedPins } from './lk-secrets.js';
import { EV } from './dnd-hub-event-types.js?v=20261014w';
import { renderMapBackground, ensureImageFrame, refreshGuide } from './dnd-hub-map-bg.js?v=20261014w';
import { startShopScene, stopShopScene, startShopMedia } from './dnd-hub-shop-scene.js';
import { fileUrl } from './dnd-hub-file-url.js?v=20261014w';
import { handleTavernEvent, closeTavernHere, TAVERN, setTavernMapLoader } from './dnd-hub-tavern.js?v=20261014w';
import { playConditionFx } from './dnd-hub-condition-fx.js';
import { renderGrid } from './dnd-hub-grid.js?v=20261014w';
import { renderTokens, buildTokenSprite, clearTokenCache, CLIENT_ID, moveStamp, publishMove, applyPlayerSight, applyFacing } from './dnd-hub-tokens.js?v=20261014w';
import { syncTurn, commitPath, refereeMove, moveToast, limitingTurnId } from './dnd-hub-turn-move.js';
import { cellsBetween } from './dnd-hub-movement.js';
import { allowedLevel } from './lk-levelling.js';
import { openLevelUp, levelBurst } from './dnd-hub-levelup.js';
import { computeLocalPlayerLOS } from './dnd-hub-los.js?v=20261014w';
import { renderFog } from './dnd-hub-fog.js?v=20261014w';
import { renderWalls } from './dnd-hub-walls.js?v=20261014w';
import { renderInitiativeHUD, showMapRollToast } from './dnd-hub-initiative.js?v=20261014w';
import { loadSRD } from './dnd-hub-char.js?v=20261014w';
import { showPingAnimation } from './dnd-hub-ruler.js?v=20261014w';
import { judgeAttack, applyPendingDamage, damageTokens, showCombatToast, focusClosestEnemy, preAttack } from './dnd-hub-combat.js?v=20261014w';
import { rule } from './lk-table-rules.js';
import { animateDice, animateDiceFree } from './dnd-hub-dice.js?v=20261014w';
import { renderPins, showHandoutOverlay } from './dnd-hub-pins.js?v=20261014w';
import { setSceneApplier, handleTravelRequest, noteSceneLoaded, PIN_TRAVEL } from './dnd-hub-travel.js';
import { whileRemote } from './dnd-hub-undo.js';
import { tellSheetWhereIAm } from './dnd-hub-zone-pos.js';
import { renderPictures, PICTURES_UPDATE } from './dnd-hub-pictures.js';
import { myLook } from './dnd-hub-dice-look.js';
import { renderLights } from './dnd-hub-lights.js?v=20261014w';
import { renderAudioZones } from './dnd-hub-audio-zones.js?v=20261014w';
import { renderTriggers, checkTriggers, triggerCell, fireTrigger, showTriggerToast, showTriggerConfirm } from './dnd-hub-triggers.js?v=20261014w';
import { updateSpatialAudio } from './dnd-hub-spatial.js?v=20261014w';
import { renderTemplates } from './dnd-hub-templates.js?v=20261014w';
import { saveHubDm, loadHubDm, setSecretsUser, isUnreadCampaign } from './dnd-hub-storage.js?v=20261014w';
import { isRepeat, publishTo } from './lk-bus.js';
import { acceptMove, viewCentre, isOwnWaitingSpawn } from './dnd-hub-rules.js';
import { setView } from './dnd-hub-canvas.js?v=20261014w';
import { startAmbience, stopAmbience, playWhenAllowed } from './dnd-hub-ambience.js';

// Timestamps of dice:roll events broadcast BY THIS HUB after a physics roll —
// used to skip re-animating our own broadcast when it bounces back via realtime.
const _ownPhysicsRollTs = new Set();

/**
 * Parse a dice expression like "2d6+2" or "1d20" or "d8".
 * Returns { count, sides, mod } or null if unrecognised.
 */
function parseDiceExpr(expr) {
  if (!expr) return null;
  const m = String(expr).match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  return {
    count: parseInt(m[1] || '1', 10),
    sides: parseInt(m[2], 10),
    mod:   parseInt(m[3] || '0', 10),
  };
}

/**
 * Split a total roll result across `count` dice of `sides` faces.
 * Returns an array of `count` integers each in [1, sides] that sum to `total - mod`.
 */
function splitRolls(count, sides, total, mod) {
  const target = total - mod;
  if (count === 1) return [Math.min(Math.max(target, 1), sides)];
  const rolls = [];
  let remaining = target;
  for (let i = 0; i < count - 1; i++) {
    const lo = Math.max(1, remaining - sides * (count - 1 - i));
    const hi = Math.min(sides, remaining - (count - 1 - i));
    const val = lo + Math.floor(Math.random() * (hi - lo + 1));
    rolls.push(val);
    remaining -= val;
  }
  rolls.push(Math.min(Math.max(remaining, 1), sides));
  return rolls;
}

export async function onInit(initData) {
  const identity = await getIdentity();
  setUserId(identity?.id ?? null);
  setSecretsUser(identity?.id ?? null); // before the first load: the DM's screen joins its secret record
  initGuides({ get: () => storageGetUser(GUIDES_KEY), set: v => storageSetUser(GUIDES_KEY, v) }); // per person (lk-guides.js)

  await loadSRD();

  // Legacy migration: if hub-dm doesn't exist yet, copy from old 'hub' key once.
  // Also merge any maps from 'hub' that are missing from 'hub-dm' (fixes VTT maps
  // that were accidentally saved to the wrong key before the storageSet bug was fixed).
  let dmData = await loadHubDm();
  const hubData = await storageGet('hub');
  if (!dmData && hubData) {
    console.log('[dnd-hub] migrating storage: hub → hub-dm');
    await saveHubDm( hubData);
    dmData = hubData;
  } else if (dmData && hubData) {
    let merged = false;
    for (const [cid, camp] of Object.entries(hubData.campaigns || {})) {
      // Left unread (this user is not in it), not missing: copying the old blob in would overwrite it.
      if (isUnreadCampaign(cid)) continue;
      if (!dmData.campaigns) dmData.campaigns = {};
      const dmCamp = dmData.campaigns[cid];
      if (!dmCamp) {
        dmData.campaigns[cid] = camp;
        merged = true;
      } else {
        for (const [mid, mapEntry] of Object.entries(camp.maps || {})) {
          if (!dmCamp.maps) dmCamp.maps = {};
          if (!dmCamp.maps[mid]) {
            dmCamp.maps[mid] = mapEntry;
            merged = true;
          }
        }
        if (camp.activeMapId && !dmCamp.activeMapId) {
          dmCamp.activeMapId = camp.activeMapId;
          merged = true;
        }
      }
    }
    if (merged) {
      console.log('[dnd-hub] merged maps from hub → hub-dm');
      await saveHubDm( dmData);
    }
  }
  setServerData(dmData || { campaigns: {} });

  // Verify storage is writable — surfaces permission/backend errors early
  try {
    await request('storage:set', { key: '_ping', value: 1, scope: 'server' });
  } catch (e) {
    const warn = document.createElement('div');
    warn.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#7f1d1d;color:#fca5a5;padding:8px 12px;font-size:12px;z-index:9999;text-align:center';
    warn.textContent = 'Storage unavailable — campaigns will not persist. Error: ' + (e?.message || String(e));
    document.body.appendChild(warn);
  }

  showScreen('lobby');
}

export function onEvent(ev) {
  const payload = ev.data;
  if (!payload) return;
  // 🔴 fromUserId inside the payload is only the sender's claim: a tampered screen could say it was the DM (or say
  // nothing, which isDMEvent let through) and reveal fog, move tokens or load maps on everyone's screen. A network
  // event carries sender_id, set by the node from the authenticated caller; it replaces the claim. Events relayed
  // on this screen by a sibling plugin (localPublish) have none and come from this user's own screen.
  if (ev.sender_id && typeof payload === 'object') payload.fromUserId = ev.sender_id;
  // The last events this screen received (type, sender, time): the playtest reads it when an event goes missing.
  (window.__lkRecent ||= []).push({ t: payload.type || ev.event, from: ev.sender_id || 'local', at: Date.now() });
  if (window.__lkRecent.length > 40) window.__lkRecent.shift();
  // The event's name is its type. Several senders (traps, the VTT import) put no `type` in the payload, and
  // handleMapEvent drops a typeless payload: a trap that fired reached nobody, not even the DM.
  if (typeof payload === 'object' && !payload.type && ev.event) payload.type = ev.event;
  // My own echo of a whole-state edit (grid, walls, doors, lights, pins, sound zones) is old by the time it comes
  // back: this screen already applied the edit, and may have made another since. Applying the echo undid it (the
  // grid's opacity went back, toolbar test 2026-10-03).
  if (payload.clientId === CLIENT_ID && OWN_ECHO_IGNORED.has(payload.type)) return;
  // What an event changes is not the DM's own edit: Ctrl+Z must not undo another screen's work (dnd-hub-undo.js).
  whileRemote(() => handleMapEvent(payload)).catch(e => console.error('[dnd-hub] event handler error:', e));
}

setSceneApplier(handleMapEvent); // travel pins load a scene on this screen the way a network scene:load does
// A tavern switches this screen to its map the way `map:set` does (dnd-hub-tavern.js openHere).
setTavernMapLoader(mapId => handleMapEvent({ type: 'map:set', campaignId: MAP.campaignId, mapId }));

const OWN_ECHO_IGNORED = new Set(['map:weather', 'map:grid-settings', 'walls:update', 'door:state', 'lights:update', 'pins:update', 'audio:zone-update', 'pictures:update']);

const PRIVILEGED_EVENTS = new Set([
  'hp:change','fog:reveal','fog:reset','map:set','initiative:update',
  'tokens:spawn','walls:update','lights:update','trigger:fired','trigger:pending',
  'token:turn-start','token:conditions','combat:settings',
  'scene:load','pins:update','audio:play','audio:zone-update',
  'shop:open','shop:volume','shop:close','contest:roll',
  'session:start','map:view','level:grant','map:weather','pictures:update',
  // the tavern: opened and closed by the DM, and only the DM's Hub (the house) seats and pays (dnd-hub-tavern-ref.js)
  'tavern:open','tavern:close','tavern:volume','tavern:busy','tavern:seated','tavern:payout','tavern:npcs',
]);

// Returns true if the event came from the DM of the campaign.
// Events without fromUserId are allowed through for backward compatibility.
function isDMEvent(p) {
  if (!p.fromUserId) return true;
  return p.fromUserId === serverData?.campaigns?.[p.campaignId]?.dmUserId;
}

let _hpSaveTimer = null;

/** Apply the DM's view once this Hub has the right map and its session load is done (plan D3). */
function applyPendingView() {
  const v = MAP._pendingView;
  if (!v || MAP._sessionLoading || v.mapId !== MAP.mapId || !MAP.mapData) return;
  MAP._pendingView = null;
  setView(v.cx, v.cy, v.zoom);
}
const _seenMoves = {};

/** Put a token back where the DM's screen last accepted it, on every screen, and tell the DM. */
function _sendBack(p) {
  const tok = MAP.mapData?.tokens?.[p.tokenId];
  if (!tok) return;
  const turn = MAP.turnMove?.tokenId === p.tokenId ? MAP.turnMove : null;
  publishMove({ type: EV.TOKEN_MOVE, campaignId: MAP.campaignId, tokenId: p.tokenId,
    x: tok.x, y: tok.y, final: true, turnPath: turn?.path || null, turnKey: turn?.key || null,
    fromUserId: userId, ...moveStamp() });
  const spr = MAP.tokenSprites[p.tokenId];
  if (spr) { spr.x = tok.x; spr.y = tok.y; }
  moveToast(`${tok.name || 'A token'} moved ${turn ? 'past its speed' : 'out of turn'} — sent back.`);
}

export async function handleMapEvent(p) {
  if (!p.type) return;
  // The same event can arrive twice (its own channel and a sibling's); handle it once.
  if (isRepeat(p)) return;

  // Lazy-reload serverData when the campaign isn't cached yet.
  // This prevents isDMEvent from failing on player hubs that haven't fully loaded.
  if (p.campaignId && !serverData?.campaigns?.[p.campaignId]) {
    // A campaign this screen left unread is one this user is not in (lk-campaign-index.js): not for this screen.
    // Reloading for it would re-read the list on every event of every other table on the server.
    if (isUnreadCampaign(p.campaignId)) return;
    setServerData(await loadHubDm());
  }

  // Block privileged events from non-DM senders (requires fromUserId to be stamped)
  // A player may change their OWN token's HP (their sheet is where their HP lives); nothing else of theirs.
  const ownHp = p.type === EV.HP_CHANGE && p.fromUserId && p.tokenId === `player_${p.fromUserId}`;
  // …and put their own token beside the map, waiting for the DM (dnd-hub-rules.js isOwnWaitingSpawn).
  const ownSpawn = p.type === 'tokens:spawn' && isOwnWaitingSpawn(p);
  if (PRIVILEGED_EVENTS.has(p.type) && !isDMEvent(p) && !ownHp && !ownSpawn) {
    console.warn('[dnd-hub] blocked privileged event from non-DM:', p.type, p.fromUserId);
    return;
  }
  if (p.type.startsWith('tavern:')) { await handleTavernEvent(p); return; }

  switch (p.type) {
    // A player joined or finished a character: the DM's copy of the campaign is stale until it is
    // re-read. Without this the DM saw no new player — and placed no token — until a reload.
    case EV.JOIN_APPROVED:
    case EV.CHARACTER_CREATED: {
      if (p.campaignId !== MAP.campaignId) return;
      setServerData(await loadHubDm());
      const fresh = serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId];
      if (fresh) MAP.mapData = fresh;
      renderTokens();
      refreshGuide();
      break;
    }
    case 'map:set': {
      if (p.campaignId !== MAP.campaignId) return;
      // Patch in-memory immediately from the payload to avoid storage read race,
      // then do a background refresh so serverData stays consistent.
      if (p.mapEntry && serverData?.campaigns?.[p.campaignId]) {
        serverData.campaigns[p.campaignId].maps = serverData.campaigns[p.campaignId].maps || {};
        serverData.campaigns[p.campaignId].maps[p.mapId] = p.mapEntry;
        serverData.campaigns[p.campaignId].activeMapId = p.mapId;
      } else {
        setServerData(await loadHubDm());
      }
      MAP.mapId = p.mapId;
      MAP.mapData = serverData?.campaigns?.[p.campaignId]?.maps?.[p.mapId];
      if (MAP.mapData) {
        // Load fog from its own key; fall back to embedded fogState for legacy maps
        const fogFromKey = await storageGet(hubFogKey(p.campaignId, p.mapId));
        MAP.mapData.fogState = fogFromKey ?? MAP.mapData.fogState ?? {};
        await renderMapBackground();
        await ensureImageFrame();
        refreshGuide();
        renderGrid();
        clearTokenCache();
        renderTokens();
        if (!MAP.isDM) computeLocalPlayerLOS();
        // Another map ends the tavern; the tavern's own map (it asked for this switch) keeps it.
        if (TAVERN.open?.mapId !== p.mapId) closeTavernHere();
        // Reset shop state so fog and audio restore normally on map load
        MAP._shopFogHidden = false; stopShopScene();
        MAP._activeShopId = null;
        if (MAP._shopAudio) { MAP._shopAudio.pause(); MAP._shopAudio = null; }
        renderFog();
        renderWalls();
        renderPins();
        renderLights();
        renderAudioZones();
        renderTriggers();
        // Phase 8: initialize spatial gains when map loads
        const mapSetCampaign = serverData?.campaigns?.[MAP.campaignId];
        updateSpatialAudio(
          userId,
          MAP.mapData.tokens || {},
          MAP.mapData,
          mapSetCampaign?.dmUserId,
          mapSetCampaign?.settings?.spatialRange ?? 60,
        ).catch(() => {});
        applyPendingView();
      }
      break;
    }
    case 'token:move': {
      if (!acceptMove(_seenMoves, p, CLIENT_ID)) return; // my own echo, or older than a move already applied (O6)
      if (p.tokenId === `player_${userId}`) tellSheetWhereIAm(p); // zone audio in my sidebar, in squares
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      // Players can only move their own token — but allow moves originating from the DM
      if (p.fromUserId && !MAP.isDM && p.tokenId !== 'player_' + p.fromUserId) {
        const isDMMove = p.fromUserId === serverData?.campaigns?.[p.campaignId]?.dmUserId;
        if (!isDMMove) {
          console.warn('[dnd-hub] blocked token:move for non-owned token');
          return;
        }
      }
      // A hero waiting beside the map stays there until the DM drags it in (dnd-hub-rules.js waitingSpot).
      if (MAP.isDM && p.fromUserId && !isDMEvent(p) && MAP.mapData.tokens?.[p.tokenId]?.waiting) { _sendBack(p); return; }
      // During a fight the DM's screen referees players' moves (fog safety; owner 2026-10-03).
      if (MAP.isDM && p.fromUserId && !isDMEvent(p)) {
        const verdict = refereeMove(p);
        if (verdict === 'wait') return;
        if (verdict === 'bounce') { _sendBack(p); return; }
      }
      // The squares this move entered, for traps: a fight move's new path squares, else where it stands now.
      const walked = p.turnPath && MAP.turnMove && p.turnKey === MAP.turnMove.key && p.tokenId === MAP.turnMove.tokenId;
      // (Outside a fight: every square on the line from where this screen last had it, as frames arrive ~3 a second.)
      const was = MAP.mapData.tokens?.[p.tokenId];
      const now = triggerCell(p.x, p.y);
      const entered = walked ? p.turnPath.slice(Math.max(1, MAP.turnMove.path.length))
        : was ? cellsBetween(triggerCell(was.x, was.y), now) : [now];
      if (walked) commitPath(p.turnPath);
      if (p.placed && isDMEvent(p) && MAP.mapData.tokens?.[p.tokenId]) MAP.mapData.tokens[p.tokenId].waiting = false; // false, not deleted (tokens.js)
      if (MAP.mapData.tokens?.[p.tokenId]) {
        MAP.mapData.tokens[p.tokenId].x = p.x;
        MAP.mapData.tokens[p.tokenId].y = p.y;
        if (p.facing != null) MAP.mapData.tokens[p.tokenId].facing = p.facing;
      }
      const spr = MAP.tokenSprites[p.tokenId];
      if (spr) { spr.x = p.x; spr.y = p.y; }
      // Rebuild sprite to reflect new facing arrow
      if (p.facing != null && MAP.mapData?.tokens?.[p.tokenId]) {
        const gs = effectiveGs(MAP.mapData);
        if (MAP.layers?.tokens) {
          if (spr?.parent) MAP.layers.tokens.removeChild(spr);
          const newSpr = buildTokenSprite(MAP.mapData.tokens[p.tokenId], gs);
          MAP.layers.tokens.addChild(newSpr);
          MAP.tokenSprites[p.tokenId] = newSpr;
        }
      }
      else { renderTokens(); } // sprite missing — token may have just spawned
      // Phase 6: move any lights attached to this token
      const lights = MAP.mapData.lights || [];
      let lightsMoved = false;
      for (const light of lights) {
        if (light.tokenId === p.tokenId) {
          light.x = p.x; light.y = p.y; lightsMoved = true;
        }
      }
      if (lightsMoved) { renderLights(); renderFog(); }
      // The DM's screen put my token back: see from where it really is.
      if (!MAP.isDM && p.tokenId === 'player_' + userId) { computeLocalPlayerLOS(); renderFog(); }
      // Someone else moved: whether I see them (and which way everyone faces) follows at once.
      else { applyPlayerSight(); applyFacing(); }
      // Traps: the DM's screen springs them (dnd-hub-triggers.js checkTriggers).
      if (MAP.isDM) checkTriggers(p.tokenId, entered).catch(() => {});
      // Phase 8: update spatial audio gains after any token move
      {
        const moveCampaign = serverData?.campaigns?.[MAP.campaignId];
        updateSpatialAudio(
          userId,
          MAP.mapData.tokens || {},
          MAP.mapData,
          moveCampaign?.dmUserId,
          moveCampaign?.settings?.spatialRange ?? 60,
        ).catch(() => {});
      }
      break;
    }
    case 'tokens:spawn': {
      if (p.campaignId !== MAP.campaignId) return;
      // If map data isn't loaded yet, try to recover: first from in-memory state,
      // then from a fresh storage read (handles case where map was activated after hub loaded).
      if (!MAP.mapData) {
        const cached = serverData?.campaigns?.[MAP.campaignId];
        const activeId = MAP.mapId || cached?.activeMapId;
        if (activeId) {
          MAP.mapId = activeId;
          MAP.mapData = cached?.maps?.[activeId] ?? null;
        }
        if (!MAP.mapData) {
          const fresh = await loadHubDm();
          setServerData(fresh);
          const freshCampaign = fresh?.campaigns?.[MAP.campaignId];
          const freshActiveId = MAP.mapId || freshCampaign?.activeMapId;
          if (freshActiveId) {
            MAP.mapId = freshActiveId;
            MAP.mapData = freshCampaign?.maps?.[freshActiveId] ?? null;
          }
        }
      }
      if (!MAP.mapData) return;
      MAP.mapData.tokens = MAP.mapData.tokens || {};
      // A hidden token arrives as a stub (lk-secrets.js); on a screen that has it (the DM's echo) it only hides it.
      if (p.tokens) p.tokens.forEach(t => {
        const kept = receivedToken(MAP.mapData.tokens[t.id], t, MAP.isDM);
        if (kept) MAP.mapData.tokens[t.id] = kept; else delete MAP.mapData.tokens[t.id];
      });
      if (p.deleted) p.deleted.forEach(id => { delete MAP.mapData.tokens[id]; });
      if (MAP.isDM) {
        const waiting = (p.tokens || []).filter(t => t.waiting && t.userId && t.userId === p.fromUserId);
        if (waiting.length) moveToast(`${waiting.map(t => t.name).join(', ')} is waiting left of the map — drag them in.`);
      }
      renderTokens();
      if (!MAP.isDM) { computeLocalPlayerLOS(); renderFog(); }
      break;
    }
    case 'character:created': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      // A player just created their character — reload storage so their
      // characterSummary is present, then re-render tokens to spawn them.
      setServerData(await loadHubDm());
      MAP.mapData = serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId];
      if (MAP.mapData) { renderTokens(); }
      break;
    }
    case 'fog:reveal': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      if (p.cells) {
        p.cells.forEach(([key, state]) => { MAP.mapData.fogState[key] = state; });
        renderPins();
        if (!MAP.isDM) renderWalls(); // doors in newly revealed ground
      }
      renderFog();
      break;
    }
    case 'fog:reset': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      MAP.mapData.fogState = {};
      renderFog();
      if (!MAP.isDM) renderWalls();
      break;
    }
    case 'map:weather': {
      // The DM changed the weather (dnd-hub-weather.js draws it from mapData.weather on the next frame).
      if (p.campaignId !== MAP.campaignId) return;
      const m = serverData?.campaigns?.[p.campaignId]?.maps?.[p.mapId];
      if (m) m.weather = p.weather;
      if (MAP.mapData && p.mapId === MAP.mapId) MAP.mapData.weather = p.weather;
      break;
    }
    case 'map:grid-settings': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      if (p.gridSize    !== undefined) MAP.mapData.gridSize    = p.gridSize;
      if (p.gridOffsetX !== undefined) MAP.mapData.gridOffsetX = p.gridOffsetX;
      if (p.gridOffsetY !== undefined) MAP.mapData.gridOffsetY = p.gridOffsetY;
      if (p.gridColor   !== undefined) MAP.mapData.gridColor   = p.gridColor;
      if (p.gridAlpha   !== undefined) MAP.mapData.gridAlpha   = p.gridAlpha;
      renderGrid();
      if (!MAP.isDM) computeLocalPlayerLOS();
      renderFog();
      renderTokens();
      break;
    }
    // map:grid kept for backward compat with old clients
    case 'map:grid': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      MAP.mapData.gridSize = p.gridSize;
      renderGrid();
      if (!MAP.isDM) computeLocalPlayerLOS();
      renderFog();
      renderTokens();
      break;
    }
    case 'walls:update': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      MAP.mapData.walls = p.walls;
      renderWalls();
      break;
    }
    case 'door:state': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      MAP.mapData.doors = p.doors;
      // Persisted by whoever toggled it (the canvas click handler). Receivers only redraw,
      // and players re-run line of sight: an opened door changes what they can see.
      renderWalls();
      if (!MAP.isDM) { computeLocalPlayerLOS(); renderFog(); }
      break;
    }
    case 'hp:change': {
      // A player's own HP (their sheet): players cannot publish to the DM's sidebar (no consent → 403), so the DM's
      // Hub hands it on. The DM's own changes already reach the sidebar directly.
      if (MAP.isDM && p.campaignId === MAP.campaignId && !isDMEvent(p)) localPublish('dnd-master', EV.HP_CHANGE, p);
      if (!MAP.mapData?.tokens) return;
      const tokenObj = Object.values(MAP.mapData.tokens).find(t =>
        t.id === p.tokenId || `player_${t.userId}` === p.tokenId
      );
      if (tokenObj) {
        const hpBefore = tokenObj.hp;
        tokenObj.hp = p.hp;
        floatHp(tokenObj.id, hpBefore, p.hp);
        tokenObj.hpMax = p.hpMax;
        // The DM's Hub keeps the map's copy, so the token's HP survives a reload (audit N3).
        if (MAP.isDM && serverData?.campaigns?.[MAP.campaignId]?.maps && MAP.mapId) {
          serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
          clearTimeout(_hpSaveTimer);
          _hpSaveTimer = setTimeout(() => saveHubDm(serverData).catch(() => {}), 1500);
        }
        const existing = MAP.tokenSprites[tokenObj.id];
        if (existing) {
          MAP.layers.tokens.removeChild(existing);
          const fresh = buildTokenSprite(tokenObj, effectiveGs(MAP.mapData));
          fresh.x = existing.x;
          fresh.y = existing.y;
          MAP.layers.tokens.addChild(fresh);
          MAP.tokenSprites[tokenObj.id] = fresh;
        }
      }
      break;
    }
    case 'initiative:update': {
      if (p.campaignId !== MAP.campaignId) return;
      renderInitiativeHUD(p.initiative);
      if (serverData?.campaigns?.[p.campaignId]) serverData.campaigns[p.campaignId].initiative = p.initiative;
      // Turn lock and this turn's path follow the DM's tracker (dnd-hub-turn-move.js).
      syncTurn(p.initiative);
      renderTokens();
      if (!MAP.isDM && limitingTurnId() === `player_${userId}`) focusClosestEnemy(); // my turn: aim at the closest foe
      break;
    }
    case EV.DICE_PHYSICS_ROLL: {
      // A player asked us to run a genuine physics roll and report back the result.
      const { sides, count, mod = 0, label, expression, userId: rollerId, ts, rollType = null } = p;
      let advMode = p.advMode || null;
      // A weapon attack from my sheet is checked first: target, reach, my turn, attacks left; flanking and range
      // add advantage or disadvantage (dnd-hub-combat.js preAttack). A refused attack throws no dice.
      if (rollType === 'attack' && p.weapon && !MAP.isDM) {
        const pre = preAttack(rollerId, p.weapon);
        if (!pre.ok) {
          moveToast(pre.reason);
          localPublish('dnd-player', 'attack:refused', { type: 'attack:refused', ts, reason: pre.reason });
          break;
        }
        const ups = [advMode === 'adv', pre.adv].filter(Boolean).length, downs = [advMode === 'dis', pre.dis].filter(Boolean).length;
        advMode = ups && downs ? null : ups ? 'adv' : downs ? 'dis' : null; // one of each cancels out (SRD)
        const why = [pre.flanked && 'flanking: advantage', pre.far && 'long range: disadvantage',
          pre.crowded && 'an enemy next to you: disadvantage'].filter(Boolean).join(' · ');
        if (why) showCombatToast(why);
      }
      const effectiveCount = advMode ? 2 : count;
      const rolls = await animateDiceFree(sides, effectiveCount, myLook());
      let usedRolls = rolls;
      if (advMode) {
        const chosen = advMode === 'adv' ? Math.max(...rolls) : Math.min(...rolls);
        usedRolls = [chosen];
      }
      const total = usedRolls.reduce((a, b) => a + b, 0) + mod;
      const natural = sides === 20 && usedRolls.length === 1 ? usedRolls[0] : null;
      const verdict = rollType === 'attack' && natural != null ? judgeAttack(total, natural, rollerId) : null;
      if (rollType === 'damage') await applyPendingDamage(rollerId, total);
      const payload = {
        type: EV.DICE_ROLL, userId: rollerId,
        expression: expression || `${count}d${sides}${mod >= 0 ? '+' : ''}${mod}`,
        result: total, rolls, advMode, label, ts, rollType, verdict,
        look: myLook(), // the roller's dice skin: the table sees these dice in these colours
      };
      _ownPhysicsRollTs.add(ts);
      await realtimePublish(EV.DICE_ROLL, payload);
      // Send result directly back to the player plugin too (for immediate UI update)
      localPublish('dnd-player', EV.DICE_ROLL, payload);
      break;
    }
    case 'dice:roll': {
      // My own relayed roll coming back: already shown here.
      if (p.relay && p.clientId === CLIENT_ID) break;
      // A roll from my DM sidebar (it reaches only my screens): tell the table. Shown rolls go to every map with
      // their number; secret ones only as "the DM rolls behind the screen". The relay is marked, so it never loops.
      if (p.fromSidebar && !p.relay && MAP.isDM && p.campaignId === MAP.campaignId) {
        if (p.shown) realtimePublish(EV.DICE_ROLL, { ...p, fromSidebar: false, relay: true, clientId: CLIENT_ID, fromUserId: userId, look: myLook() }).catch(() => {});
        else realtimePublish(EV.DICE_SECRET, { type: EV.DICE_SECRET, campaignId: MAP.campaignId, ts: p.ts, fromUserId: userId }).catch(() => {});
      }
      showMapRollToast(p);
      // One verdict, decided on the attacker's screen (judgeAttack), shown on every screen.
      if (p.verdict?.text) showCombatToast(`Roll ${p.result} — ${p.verdict.text}`);
      MAP.lastRoll = { ts: p.ts, userId: p.userId, label: p.label || '', rollType: p.rollType || null, verdict: p.verdict?.text || null, look: p.look || null };
      // Skip animation if this is our own physics-roll broadcast bouncing back
      if (_ownPhysicsRollTs.has(p.ts)) {
        _ownPhysicsRollTs.delete(p.ts);
        break;
      }
      const parsed = parseDiceExpr(p.expression);
      if (parsed && MAP.mapData) {
        const indiv = splitRolls(parsed.count, parsed.sides, p.result, parsed.mod);
        // The roller's skin as sent (dnd-hub-dice-look.js checks it before drawing); my own roll in mine.
        animateDice(parsed.sides, indiv, p.look || (p.userId === userId ? myLook() : null));
      }
      // Someone else's attack is judged on THEIR screen, against the targets they selected; judging it
      // here against whatever this viewer had selected gave different verdicts on different screens (G6).
      break;
    }
    case 'dice:secret': {
      if (p.campaignId === MAP.campaignId && !MAP.isDM) secretRoll();
      break;
    }
    case 'map:ping': {
      if (p.campaignId !== MAP.campaignId) return;
      showPingAnimation(p.x, p.y);
      break;
    }
    case 'token:turn-start': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      syncTurn({ ts: p.ts }, p.tokenId);
      renderTokens();
      break;
    }
    case 'token:conditions': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData?.tokens) return;
      const tok = MAP.mapData.tokens[p.tokenId];
      if (!tok) return;
      tok.conditions = p.conditions;
      const existing = MAP.tokenSprites[p.tokenId];
      if (existing) {
        const gs = effectiveGs(MAP.mapData);
        MAP.layers.tokens.removeChild(existing);
        const fresh = buildTokenSprite(tok, gs);
        fresh.x = existing.x; fresh.y = existing.y;
        MAP.layers.tokens.addChild(fresh);
        MAP.tokenSprites[p.tokenId] = fresh;
      }
      break;
    }
    case 'token:death-save':
      // Hub shows death state via hp<=0 skull (buildTokenSprite); player sidebar handles the save UI.
      // A player's save goes on to the DM's sidebar log, the same way as their HP.
      if (MAP.isDM && p.campaignId === MAP.campaignId && !isDMEvent(p)) localPublish('dnd-master', EV.TOKEN_DEATH_SAVE, p);
      break;
    case EV.SESSION_START: {
      // The DM started the evening (spec §6): the scene (map, video, soundtrack) through the scene path, the music,
      // and the "Last time…" card. Nothing is posted to chat.
      if (p.campaignId !== MAP.campaignId) return;
      const music = p.music || {};
      MAP._sessionLoading = true;
      try {
        if (p.mapId || p.sceneId) {
          await handleMapEvent({ type: 'scene:load', campaignId: p.campaignId, sceneId: p.sceneId, mapId: p.mapId,
            videoFileId: p.videoFileId || null, soundtrackFileId: music.mode === 'scene' ? music.soundtrackFileId : null,
            ambientVolume: music.volume, fromUserId: p.fromUserId });
        }
        if (music.mode !== 'scene' && MAP._soundtrackAudio) { MAP._soundtrackAudio.pause(); MAP._soundtrackAudio = null; }
        if (music.mode === 'ambience') startAmbience(music.volume); else stopAmbience();
        if (p.recap) showHandoutOverlay({ title: 'Last time…', content: p.recap });
        MAP.session = { id: p.sessionId, startedAt: Date.now() };
      } finally {
        MAP._sessionLoading = false;
      }
      applyPendingView();
      // Only the DM's Hub knows the DM's view (plan D2): send it as a world centre, so every window size sees the same place.
      if (MAP.isDM && MAP.mapId && MAP.app) {
        const { cx, cy } = viewCentre(MAP.panX, MAP.panY, MAP.zoom, MAP.app.screen.width, MAP.app.screen.height);
        await publishTo([], EV.VIEW_SET, { campaignId: MAP.campaignId, mapId: MAP.mapId, cx, cy, zoom: MAP.zoom, fromUserId: userId });
      }
      break;
    }
    case EV.VIEW_SET: {
      if (p.campaignId !== MAP.campaignId || MAP.isDM) return;
      MAP._pendingView = { mapId: p.mapId, cx: Number(p.cx), cy: Number(p.cy), zoom: Number(p.zoom) || 1 };
      applyPendingView();
      break;
    }
    case EV.PARTY_UPDATE: {
      // A hero's summary changed. The Hub's copy feeds passive Perception for traps and token names; the DM's Hub
      // hands it to the DM sidebar, which players cannot reach (no consent → 403).
      if (p.campaignId !== MAP.campaignId || p.fromUserId !== p.userId || !p.summary) return;
      const camp = serverData?.campaigns?.[p.campaignId];
      if (camp) camp.characterSummaries = { ...(camp.characterSummaries || {}), [p.userId]: p.summary };
      if (MAP.isDM) localPublish('dnd-master', EV.PARTY_UPDATE, p);
      break;
    }
    case EV.INITIATIVE_ROLL: {
      // A player's own initiative roll. Players cannot publish to the DM's sidebar (no consent → 403), so the
      // DM's Hub hands it to the sidebar on the same screen.
      if (p.campaignId !== MAP.campaignId || !MAP.isDM) return;
      localPublish('dnd-master', EV.INITIATIVE_ROLL, p);
      break;
    }
    case EV.WEAPON_ATTACK: {
      // A player's weapon to-hit / damage roll, for the DM's sidebar log; same route as EV.INITIATIVE_ROLL.
      if (p.campaignId !== MAP.campaignId || !MAP.isDM) return;
      localPublish('dnd-master', EV.WEAPON_ATTACK, p);
      break;
    }
    case EV.DAMAGE_REQUEST: {
      // A player's Hub judged a hit and rolled damage; only the DM's Hub changes HP, and only if the table applies damage.
      if (p.campaignId !== MAP.campaignId || !MAP.isDM || !rule(serverData?.campaigns?.[p.campaignId]?.settings, 'autoDamage')) return;
      await damageTokens(p.tokenIds || [], Math.max(0, Number(p.damage) || 0), p.campaignId, { crit: !!p.crit });
      break;
    }
    case 'combat:settings': {
      if (p.campaignId !== MAP.campaignId || !serverData?.campaigns?.[p.campaignId]) return;
      serverData.campaigns[p.campaignId].settings = p.settings;
      renderTokens(); // refresh turnLock overlays
      // Phase 8: re-apply spatial gains immediately when DM changes spatialRange
      if (MAP.mapData?.tokens) {
        updateSpatialAudio(
          userId,
          MAP.mapData.tokens,
          MAP.mapData,
          serverData.campaigns[p.campaignId]?.dmUserId,
          p.settings?.spatialRange ?? 60,
        ).catch(() => {});
      }
      break;
    }
    case PICTURES_UPDATE: {
      // The DM pinned, moved, sized or removed a picture on the map (dnd-hub-pictures.js).
      if (p.campaignId !== MAP.campaignId || p.mapId !== MAP.mapId || !MAP.mapData || !Array.isArray(p.pictures)) return;
      MAP.mapData.pictures = p.pictures;
      renderPictures();
      break;
    }
    case PIN_TRAVEL:
      await handleTravelRequest(p); // the DM's Hub checks the pin's permission; every other screen ignores it
      break;
    case 'scene:load': {
      if (p.campaignId !== MAP.campaignId) return;
      noteSceneLoaded();
      closeTavernHere();
      // Reset shop state so fog and audio restore when a scene takes over
      MAP._shopFogHidden = false; stopShopScene();
      MAP._activeShopId = null;
      if (MAP._shopAudio) { MAP._shopAudio.pause(); MAP._shopAudio = null; }
      // Switch map if a mapId is specified and differs from current
      if (p.mapId && p.mapId !== MAP.mapId) {
        await handleMapEvent({ type: 'map:set', campaignId: p.campaignId, mapId: p.mapId });
      }
      // Override background with scene video (in-memory patch — not persisted)
      if (p.videoFileId && MAP.mapData) {
        MAP.mapData.fileId = p.videoFileId;
        MAP.mapData.mime   = ''; // let renderMapBackground probe mime
        await renderMapBackground();
      }
      // Play soundtrack
      if (p.soundtrackFileId) {
        try {
          const res = await request('files:getUrl', { fileId: p.soundtrackFileId });
          if (res?.url) {
            if (MAP._soundtrackAudio) { MAP._soundtrackAudio.pause(); MAP._soundtrackAudio.src = ''; }
            const aud = new Audio(res.url);
            aud.loop = true;
            aud.volume = Math.min(1, Math.max(0, p.ambientVolume ?? 0.5));
            aud.crossOrigin = 'anonymous';
            playWhenAllowed(() => aud.play()); // blocked until a gesture: retry on the first click
            MAP._soundtrackAudio = aud;
          }
        } catch { /* autoplay blocked or fetch failed — silent */ }
      }
      break;
    }
    case 'shop:open': {
      if (p.campaignId !== MAP.campaignId) return;
      // Stop any playing soundtrack or previous shop audio
      if (MAP._soundtrackAudio) { MAP._soundtrackAudio.pause(); MAP._soundtrackAudio.src = ''; MAP._soundtrackAudio = null; }
      closeTavernHere();
      if (MAP._shopAudio) { MAP._shopAudio.pause(); MAP._shopAudio = null; }
      // The shop's own picture or video if it has one, else the lantern-lit scene drawn in code. Both sit OVER the map:
      // the old video path wrote the shop's file into the map's own data, where a save could keep it.
      {
        const wrap = document.getElementById('map-canvas-wrap');
        const shopName = p.shopName || serverData?.campaigns?.[p.campaignId]?.shops?.[p.shopId]?.name || '';
        if (wrap) {
          // the drawn shop at once; the DM's own picture fades in over it when it arrives (dnd-hub-file-url.js)
          startShopScene(wrap, shopName);
          showShopExit(wrap);
          if (p.videoFileId) fileUrl(p.videoFileId).then(m => { if (m?.url && MAP._activeShopId === p.shopId) startShopMedia(wrap, m.url, p.videoMime || m.mime || ''); });
        }
      }
      // Clear tokens and walls from display (visual only — mapData unchanged so they restore on map reload)
      if (MAP.layers?.tokens) MAP.layers.tokens.removeChildren();
      if (MAP.layers?.walls)  MAP.layers.walls.removeChildren();
      MAP.tokenSprites = {};
      // Suppress fog
      MAP._activeShopId = p.shopId;
      MAP._shopFogHidden = true;
      renderFog();
      // The shop's background sound, looping (without one, its video's own soundtrack).
      if (p.soundFileId || p.videoFileId) {
        try {
          const res = await fileUrl(p.soundFileId || p.videoFileId);
          if (res?.url) {
            const aud = new Audio(res.url);
            aud.loop = true;
            aud.volume = Math.min(1, Math.max(0, p.ambientVolume ?? 0.5));
            aud.crossOrigin = 'anonymous';
            aud.play().catch(() => {});
            MAP._shopAudio = aud;
          }
        } catch { /* autoplay blocked or fetch failed */ }
      }
      break;
    }
    case 'conditions:fx': {
      // My own sheet: my hero gained these conditions (0 HP, or I marked one).
      if (p.fromUserId && p.fromUserId !== userId) return;
      (p.conditions || []).forEach((c, i) => setTimeout(() => playConditionFx(c), i * 2700));
      break;
    }
    case 'shop:close': {
      // The DM closed the shop: every screen goes back to the map.
      if (p.campaignId !== MAP.campaignId) return;
      await leaveShop();
      break;
    }
    case 'shop:volume': {
      if (p.shopId !== MAP._activeShopId || !MAP._shopAudio) return;
      MAP._shopAudio.volume = Math.min(1, Math.max(0, p.volume ?? 0.5));
      break;
    }
    case 'contest:roll': {
      // Only the DM hub rolls dice; non-DM hubs ignore this.
      if (p.campaignId !== MAP.campaignId || !MAP.isDM) return;
      const rolls = [];
      for (const c of (p.contestants || [])) {
        const [r] = await animateDiceFree(20, 1, myLook());
        rolls.push({ userId: c.userId, name: c.name, roll: r });
      }
      // Resolve ties with additional rolls
      let maxRoll = Math.max(...rolls.map(r => r.roll));
      let winners = rolls.filter(r => r.roll === maxRoll);
      while (winners.length > 1) {
        for (const w of winners) {
          const [r] = await animateDiceFree(20, 1, myLook());
          w.roll = r; w.tieBreaker = true;
        }
        maxRoll = Math.max(...winners.map(r => r.roll));
        winners = winners.filter(r => r.roll === maxRoll);
      }
      const winner = winners[0];
      showTriggerToast('🎲 ' + winner.name + ' wins ' + (p.itemName || 'the item') + '!');
      await realtimePublishCompanion('dnd-master', EV.CONTEST_RESULT, {
        type: EV.CONTEST_RESULT, contestKey: p.contestKey,
        rolls, winner: winner.userId, winnerName: winner.name,
        campaignId: p.campaignId, fromUserId: p.fromUserId,
      });
      break;
    }
    case 'pins:update': {
      if (p.campaignId !== MAP.campaignId || p.mapId !== MAP.mapId || !MAP.mapData) return;
      MAP.mapData.pins = receivedPins(MAP.mapData.pins, p.pins, MAP.isDM); // DM-only pins never travel
      renderPins();
      break;
    }
    case 'handout:push': {
      if (p.campaignId !== MAP.campaignId || MAP.isDM) return;
      showHandoutOverlay({ title: p.title, content: p.content, imageFileId: p.imageFileId });
      setTimeout(() => guide('player:handout'), 1500);
      break;
    }
    case 'audio:play':
      // dnd-player handles audio:play; dnd-hub ignores it (uses scene soundtrack instead)
      break;
    case 'lights:update': {
      if (p.campaignId !== MAP.campaignId || p.mapId !== MAP.mapId || !MAP.mapData) return;
      MAP.mapData.lights = p.lights || [];
      renderLights();
      renderFog();
      break;
    }
    case 'audio:zone-update': {
      localPublish('dnd-player', EV.AUDIO_ZONE_UPDATE, p); // my sidebar plays the zones
      tellSheetWhereIAm(); // …from where I stand now, not from my next move
      if (p.campaignId !== MAP.campaignId || p.mapId !== MAP.mapId || !MAP.mapData) return;
      MAP.mapData.audioZones = p.audioZones || [];
      renderAudioZones();
      break;
    }
    case 'template:update': {
      if (p.campaignId !== MAP.campaignId) return;
      MAP.templates = p.templates || [];
      renderTemplates();
      return;
    }
    case 'trigger:fired': {
      if (p.campaignId !== MAP.campaignId) return;
      // Show toast for any trigger action that carries a message
      if (p.message) showTriggerToast(p.message);
      // Forward trap/message triggers to MY sheet only. Every Hub at the table also sent a companion copy to every
      // player's sheet, so a trap's damage landed once per screen at the table (rules playtest, 2026-10-04).
      if (p.action === 'trap' || p.action === 'send-message') localPublish('dnd-player', EV.TRIGGER_FIRED, p);
      // Apply trap damage — all hub instances apply it locally;
      // the DM hub additionally persists and re-broadcasts hp:change.
      // A player's token: their sheet applies the damage (temporary HP, the saving throw) and reports back.
      if (p.action === 'trap' && p.damage != null && p.tokenId && MAP.mapData?.tokens && !String(p.tokenId).startsWith('player_')) {
        const tok = MAP.mapData.tokens[p.tokenId];
        if (tok) {
          const trapBefore = tok.hp;
          tok.hp = Math.max(0, (tok.hp || 0) - p.damage);
          floatHp(p.tokenId, trapBefore, tok.hp);
          if (MAP.isDM) {
            serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
            saveHubDm( serverData);
            publishTo(['master'], EV.HP_CHANGE, {
              campaignId: MAP.campaignId, tokenId: p.tokenId, hp: tok.hp, hpMax: tok.hpMax, fromUserId: userId,
            });
          }
          renderTokens();
        }
      }
      break;
    }
    case EV.LEVEL_GRANT: {
      // The DM levelled heroes up (milestone) or gave XP (experience): the campaign record is the authority.
      const camp = serverData?.campaigns?.[p.campaignId];
      if (!camp) return;
      if (p.levels) camp.levels = { ...(camp.levels || {}), ...p.levels };
      if (p.xp) camp.xp = { ...(camp.xp || {}), ...p.xp };
      if (p.campaignId !== MAP.campaignId) return;
      const byXp = rule(camp.settings, 'levelByXp');
      const sums = camp.characterSummaries || {};
      for (const uid of Object.keys({ ...(p.levels || {}), ...(p.xp || {}) })) {
        const s = sums[uid];
        if (!s) continue;
        const to = allowedLevel(camp, uid, s, byXp);
        if (to <= (s.level || 1)) continue;
        if (uid === userId) levelBurst(`Level ${to}!`);
        else showTriggerToast(`${s.name} can reach level ${to}`);
      }
      break;
    }
    case EV.CAMPAIGN_QUERY:
      // A sidebar on this screen loaded and asks what is open (dnd-hub-screens.js answers; no import cycle).
      document.dispatchEvent(new Event('lk:campaign-query'));
      break;
    case EV.LEVELUP_OPEN: {
      // From my own sheet (localPublish): open the level-up scene for my hero.
      if (p.userId !== userId) return;
      await openLevelUp(p.campaignId);
      break;
    }
    case 'trigger:pending': {
      if (p.campaignId !== MAP.campaignId || !MAP.isDM) return;
      // autoFire=true: player detected a non-confirm trigger and asked DM to process it
      if (p.autoFire) {
        const trig = MAP.mapData?.triggers?.find(t => t.id === p.triggerId);
        if (trig && !trig.disabled) fireTrigger(trig, p.tokenId).catch(() => {});
      } else {
        _showPendingTriggerConfirm(p);
      }
      break;
    }
    case 'loot:declined':
      // A hero who won an item could not pay for it any more (dnd-player-main.js): the DM's sidebar logs it.
      if (MAP.isDM && p.campaignId === MAP.campaignId) localPublish('dnd-master', 'loot:declined', p);
      break;
    case EV.LOOT_INTEREST: {
      if (p.campaignId !== MAP.campaignId) break;
      const c = MAP.lootContests[p.contestKey] || {
        tokenId: p.tokenId, shopId: p.shopId,
        itemId: p.itemId, itemName: p.itemName,
        source: p.source, goldCost: p.price || 0,
        interested: [],
      };
      if (!c.interested.find(x => x.userId === p.userId)) {
        c.interested.push({ userId: p.userId, displayName: p.displayName });
      }
      MAP.lootContests[p.contestKey] = c;
      // The DM's sidebar is a separate iframe; players cannot publish to it (no consent → 403), so the DM's Hub hands it on.
      if (MAP.isDM) localPublish('dnd-master', EV.LOOT_INTEREST, p);
      break;
    }
    case EV.LOOT_RESOLVED: {
      if (p.campaignId !== MAP.campaignId) break;
      delete MAP.lootContests[p.contestKey];
      const rollSummary = p.rolls.map(r => r.name + ': ' + r.roll).join(' \xb7 ');
      showTriggerToast('🎲 ' + p.winnerName + ' wins ' + p.itemName + '! (' + rollSummary + ')');
      break;
    }
  }
}

/**
 * Back from the shop to the map, on this screen. There was no way out: the shop stayed until the DM loaded a scene
 * or a map (owner, 2026-10-05). A player leaves on their own screen (their sidebar keeps the shop to buy from); the
 * DM's button closes it for everyone.
 */
export async function leaveShop() {
  if (!MAP._activeShopId) return;
  document.getElementById('lk-shop-exit')?.remove();
  if (MAP._shopAudio) { MAP._shopAudio.pause(); MAP._shopAudio = null; }
  stopShopScene();
  MAP._shopFogHidden = false;
  MAP._activeShopId = null;
  clearTokenCache(); renderTokens(); renderWalls(); renderFog();
}

function showShopExit(wrap) {
  document.getElementById('lk-shop-exit')?.remove();
  const b = document.createElement('button');
  b.id = 'lk-shop-exit';
  b.className = 'map-tool-btn';
  b.style.cssText = 'position:absolute;top:12px;left:12px;z-index:60';
  b.textContent = MAP.isDM ? '✕ Close shop for everyone' : '← Back to the map';
  b.onclick = async () => {
    if (MAP.isDM) await publishTo(['player'], 'shop:close', { type: 'shop:close', campaignId: MAP.campaignId, fromUserId: userId });
    await leaveShop();
  };
  wrap.appendChild(b);
}

function _showPendingTriggerConfirm(p) {
  const trig = MAP.mapData?.triggers?.find(t => t.id === p.triggerId);
  if (trig) showTriggerConfirm(trig, p.tokenId);
}
