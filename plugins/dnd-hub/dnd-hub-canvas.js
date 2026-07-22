// dnd-hub-canvas.js — PixiJS app init, layer setup, mouse event wiring
import { MAP, serverData, userId, effectiveGs } from './dnd-hub-state.js?v=20260502p4';
import { storageSet, realtimePublish, debounceStorageSet, genId } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { renderFog, applyBrushAt, saveFogState } from './dnd-hub-fog.js?v=20260502p4';
import { renderGrid } from './dnd-hub-grid.js?v=20260502p4';
import { renderWalls, wallPx, pxToCell, wouldCrossWall } from './dnd-hub-walls.js?v=20260502p4';
import { renderTokens } from './dnd-hub-tokens.js?v=20260502p4';
import { computeLocalPlayerLOS } from './dnd-hub-los.js?v=20260502p4';
import { showPingAnimation, updateRuler, clearRuler } from './dnd-hub-ruler.js?v=20260502p4';
import { showContextMenu, destroyContextMenu } from './dnd-hub-tokens.js?v=20260502p4';
import { showPinDialog } from './dnd-hub-pins.js?v=20260502p4';
import { renderLights, saveLightsAndBroadcast } from './dnd-hub-lights.js?v=20260502p4';
import { renderAudioZones, saveZonesAndBroadcast, showZoneDialog, showZoneContextMenu } from './dnd-hub-audio-zones.js?v=20260502p4';
import { renderTriggers, showTriggerDialog, saveTriggersAndBroadcast } from './dnd-hub-triggers.js?v=20260502p4';
import { startTemplateDraw, updateTemplatePreview, finishTemplateDraw, cancelTemplateDraw, renderTemplates, removeTemplate } from './dnd-hub-templates.js?v=20260502p4';
import { saveHubDm } from './dnd-hub-storage.js?v=20260502p4';

export async function initPixiApp() {
  const wrap = document.getElementById('map-canvas-wrap');
  if (!wrap) return;

  const app = new PIXI.Application();
  await app.init({
    width: wrap.clientWidth || 800,
    height: wrap.clientHeight || 600,
    backgroundColor: 0x0d0d0d,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  wrap.appendChild(app.canvas);
  MAP.app = app;

  const layers = {
    bg: new PIXI.Container(), grid: new PIXI.Container(),
    lights: new PIXI.Container(),
    tokens: new PIXI.Container(), fog: new PIXI.Container(),
    walls: new PIXI.Container(), ui: new PIXI.Container(),
  };
  MAP.layers = layers;
  app.stage.addChild(layers.bg, layers.grid, layers.lights, layers.tokens, layers.fog, layers.walls, layers.ui);
  app.stage.eventMode = 'static';
  app.stage.hitArea = new PIXI.Rectangle(0, 0, 10000, 10000);

  MAP.resizeObserver = new ResizeObserver(() => {
    app.renderer.resize(wrap.clientWidth, wrap.clientHeight);
    renderGrid();
    renderFog();
  });
  MAP.resizeObserver.observe(wrap);

  // ── Zoom to cursor (wheel) ─────────────────────────────────────────────
  app.canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    setZoom(MAP.zoom + (e.deltaY < 0 ? 0.1 : -0.1), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // ── Pan (middle-mouse drag — always available) ─────────────────────────
  let panStart = null;
  app.canvas.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    panStart = { x: e.clientX - MAP.panX, y: e.clientY - MAP.panY };
  });
  app.canvas.addEventListener('mousemove', e => {
    if (!panStart) return;
    MAP.panX = e.clientX - panStart.x;
    MAP.panY = e.clientY - panStart.y;
    MAP.app.stage.position.set(MAP.panX, MAP.panY);
    renderGrid();
    // Fog is screen-space Canvas2D — must re-render on pan so it doesn't drift.
    // Throttle to one redraw per animation frame to cap GPU uploads at 60fps.
    if (!MAP.fogThrottle) {
      MAP.fogThrottle = requestAnimationFrame(() => { MAP.fogThrottle = null; renderFog(); });
    }
  });
  app.canvas.addEventListener('mouseup',    e => { if (e.button === 1) panStart = null; });
  app.canvas.addEventListener('mouseleave', () => { panStart = null; });

  // ── Touch: pinch-zoom + two-finger pan ────────────────────────────────
  let _touches = {};
  let _pinchDist = null;
  let _touchPanOrigin = null;
  app.canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const t of e.changedTouches) _touches[t.identifier] = { x: t.clientX, y: t.clientY };
    const ids = Object.keys(_touches);
    if (ids.length === 2) {
      const a = _touches[ids[0]], b = _touches[ids[1]];
      _pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
      _touchPanOrigin = { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, px: MAP.panX, py: MAP.panY };
    }
  }, { passive: false });
  app.canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) _touches[t.identifier] = { x: t.clientX, y: t.clientY };
    const ids = Object.keys(_touches);
    if (ids.length === 2 && _pinchDist !== null && _touchPanOrigin !== null) {
      const a = _touches[ids[0]], b = _touches[ids[1]];
      const newDist = Math.hypot(b.x - a.x, b.y - a.y);
      const scale = newDist / _pinchDist;
      const rect = app.canvas.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      setZoom(MAP.zoom * scale, mx, my);
      _pinchDist = newDist;
      // Two-finger pan
      const omx = _touchPanOrigin.mx - rect.left, omy = _touchPanOrigin.my - rect.top;
      MAP.panX = _touchPanOrigin.px + (mx - omx);
      MAP.panY = _touchPanOrigin.py + (my - omy);
      MAP.app.stage.position.set(MAP.panX, MAP.panY);
      renderGrid();
      if (!MAP.fogThrottle) MAP.fogThrottle = requestAnimationFrame(() => { MAP.fogThrottle = null; renderFog(); });
    }
  }, { passive: false });
  app.canvas.addEventListener('touchend', e => {
    for (const t of e.changedTouches) delete _touches[t.identifier];
    if (Object.keys(_touches).length < 2) { _pinchDist = null; _touchPanOrigin = null; }
  }, { passive: false });

  // ── Select tool — drag selected light ─────────────────────────────────
  app.canvas.addEventListener('mousemove', e => {
    if (!MAP.lightDragState || MAP.activeTool !== 'select' || !MAP.mapData) return;
    if (e.buttons !== 1) return; // only while left button held
    const rect = app.canvas.getBoundingClientRect();
    const z = MAP.zoom;
    const wx = (e.clientX - rect.left - MAP.panX) / z;
    const wy = (e.clientY - rect.top  - MAP.panY) / z;
    const light = (MAP.mapData.lights || []).find(l => l.id === MAP.lightDragState.lightId);
    if (!light) return;
    light.x = wx; light.y = wy;
    renderLights();
  });

  app.canvas.addEventListener('mouseup', async () => {
    if (!MAP.lightDragState || MAP.activeTool !== 'select') return;
    MAP.lightDragState = null;
    await saveLightsAndBroadcast();
  });

  // ── Select tool — drag selected audio zone ────────────────────────────
  app.canvas.addEventListener('mousemove', e => {
    if (!MAP.audioZoneDragState || MAP.activeTool !== 'select' || !MAP.mapData) return;
    if (e.buttons !== 1) return;
    const rect = app.canvas.getBoundingClientRect();
    const z = MAP.zoom;
    const wx = (e.clientX - rect.left - MAP.panX) / z;
    const wy = (e.clientY - rect.top  - MAP.panY) / z;
    const ds = MAP.audioZoneDragState;
    const zone = (MAP.mapData.audioZones || []).find(z => z.id === ds.zoneId);
    if (!zone) return;
    const gs = effectiveGs(MAP.mapData);
    const ox = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
    const oy = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
    if (ds.mode === 'move') {
      zone.x = (wx - ox) / gs;
      zone.y = (wy - oy) / gs;
    } else if (ds.mode === 'radius') {
      const cx = zone.x * gs + ox;
      const cy = zone.y * gs + oy;
      zone.radius = Math.max(1, Math.hypot(wx - cx, wy - cy) / gs);
    }
    renderAudioZones();
  });

  app.canvas.addEventListener('mouseup', async () => {
    if (!MAP.audioZoneDragState || MAP.activeTool !== 'select') return;
    MAP.audioZoneDragState = null;
    await saveZonesAndBroadcast();
  });

  if (MAP.isDM) {
    // ── Mouse coord display ────────────────────────────────────────────────
    app.canvas.addEventListener('mousemove', e => {
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const gs = MAP.mapData ? effectiveGs(MAP.mapData) : 40;
      const ox = MAP._bgOffset?.x ?? 0, oy = MAP._bgOffset?.y ?? 0;
      const x = Math.floor(((e.clientX - rect.left - MAP.panX) / z - ox) / gs);
      const y = Math.floor(((e.clientY - rect.top  - MAP.panY) / z - oy) / gs);
      const el = document.getElementById('map-coord-display');
      if (el) el.textContent = `[${x},${y}]`;
    });

    // ── Fog brush ──────────────────────────────────────────────────────────
    let brushDown = false;
    app.canvas.addEventListener('mousedown', e => {
      if (MAP.activeTool !== 'brush-reveal' && MAP.activeTool !== 'brush-hide') return;
      brushDown = true; applyBrushAt(e);
    });
    app.canvas.addEventListener('mousemove', e => { if (brushDown) applyBrushAt(e); });
    app.canvas.addEventListener('mouseup',    () => { if (brushDown) { brushDown = false; saveFogState(); } });
    app.canvas.addEventListener('mouseleave', () => { if (brushDown) { brushDown = false; saveFogState(); } });

    // ── Wall / door drawing ────────────────────────────────────────────────
    let drawStart = null, drawPreview = null;

    app.canvas.addEventListener('mousedown', e => {
      const tool = MAP.activeTool;
      if (tool !== 'wall' && tool !== 'door') return;
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      drawStart = { x: (e.clientX - rect.left - MAP.panX) / z, y: (e.clientY - rect.top - MAP.panY) / z };
    });

    app.canvas.addEventListener('mousemove', e => {
      if (!drawStart) return;
      const tool = MAP.activeTool;
      if (tool !== 'wall' && tool !== 'door') return;
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const ex = (e.clientX - rect.left - MAP.panX) / z, ey = (e.clientY - rect.top - MAP.panY) / z;
      if (drawPreview) MAP.layers.ui.removeChild(drawPreview);
      const pg = new PIXI.Graphics();
      pg.moveTo(drawStart.x, drawStart.y).lineTo(ex, ey)
        .stroke({ color: MAP.activeTool === 'wall' ? 0xff6b35 : 0xf59e0b, width: 2, alpha: 0.7 });
      MAP.layers.ui.addChild(pg);
      drawPreview = pg;
    });

    app.canvas.addEventListener('mouseup', async e => {
      if (!drawStart) return;
      const tool = MAP.activeTool;
      if (tool !== 'wall' && tool !== 'door') { drawStart = null; return; }
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const ex = (e.clientX - rect.left - MAP.panX) / z, ey = (e.clientY - rect.top - MAP.panY) / z;
      if (drawPreview) { MAP.layers.ui.removeChild(drawPreview); drawPreview = null; }

      const dx = ex - drawStart.x, dy = ey - drawStart.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10) { drawStart = null; return; }

      if (tool === 'wall') {
        if (!MAP.mapData.walls) MAP.mapData.walls = [];
        const id = genId();
        if (MAP.mapData.wallFmt === 'cell') {
          const a = pxToCell(drawStart.x, drawStart.y), b = pxToCell(ex, ey);
          MAP.mapData.walls.push({ id, cx1: a.cx, cy1: a.cy, cx2: b.cx, cy2: b.cy });
        } else {
          MAP.mapData.walls.push({ id, x1: drawStart.x, y1: drawStart.y, x2: ex, y2: ey });
        }
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        await saveHubDm( serverData);
        renderWalls();
        await realtimePublish(EV.WALLS_UPDATE, { type: EV.WALLS_UPDATE, campaignId: MAP.campaignId, walls: MAP.mapData.walls, fromUserId: userId });
      } else if (tool === 'door') {
        const doorId = genId();
        if (!MAP.mapData.doors) MAP.mapData.doors = {};
        if (MAP.mapData.wallFmt === 'cell') {
          const a = pxToCell(drawStart.x, drawStart.y), b = pxToCell(ex, ey);
          MAP.mapData.doors[doorId] = { id: doorId, cx1: a.cx, cy1: a.cy, cx2: b.cx, cy2: b.cy, state: 'closed' };
        } else {
          MAP.mapData.doors[doorId] = { id: doorId, x1: drawStart.x, y1: drawStart.y, x2: ex, y2: ey, state: 'closed' };
        }
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        await saveHubDm( serverData);
        renderWalls();
        await realtimePublish(EV.DOOR_STATE, { type: EV.DOOR_STATE, campaignId: MAP.campaignId, doors: MAP.mapData.doors, fromUserId: userId });
      }
      drawStart = null;
    });

    // ── Select tool — click to highlight wall/door ─────────────────────────
    app.canvas.addEventListener('mousedown', e => {
      if (MAP.activeTool !== 'select' || !MAP.mapData) return;
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const wx = (e.clientX - rect.left - MAP.panX) / z;
      const wy = (e.clientY - rect.top  - MAP.panY) / z;
      const HIT = 8;
      let hitWall = null, hitDoor = null;
      (MAP.mapData.walls || []).forEach(w => {
        const p = wallPx(w);
        if (distToSegment(wx, wy, p.x1, p.y1, p.x2, p.y2) < HIT) hitWall = w.id;
      });
      Object.values(MAP.mapData.doors || {}).forEach(d => {
        const p = wallPx(d);
        if (distToSegment(wx, wy, p.x1, p.y1, p.x2, p.y2) < HIT) hitDoor = d.id;
      });
      MAP.selectedWall = hitWall;
      MAP.selectedDoor = hitDoor;
      renderWalls();

      // Check for light source hit (DM only)
      if (MAP.isDM && MAP.mapData.lights) {
        const HIT_LIGHT = 12;
        const hitLight = MAP.mapData.lights.find(
          l => Math.hypot(wx - l.x, wy - l.y) < HIT_LIGHT
        );
        MAP.activeLightId = hitLight?.id ?? null;
        MAP.lightDragState = hitLight
          ? { mode: 'move', lightId: hitLight.id }
          : null;
        renderLights();
      }

      // Check for audio zone hit (DM only)
      if (MAP.isDM && MAP.mapData.audioZones) {
        const gs  = effectiveGs(MAP.mapData);
        const ox  = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
        const oy  = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
        let hitZone = null, zoneMode = 'move';
        for (const zone of MAP.mapData.audioZones) {
          const cx  = zone.x * gs + ox;
          const cy  = zone.y * gs + oy;
          const r   = zone.radius * gs;
          const dist = Math.hypot(wx - cx, wy - cy);
          if (dist < r * 0.25) { hitZone = zone; zoneMode = 'move'; break; }
          if (Math.abs(dist - r) < 12) { hitZone = zone; zoneMode = 'radius'; break; }
        }
        MAP.activeAudioZoneId = hitZone?.id ?? null;
        MAP.audioZoneDragState = hitZone ? { mode: zoneMode, zoneId: hitZone.id } : null;
        renderAudioZones();
        if (hitZone && e.detail >= 2) {
          MAP.audioZoneDragState = null;
          showZoneDialog(wx, wy, hitZone);
        }
      }

      // Check for trigger tile hit (DM only)
      if (MAP.isDM && MAP.mapData.triggers) {
        const gs  = effectiveGs(MAP.mapData);
        const ox  = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
        const oy  = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
        const clickCx = Math.floor((wx - ox) / gs);
        const clickCy = Math.floor((wy - oy) / gs);
        const hitTrig = MAP.mapData.triggers.find(t => t.cx === clickCx && t.cy === clickCy);
        MAP.activeTriggerId = hitTrig?.id ?? null;
        renderTriggers();
        if (hitTrig && e.detail >= 2) showTriggerDialog(clickCx, clickCy, hitTrig);
      }
    });

    // ── Pin tool — DM click places a new pin ──────────────────────────────
    app.canvas.addEventListener('mousedown', e => {
      if (MAP.activeTool !== 'pin' || !MAP.mapData) return;
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const wx = (e.clientX - rect.left - MAP.panX) / z;
      const wy = (e.clientY - rect.top  - MAP.panY) / z;
      showPinDialog(wx, wy);
    });

    // ── Light tool — click to place, drag to set radius ───────────────────
    app.canvas.addEventListener('mousedown', e => {
      if (MAP.activeTool !== 'light' || !MAP.mapData) return;
      e.preventDefault();
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const wx = (e.clientX - rect.left - MAP.panX) / z;
      const wy = (e.clientY - rect.top  - MAP.panY) / z;

      // Check if clicking near an existing light center
      const HIT = 15;
      const existingLight = (MAP.mapData.lights || []).find(
        l => Math.hypot(wx - l.x, wy - l.y) < HIT
      );

      if (existingLight) {
        MAP.activeLightId = existingLight.id;
        MAP.lightDragState = { mode: 'move', lightId: existingLight.id };
      } else {
        // Place new light with a small default radius, then let user drag to set it
        const id = `light_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newLight = {
          id, x: wx, y: wy,
          radius: 30, color: 0xfff5cc, intensity: 1,
          flicker: false, tokenId: null,
        };
        if (!MAP.mapData.lights) MAP.mapData.lights = [];
        MAP.mapData.lights.push(newLight);
        MAP.activeLightId = id;
        MAP.lightDragState = { mode: 'radius', lightId: id, originX: wx, originY: wy };
        renderLights();
      }
    });

    app.canvas.addEventListener('mousemove', e => {
      if (!MAP.lightDragState || MAP.activeTool !== 'light' || !MAP.mapData) return;
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const wx = (e.clientX - rect.left - MAP.panX) / z;
      const wy = (e.clientY - rect.top  - MAP.panY) / z;
      const ds = MAP.lightDragState;
      const light = (MAP.mapData.lights || []).find(l => l.id === ds.lightId);
      if (!light) return;

      if (ds.mode === 'radius') {
        light.radius = Math.max(10, Math.hypot(wx - ds.originX, wy - ds.originY));
      } else if (ds.mode === 'move') {
        light.x = wx; light.y = wy;
      }
      renderLights();
    });

    app.canvas.addEventListener('mouseup', async e => {
      if (!MAP.lightDragState || MAP.activeTool !== 'light') return;
      MAP.lightDragState = null;
      await saveLightsAndBroadcast();
      renderLights();
    });

    // ── Speaker tool — click to place/edit audio zone ─────────────────────
    app.canvas.addEventListener('mousedown', e => {
      if (MAP.activeTool !== 'speaker' || !MAP.mapData) return;
      e.preventDefault();
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const wx = (e.clientX - rect.left - MAP.panX) / z;
      const wy = (e.clientY - rect.top  - MAP.panY) / z;
      const gs  = effectiveGs(MAP.mapData);
      const ox  = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
      const oy  = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
      const HIT = 20;
      const existingZone = (MAP.mapData.audioZones || []).find(z => {
        const cx = z.x * gs + ox, cy = z.y * gs + oy;
        return Math.hypot(wx - cx, wy - cy) < HIT;
      });
      showZoneDialog(wx, wy, existingZone || null);
    });

    // ── Trap tool — click to place/edit trigger tile ──────────────────────
    app.canvas.addEventListener('mousedown', e => {
      if (MAP.activeTool !== 'trap' || !MAP.mapData) return;
      e.preventDefault();
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const wx = (e.clientX - rect.left - MAP.panX) / z;
      const wy = (e.clientY - rect.top  - MAP.panY) / z;
      const gs  = effectiveGs(MAP.mapData);
      const ox  = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
      const oy  = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
      const cx  = Math.floor((wx - ox) / gs);
      const cy  = Math.floor((wy - oy) / gs);
      const existingTrig = (MAP.mapData.triggers || []).find(t => t.cx === cx && t.cy === cy);
      showTriggerDialog(cx, cy, existingTrig || null);
    });

    // ── Context menu — right-click on audio zone to edit/remove (DM only) ──
    app.canvas.addEventListener('contextmenu', e => {
      if (!MAP.isDM || !MAP.mapData?.audioZones?.length) return;
      e.preventDefault();
      const rect = app.canvas.getBoundingClientRect();
      const z = MAP.zoom;
      const wx = (e.clientX - rect.left - MAP.panX) / z;
      const wy = (e.clientY - rect.top  - MAP.panY) / z;
      const gs  = effectiveGs(MAP.mapData);
      const ox  = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
      const oy  = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
      let hitZone = null;
      for (const zone of MAP.mapData.audioZones) {
        const cx = zone.x * gs + ox;
        const cy = zone.y * gs + oy;
        const r  = zone.radius * gs;
        if (Math.hypot(wx - cx, wy - cy) <= r) { hitZone = zone; break; }
      }
      if (hitZone) { showZoneContextMenu(e.clientX, e.clientY, hitZone); e.stopImmediatePropagation(); }
    });

    // ── Template tool — click-drag to draw (DM only via toolbar) ─────────
    app.canvas.addEventListener('mousedown', e => {
      if (MAP.activeTool !== 'template' || !MAP.mapData || e.button !== 0) return;
      e.preventDefault();
      const rect = app.canvas.getBoundingClientRect();
      const wx = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
      const wy = (e.clientY - rect.top  - MAP.panY) / MAP.zoom;
      startTemplateDraw(wx, wy);
    });
    app.canvas.addEventListener('mousemove', e => {
      if (MAP.activeTool !== 'template' || !MAP.mapData || !(e.buttons & 1)) return;
      const rect = app.canvas.getBoundingClientRect();
      const wx = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
      const wy = (e.clientY - rect.top  - MAP.panY) / MAP.zoom;
      updateTemplatePreview(wx, wy);
    });
    app.canvas.addEventListener('mouseup', async e => {
      if (MAP.activeTool !== 'template' || !MAP.mapData || e.button !== 0) return;
      const rect = app.canvas.getBoundingClientRect();
      const wx = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
      const wy = (e.clientY - rect.top  - MAP.panY) / MAP.zoom;
      await finishTemplateDraw(wx, wy);
    });

  }

  // ── Alt+click map ping ─────────────────────────────────────────────────
  app.canvas.addEventListener('mousedown', e => {
    if (!e.altKey || MAP.activeTool !== 'select') return;
    e.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
    const worldY = (e.clientY - rect.top  - MAP.panY) / MAP.zoom;
    realtimePublish(EV.MAP_PING, {
      type: EV.MAP_PING, campaignId: MAP.campaignId,
      x: worldX, y: worldY, fromUserId: userId,
    });
    showPingAnimation(worldX, worldY);
  });

  // ── Place-token mode (player only) ────────────────────────────────────
  window._togglePlaceTokenMode = () => {
    const btn = document.getElementById('btn-place-token');
    if (MAP.activeTool === 'place-token') {
      MAP.activeTool = 'select';
      app.canvas.style.cursor = '';
      if (btn) { btn.style.background = ''; btn.style.color = ''; }
    } else {
      MAP.activeTool = 'place-token';
      app.canvas.style.cursor = 'crosshair';
      if (btn) { btn.style.background = 'rgba(96,165,250,.2)'; btn.style.color = '#60a5fa'; }
    }
  };
  app.canvas.addEventListener('mousedown', async e => {
    if (MAP.activeTool !== 'place-token' || !MAP.mapData || e.button !== 0 || MAP.isDM) return;
    e.preventDefault(); e.stopPropagation();
    const rect = app.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
    const wy = (e.clientY - rect.top  - MAP.panY) / MAP.zoom;
    const gs = effectiveGs(MAP.mapData);
    const ox = (MAP._bgOffset?.x ?? 0) + (MAP.mapData?.gridOffsetX ?? 0);
    const oy = (MAP._bgOffset?.y ?? 0) + (MAP.mapData?.gridOffsetY ?? 0);
    const snappedX = Math.round((wx - ox) / gs) * gs + gs / 2 + ox;
    const snappedY = Math.round((wy - oy) / gs) * gs + gs / 2 + oy;
    const tokenId = 'player_' + userId;
    if (MAP.mapData.tokens?.[tokenId]) {
      MAP.mapData.tokens[tokenId].x = snappedX;
      MAP.mapData.tokens[tokenId].y = snappedY;
      serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
      await saveHubDm( serverData);
      await realtimePublish(EV.TOKEN_MOVE, { type: EV.TOKEN_MOVE, campaignId: MAP.campaignId, tokenId, x: snappedX, y: snappedY, fromUserId: userId });
      renderTokens();
    }
    // Exit placement mode after placing
    window._togglePlaceTokenMode();
  });

  // ── Ruler update on mousemove ──────────────────────────────────────────
  app.canvas.addEventListener('mousemove', e => {
    if (!MAP.rulerActive) return;
    const rect = app.canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
    const worldY = (e.clientY - rect.top  - MAP.panY) / MAP.zoom;
    updateRuler(worldX, worldY);
  });

  // ── Unified contextmenu: token right-click → context menu; door right-click → cycle state ──
  app.canvas.addEventListener('contextmenu', async e => {
    e.preventDefault();
    if (MAP.activeTool !== 'select' && MAP.activeTool !== 'door') return;
    if (!MAP.mapData) return;

    const rect = app.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
    const wy = (e.clientY - rect.top  - MAP.panY) / MAP.zoom;
    const gs = effectiveGs(MAP.mapData);

    // Check for token hit (any user can right-click their own token; DM can right-click any)
    for (const [tokenId, spr] of Object.entries(MAP.tokenSprites)) {
      const dx = wx - spr.x, dy = wy - spr.y;
      if (Math.sqrt(dx * dx + dy * dy) < gs * 0.45) {
        const token = MAP.mapData.tokens[tokenId];
        if (token) { showContextMenu(token, e.clientX, e.clientY); return; }
      }
    }

    // Door toggle — DM cycles closed→open→locked; players toggle closed↔open if adjacent
    {
      const DM_STATES = ['closed', 'open', 'locked'];
      const gs = effectiveGs(MAP.mapData);
      let changed = false;
      Object.values(MAP.mapData.doors || {}).forEach(d => {
        if (d.isWindow) return;
        const p = wallPx(d);
        if (Math.hypot(wx - (p.x1 + p.x2) / 2, wy - (p.y1 + p.y2) / 2) < 12) {
          if (MAP.isDM) {
            d.state = DM_STATES[(DM_STATES.indexOf(d.state) + 1) % DM_STATES.length];
            changed = true;
          } else if (d.state !== 'locked') {
            // Players must be within 1.5 cells of the door
            const playerToken = MAP.mapData.tokens?.['player_' + userId];
            if (!playerToken) return;
            const mid = { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 };
            if (Math.hypot(playerToken.x - mid.x, playerToken.y - mid.y) > gs * 1.5) return;
            d.state = d.state === 'open' ? 'closed' : 'open';
            changed = true;
          }
        }
      });
      if (changed) {
        // Only DM writes to storage — player hubs receive the event and apply locally
        if (MAP.isDM) {
          serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
          await saveHubDm( serverData);
        }
        renderWalls();
        await realtimePublish(EV.DOOR_STATE, { type: EV.DOOR_STATE, campaignId: MAP.campaignId, doors: MAP.mapData.doors, fromUserId: userId });
        return;
      }
    }

    // Template placement submenu — all users
    _showTemplateContextMenu(e.clientX, e.clientY, wx, wy);
  });

  // ── Clear multi-select when clicking empty space ───────────────────────
  app.canvas.addEventListener('mousedown', e => {
    if (e.shiftKey || MAP.activeTool !== 'select' || !MAP.isDM || !MAP.mapData) return;
    if (e.button !== 0) return;
    const rect = app.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
    const wy = (e.clientY - rect.top  - MAP.panY) / MAP.zoom;
    const gs = effectiveGs(MAP.mapData);
    const hitToken = Object.entries(MAP.tokenSprites).some(([, spr]) =>
      Math.sqrt((wx - spr.x) ** 2 + (wy - spr.y) ** 2) < gs * 0.45
    );
    if (!hitToken && MAP.selectedTokens.size > 0) {
      MAP.selectedTokens.clear();
      renderTokens();
    }
  });
}

export function initKeyboardHandlers() {
  window.addEventListener('keydown', async e => {
    if (e.key === 'Escape') { clearRuler(); destroyContextMenu(); return; }
    if (e.key === '?') { _showShortcutsModal(); return; }
    if (!MAP.mapData) return;

    // ── WASD / Arrow key token movement ──────────────────────────────────
    const MOVE_KEYS = { w: [0,-1], s: [0,1], a: [-1,0], d: [1,0],
      ArrowUp: [0,-1], ArrowDown: [0,1], ArrowLeft: [-1,0], ArrowRight: [1,0] };
    const dir = MOVE_KEYS[e.key];
    if (dir && MAP.activeTool === 'select') {
      // Only move a token we own (or any token if DM)
      const tokenId = MAP.selectedToken;
      if (!tokenId) return;
      const token = MAP.mapData.tokens?.[tokenId];
      if (!token) return;
      if (!MAP.isDM && token.userId !== userId) return;

      e.preventDefault();
      const gs = effectiveGs(MAP.mapData);
      const newX = token.x + dir[0] * gs;
      const newY = token.y + dir[1] * gs;
      if (wouldCrossWall(token.x, token.y, newX, newY)) return;
      const newFacing = Math.round(Math.atan2(dir[1], dir[0]) * 180 / Math.PI);
      token.facing = newFacing;
      token.x = newX; token.y = newY;

      // Track per-token movement this turn and warn if speed exceeded
      const movedSoFar = (MAP.turnMovedDistances.get(tokenId) || 0) + 5;
      MAP.turnMovedDistances.set(tokenId, movedSoFar);
      const tokenSpeed = token.speed || 30;
      if (movedSoFar > tokenSpeed) {
        // Show toast on this hub (player sees it directly)
        const toastEl = document.createElement('div');
        toastEl.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid #f59e0b;color:#fbbf24;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5)';
        toastEl.textContent = `Movement exceeds your speed for this turn (${movedSoFar}ft of ${tokenSpeed}ft used).`;
        document.body.appendChild(toastEl);
        setTimeout(() => toastEl.remove(), 4000);
        // Notify all hubs so DM sees who is overmoving
        realtimePublish(EV.MOVEMENT_OVERAGE, {
          type: EV.MOVEMENT_OVERAGE, campaignId: MAP.campaignId,
          tokenId, tokenName: token.name, distanceMoved: movedSoFar, speed: tokenSpeed, fromUserId: userId,
        });
      }

      const spr = MAP.tokenSprites[tokenId];
      if (spr) { spr.x = newX; spr.y = newY; }

      serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
      saveHubDm( serverData);

      renderTokens(); // incremental — rebuilds only the changed token sprite

      if (!MAP.isDM) { computeLocalPlayerLOS(); renderFog(); }

      // Debounce the broadcast — keyboard auto-repeat fires ~10×/sec
      MAP._wasdPendingMove = { tokenId, x: newX, y: newY, facing: newFacing };
      if (!MAP._wasdBroadcastTimer) {
        MAP._wasdBroadcastTimer = setTimeout(() => {
          MAP._wasdBroadcastTimer = null;
          const m = MAP._wasdPendingMove;
          if (m) {
            MAP._wasdPendingMove = null;
            realtimePublish(EV.TOKEN_MOVE, {
              type: EV.TOKEN_MOVE, campaignId: MAP.campaignId,
              tokenId: m.tokenId, x: m.x, y: m.y, facing: m.facing, fromUserId: userId,
            });
          }
        }, 80);
      }
      return;
    }

    // ── Delete / Backspace — remove selected wall or door ─────────────────
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;

    if (MAP.selectedWall) {
      MAP.mapData.walls = (MAP.mapData.walls || []).filter(w => w.id !== MAP.selectedWall);
      MAP.selectedWall = null;
      if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        await saveHubDm( serverData);
      }
      renderWalls();
      await realtimePublish(EV.WALLS_UPDATE, { type: EV.WALLS_UPDATE, campaignId: MAP.campaignId, walls: MAP.mapData.walls, fromUserId: userId });
    } else if (MAP.selectedDoor) {
      const doors = { ...(MAP.mapData.doors || {}) };
      delete doors[MAP.selectedDoor];
      MAP.mapData.doors = doors;
      MAP.selectedDoor = null;
      if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        await saveHubDm( serverData);
      }
      renderWalls();
      await realtimePublish(EV.DOOR_STATE, { type: EV.DOOR_STATE, campaignId: MAP.campaignId, doors: MAP.mapData.doors, fromUserId: userId });
    } else if (MAP.activeLightId && MAP.isDM && MAP.mapData) {
      MAP.mapData.lights = (MAP.mapData.lights || []).filter(l => l.id !== MAP.activeLightId);
      MAP.activeLightId = null;
      MAP.lightDragState = null;
      if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
      }
      await saveLightsAndBroadcast();
      renderLights();
    } else if (MAP.activeAudioZoneId && MAP.isDM && MAP.mapData) {
      MAP.mapData.audioZones = (MAP.mapData.audioZones || []).filter(z => z.id !== MAP.activeAudioZoneId);
      MAP.activeAudioZoneId = null;
      MAP.audioZoneDragState = null;
      if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
      }
      await saveZonesAndBroadcast();
    } else if (MAP.activeTriggerId && MAP.isDM && MAP.mapData) {
      MAP.mapData.triggers = (MAP.mapData.triggers || []).filter(t => t.id !== MAP.activeTriggerId);
      MAP.activeTriggerId = null;
      if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
      }
      await saveTriggersAndBroadcast();
    } else if (MAP.activeTemplateId && MAP.mapData) {
      await removeTemplate(MAP.activeTemplateId);
      MAP.activeTemplateId = null;
    }
  });
}

function _showShortcutsModal() {
  document.getElementById('kb-modal')?.remove();
  const SHORTCUTS = [
    ['W / A / S / D  or  ↑↓←→', 'Move selected token one cell'],
    ['Shift+Click token',         'Multi-select token (DM only)'],
    ['Alt+Click map',             'Ping location for all players'],
    ['Right-click token',         'Open token context menu'],
    ['Middle-drag',               'Pan map'],
    ['Scroll wheel',              'Zoom in / out'],
    ['Delete / Backspace',        'Delete selected wall / door / light / template'],
    ['Esc',                       'Cancel ruler or close menu'],
    ['?',                         'Show this keyboard reference'],
  ];
  const modal = document.createElement('div');
  modal.id = 'kb-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,sans-serif';
  modal.innerHTML =
    '<div style="background:#1a1610;border:1px solid rgba(212,175,55,.4);border-radius:10px;padding:20px;' +
    'max-width:400px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,.8)">' +
      '<div style="font-size:13px;font-weight:800;color:#d4af37;margin-bottom:12px;border-bottom:1px solid rgba(212,175,55,.25);padding-bottom:8px">&#x2328; Keyboard Shortcuts</div>' +
      SHORTCUTS.map(([k, v]) =>
        '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<kbd style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:4px;' +
            'padding:2px 7px;font-family:monospace;font-size:10px;color:#fff;white-space:nowrap;flex-shrink:0">' + k + '</kbd>' +
          '<span style="font-size:11px;color:rgba(255,255,255,.7);text-align:right;margin-left:12px">' + v + '</span>' +
        '</div>'
      ).join('') +
      '<button onclick="document.getElementById(\'kb-modal\').remove()" ' +
        'style="margin-top:14px;width:100%;padding:8px;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.3);border-radius:6px;color:#d4af37;font-size:11px;font-weight:700;cursor:pointer">Close</button>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function _showTemplateContextMenu(clientX, clientY, wx, wy) {
  document.getElementById('tmpl-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'tmpl-ctx-menu';
  menu.style.cssText = `position:fixed;left:${clientX}px;top:${clientY}px;` +
    'background:#1a1a2e;border:1px solid rgba(212,175,55,.4);border-radius:8px;' +
    'padding:6px;z-index:9100;min-width:160px;box-shadow:0 6px 24px rgba(0,0,0,.6)';
  menu.innerHTML =
    '<div style="font-size:10px;color:#d4af37;font-weight:700;padding:4px 6px 6px;' +
      'border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:4px">Place Template</div>' +
    ['circle','cone','line','cube'].map(t =>
      `<div onclick="_placeTemplateAt('${t}',${wx},${wy})" ` +
      `style="padding:5px 8px;font-size:11px;color:#fff;cursor:pointer;border-radius:4px;` +
      `display:flex;align-items:center;gap:6px" ` +
      `onmouseover="this.style.background='rgba(255,255,255,.08)'" ` +
      `onmouseout="this.style.background=''">${{'circle':'◯','cone':'△','line':'—','cube':'□'}[t]} ${t[0].toUpperCase()+t.slice(1)}</div>`
    ).join('');
  document.body.appendChild(menu);
  const dismiss = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); } };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

window._placeTemplateAt = async (type, wx, wy) => {
  document.getElementById('tmpl-ctx-menu')?.remove();
  const { addTemplate } = await import('./dnd-hub-templates.js?v=20260502p4');
  await addTemplate(type, wx, wy, 10, 0, 10, 0xff4444, userId);
};

export function setZoom(z, focalX, focalY) {
  const newZ = Math.max(0.25, Math.min(4.0, parseFloat(z) || 1));
  if (focalX !== undefined && MAP.app) {
    // Keep the world point under the cursor stationary during zoom
    // Invariant: MAP.panX === app.stage.position.x, MAP.panY === app.stage.position.y
    const worldX = (focalX - MAP.panX) / MAP.zoom;
    const worldY = (focalY - MAP.panY) / MAP.zoom;
    MAP.panX = focalX - worldX * newZ;
    MAP.panY = focalY - worldY * newZ;
  }
  MAP.zoom = newZ;
  if (MAP.app) {
    MAP.app.stage.scale.set(MAP.zoom);
    MAP.app.stage.position.set(MAP.panX, MAP.panY);
  }
  renderGrid();
  renderFog(); // fog cell count depends on zoom — must re-cull after scale change
  const el = document.getElementById('zoom-display');
  if (el) el.textContent = Math.round(MAP.zoom * 100) + '%';
}
