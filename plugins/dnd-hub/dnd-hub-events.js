// dnd-hub-events.js — onInit, onEvent, handleMapEvent (realtime event dispatcher)
import { MAP, serverData, userId, showScreen, setServerData, setUserId, effectiveGs, HUB_DM_KEY, hubFogKey } from './dnd-hub-state.js?v=20260502p4';
import { request, storageGet, storageSet, getIdentity, realtimePublish, realtimePublishCompanion, localPublish } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { renderMapBackground } from './dnd-hub-map-bg.js?v=20260502p4';
import { renderGrid } from './dnd-hub-grid.js?v=20260502p4';
import { renderTokens, buildTokenSprite, clearTokenCache } from './dnd-hub-tokens.js?v=20260502p4';
import { computeLocalPlayerLOS } from './dnd-hub-los.js?v=20260502p4';
import { renderFog } from './dnd-hub-fog.js?v=20260502p4';
import { renderWalls } from './dnd-hub-walls.js?v=20260502p4';
import { renderInitiativeHUD, showMapRollToast } from './dnd-hub-initiative.js?v=20260502p4';
import { loadSRD } from './dnd-hub-char.js?v=20260502p4';
import { showPingAnimation } from './dnd-hub-ruler.js?v=20260502p4';
import { checkAutoHit } from './dnd-hub-combat.js?v=20260502p4';
import { animateDice, animateDiceFree } from './dnd-hub-dice.js?v=20260419p1';
import { renderPins, showHandoutOverlay } from './dnd-hub-pins.js?v=20260502p4';
import { renderLights } from './dnd-hub-lights.js?v=20260502p4';
import { renderAudioZones } from './dnd-hub-audio-zones.js?v=20260502p4';
import { renderTriggers, checkTriggers, fireTrigger, showTriggerToast } from './dnd-hub-triggers.js?v=20260502p4';
import { updateSpatialAudio } from './dnd-hub-spatial.js?v=20260502p4';
import { renderTemplates } from './dnd-hub-templates.js?v=20260502p4';

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

  await loadSRD();

  // Legacy migration: if hub-dm doesn't exist yet, copy from old 'hub' key once.
  // Also merge any maps from 'hub' that are missing from 'hub-dm' (fixes VTT maps
  // that were accidentally saved to the wrong key before the storageSet bug was fixed).
  let dmData = await storageGet(HUB_DM_KEY);
  const hubData = await storageGet('hub');
  if (!dmData && hubData) {
    console.log('[dnd-hub] migrating storage: hub → hub-dm');
    await storageSet(HUB_DM_KEY, hubData);
    dmData = hubData;
  } else if (dmData && hubData) {
    let merged = false;
    for (const [cid, camp] of Object.entries(hubData.campaigns || {})) {
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
      await storageSet(HUB_DM_KEY, dmData);
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
  handleMapEvent(payload).catch(e => console.error('[dnd-hub] event handler error:', e));
}

const PRIVILEGED_EVENTS = new Set([
  'hp:change','fog:reveal','fog:reset','map:set','initiative:update',
  'tokens:spawn','walls:update','lights:update','trigger:fired','trigger:pending',
  'token:turn-start','token:conditions','combat:settings',
  'scene:load','pins:update','audio:play','audio:zone-update',
  'shop:open','shop:volume','contest:roll',
]);

// Returns true if the event came from the DM of the campaign.
// Events without fromUserId are allowed through for backward compatibility.
function isDMEvent(p) {
  if (!p.fromUserId) return true;
  return p.fromUserId === serverData?.campaigns?.[p.campaignId]?.dmUserId;
}

export async function handleMapEvent(p) {
  if (!p.type) return;

  // Lazy-reload serverData when the campaign isn't cached yet.
  // This prevents isDMEvent from failing on player hubs that haven't fully loaded.
  if (p.campaignId && !serverData?.campaigns?.[p.campaignId]) {
    setServerData(await storageGet(HUB_DM_KEY));
  }

  // Block privileged events from non-DM senders (requires fromUserId to be stamped)
  if (PRIVILEGED_EVENTS.has(p.type) && !isDMEvent(p)) {
    console.warn('[dnd-hub] blocked privileged event from non-DM:', p.type, p.fromUserId);
    return;
  }

  switch (p.type) {
    case 'map:set': {
      if (p.campaignId !== MAP.campaignId) return;
      // Patch in-memory immediately from the payload to avoid storage read race,
      // then do a background refresh so serverData stays consistent.
      if (p.mapEntry && serverData?.campaigns?.[p.campaignId]) {
        serverData.campaigns[p.campaignId].maps = serverData.campaigns[p.campaignId].maps || {};
        serverData.campaigns[p.campaignId].maps[p.mapId] = p.mapEntry;
        serverData.campaigns[p.campaignId].activeMapId = p.mapId;
      } else {
        setServerData(await storageGet(HUB_DM_KEY));
      }
      MAP.mapId = p.mapId;
      MAP.mapData = serverData?.campaigns?.[p.campaignId]?.maps?.[p.mapId];
      if (MAP.mapData) {
        // Load fog from its own key; fall back to embedded fogState for legacy maps
        const fogFromKey = await storageGet(hubFogKey(p.campaignId, p.mapId));
        MAP.mapData.fogState = fogFromKey ?? MAP.mapData.fogState ?? {};
        await renderMapBackground();
        renderGrid();
        clearTokenCache();
        renderTokens();
        if (!MAP.isDM) computeLocalPlayerLOS();
        // Reset shop state so fog and audio restore normally on map load
        MAP._shopFogHidden = false;
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
      }
      break;
    }
    case 'token:move': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      // Players can only move their own token — but allow moves originating from the DM
      if (p.fromUserId && !MAP.isDM && p.tokenId !== 'player_' + p.fromUserId) {
        const isDMMove = p.fromUserId === serverData?.campaigns?.[p.campaignId]?.dmUserId;
        if (!isDMMove) {
          console.warn('[dnd-hub] blocked token:move for non-owned token');
          return;
        }
      }
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
      // Phase 7: check trigger tiles on any token move — DM fires effects,
      // players check only their own token so the DM hub isn't required.
      if (MAP.isDM || p.tokenId === 'player_' + userId) {
        checkTriggers(p.tokenId, p.x, p.y).catch(() => {});
      }
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
          const fresh = await storageGet(HUB_DM_KEY);
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
      if (p.tokens) p.tokens.forEach(t => { MAP.mapData.tokens[t.id] = t; });
      if (p.deleted) p.deleted.forEach(id => { delete MAP.mapData.tokens[id]; });
      renderTokens();
      if (!MAP.isDM) { computeLocalPlayerLOS(); renderFog(); }
      break;
    }
    case 'character:created': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      // A player just created their character — reload storage so their
      // characterSummary is present, then re-render tokens to spawn them.
      setServerData(await storageGet(HUB_DM_KEY));
      MAP.mapData = serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId];
      if (MAP.mapData) { renderTokens(); }
      break;
    }
    case 'fog:reveal': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      if (p.cells) {
        p.cells.forEach(([key, state]) => { MAP.mapData.fogState[key] = state; });
      }
      renderFog();
      break;
    }
    case 'fog:reset': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      MAP.mapData.fogState = {};
      renderFog();
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
      if (MAP.isDM) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        storageSet(HUB_DM_KEY, serverData);
      }
      renderWalls();
      break;
    }
    case 'hp:change': {
      if (!MAP.mapData?.tokens) return;
      const tokenObj = Object.values(MAP.mapData.tokens).find(t =>
        t.id === p.tokenId || `player_${t.userId}` === p.tokenId
      );
      if (tokenObj) {
        tokenObj.hp = p.hp;
        tokenObj.hpMax = p.hpMax;
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
    case 'initiative:update':
      if (p.campaignId !== MAP.campaignId) return;
      renderInitiativeHUD(p.initiative);
      break;
    case EV.DICE_PHYSICS_ROLL: {
      // A player asked us to run a genuine physics roll and report back the result.
      const { sides, count, mod = 0, label, expression, userId: rollerId, ts, advMode } = p;
      const effectiveCount = advMode ? 2 : count;
      const rolls = await animateDiceFree(sides, effectiveCount);
      let usedRolls = rolls;
      if (advMode) {
        const chosen = advMode === 'adv' ? Math.max(...rolls) : Math.min(...rolls);
        usedRolls = [chosen];
      }
      const total = usedRolls.reduce((a, b) => a + b, 0) + mod;
      const payload = {
        type: EV.DICE_ROLL, userId: rollerId,
        expression: expression || `${count}d${sides}${mod >= 0 ? '+' : ''}${mod}`,
        result: total, rolls, advMode, label, ts,
      };
      _ownPhysicsRollTs.add(ts);
      await realtimePublish(EV.DICE_ROLL, payload);
      // Send result directly back to the player plugin too (for immediate UI update)
      localPublish('dnd-player', EV.DICE_ROLL, payload);
      break;
    }
    case 'dice:roll': {
      showMapRollToast(p);
      // Skip animation if this is our own physics-roll broadcast bouncing back
      if (_ownPhysicsRollTs.has(p.ts)) {
        _ownPhysicsRollTs.delete(p.ts);
        if (p.rollType === 'attack' && MAP.campaignId && MAP.selectedTokens.size > 0) {
          const settings = serverData?.campaigns?.[MAP.campaignId]?.settings;
          if (settings?.autoHit) checkAutoHit(p.result);
        }
        break;
      }
      const parsed = parseDiceExpr(p.expression);
      if (parsed && MAP.mapData) {
        const indiv = splitRolls(parsed.count, parsed.sides, p.result, parsed.mod);
        animateDice(parsed.sides, indiv);
      }
      if (p.rollType === 'attack' && MAP.campaignId && MAP.selectedTokens.size > 0) {
        const settings = serverData?.campaigns?.[MAP.campaignId]?.settings;
        if (settings?.autoHit) checkAutoHit(p.result);
      }
      break;
    }
    case 'map:ping': {
      if (p.campaignId !== MAP.campaignId) return;
      showPingAnimation(p.x, p.y);
      break;
    }
    case 'token:turn-start': {
      if (p.campaignId !== MAP.campaignId || !MAP.mapData) return;
      MAP.activeTurnTokenId = p.tokenId;
      MAP.turnMovedDistance = 0;
      MAP.turnMovedDistances.set(p.tokenId, 0); // reset this token's per-turn distance
      const tok = MAP.mapData.tokens?.[p.tokenId];
      MAP.activeTurnTokenSpeed = tok?.speed || 30;
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
      break;
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
    case 'scene:load': {
      if (p.campaignId !== MAP.campaignId) return;
      // Reset shop state so fog and audio restore when a scene takes over
      MAP._shopFogHidden = false;
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
            aud.play().catch(() => {});
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
      if (MAP._shopAudio) { MAP._shopAudio.pause(); MAP._shopAudio = null; }
      // Replace map background with shop video/image
      if (p.videoFileId && MAP.mapData) {
        MAP.mapData.fileId = p.videoFileId;
        MAP.mapData.mime = p.videoMime || '';
        await renderMapBackground();
      }
      // Clear tokens and walls from display (visual only — mapData unchanged so they restore on map reload)
      if (MAP.layers?.tokens) MAP.layers.tokens.removeChildren();
      if (MAP.layers?.walls)  MAP.layers.walls.removeChildren();
      MAP.tokenSprites = {};
      // Suppress fog
      MAP._activeShopId = p.shopId;
      MAP._shopFogHidden = true;
      renderFog();
      // Play audio track from the same video file
      if (p.videoFileId) {
        try {
          const res = await request('files:getUrl', { fileId: p.videoFileId });
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
        const [r] = await animateDiceFree(20, 1);
        rolls.push({ userId: c.userId, name: c.name, roll: r });
      }
      // Resolve ties with additional rolls
      let maxRoll = Math.max(...rolls.map(r => r.roll));
      let winners = rolls.filter(r => r.roll === maxRoll);
      while (winners.length > 1) {
        for (const w of winners) {
          const [r] = await animateDiceFree(20, 1);
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
      MAP.mapData.pins = p.pins || [];
      renderPins();
      break;
    }
    case 'handout:push': {
      if (p.campaignId !== MAP.campaignId || MAP.isDM) return;
      showHandoutOverlay({ title: p.title, content: p.content });
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
      // Forward trap/message triggers to the player sidebar plugin
      if (p.action === 'trap' || p.action === 'send-message') {
        realtimePublishCompanion('dnd-player', EV.TRIGGER_FIRED, p).catch(() => {});
        localPublish('dnd-player', EV.TRIGGER_FIRED, p);
      }
      // Apply trap damage — all hub instances apply it locally;
      // the DM hub additionally persists and re-broadcasts hp:change.
      if (p.action === 'trap' && p.damage != null && p.tokenId && MAP.mapData?.tokens) {
        const tok = MAP.mapData.tokens[p.tokenId];
        if (tok) {
          tok.hp = Math.max(0, (tok.hp || 0) - p.damage);
          if (MAP.isDM) {
            serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
            storageSet(HUB_DM_KEY, serverData);
            realtimePublish(EV.HP_CHANGE, {
              type: EV.HP_CHANGE, campaignId: MAP.campaignId,
              tokenId: p.tokenId, hp: tok.hp, hpMax: tok.hpMax, fromUserId: userId,
            });
          }
          renderTokens();
        }
      }
      break;
    }
    case 'movement:overage': {
      if (p.campaignId !== MAP.campaignId || !MAP.isDM) return;
      // DM hub shows a warning when any token exceeds its movement speed
      const t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid #f59e0b;color:#fbbf24;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5)';
      t.textContent = `⚠ ${p.tokenName} is attempting to move beyond their speed (${p.distanceMoved}ft of ${p.speed}ft).`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 5000);
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
      // Relay to DM master sidebar — separate iframe, cannot share MAP state
      realtimePublishCompanion('dnd-master', EV.LOOT_INTEREST, p).catch(() => {});
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

function _showPendingTriggerConfirm(p) {
  const existing = document.getElementById('trigger-confirm-overlay');
  if (existing) existing.remove();

  const trig = MAP.mapData?.triggers?.find(t => t.id === p.triggerId);
  if (!trig) return;

  const d = document.createElement('div');
  d.id = 'trigger-confirm-overlay';
  d.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid #f59e0b;color:#fbbf24;padding:14px 18px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.6);text-align:center;min-width:240px';
  d.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px">🪤 Trigger: ${trig.label || trig.type}</div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:12px">Token entered this tile. Fire?</div>
    <div style="display:flex;gap:8px;justify-content:center">
      <button id="tcp-cancel" style="background:transparent;border:1px solid #475569;color:#94a3b8;padding:6px 14px;border-radius:6px;cursor:pointer">Cancel</button>
      <button id="tcp-fire" style="background:#ef4444;border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600">Fire!</button>
    </div>`;
  document.body.appendChild(d);

  document.getElementById('tcp-cancel').onclick = () => d.remove();
  document.getElementById('tcp-fire').onclick = async () => {
    d.remove();
    await fireTrigger(trig, p.tokenId);
  };
  setTimeout(() => { if (d.parentNode) d.remove(); }, 20000);
}
