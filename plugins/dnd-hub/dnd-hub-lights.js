// dnd-hub-lights.js — dynamic light sources: raycasting, PIXI glow rendering, flicker, storage
import { MAP, serverData, userId, effectiveGs } from './dnd-hub-state.js?v=20261007v';
import { storageSet } from '../plugin-sdk.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { EV } from './dnd-hub-event-types.js?v=20261007k';
import { computeVisibleCells, computeVisibilityPolygon, getOpaqueSegments } from './dnd-hub-los.js?v=20261007v';
import { wallPx } from './dnd-hub-walls.js?v=20261007v';
import { saveHubDm } from './dnd-hub-storage.js?v=20261006s';

import { CLIENT_ID } from './dnd-hub-client-id.js';
// ── Two shapes of light ───────────────────────────────────────────────────────

/**
 * A light in map pixels. Lights placed with the Light tool are pixels (x, y, radius); lights from a Universal VTT
 * import are grid squares (cx, cy, range, colour "AARRGGBB"), and were never drawn or lit anything.
 */
export function lightPx(light, mapData = MAP.mapData) {
  if (light.x != null && light.radius != null) return light;
  const gs = effectiveGs(mapData);
  const ox = (MAP._bgOffset?.x ?? 0) + (mapData?.gridOffsetX || 0);
  const oy = (MAP._bgOffset?.y ?? 0) + (mapData?.gridOffsetY || 0);
  const hex = typeof light.color === 'string' ? parseInt(light.color.slice(-6), 16) : light.color;
  return { ...light, x: ox + (light.cx || 0) * gs, y: oy + (light.cy || 0) * gs, radius: (light.range || 3) * gs,
    color: Number.isFinite(hex) ? hex : undefined };
}

// ── Raycasting ────────────────────────────────────────────────────────────────

/**
 * Compute the union of all cells illuminated by the given light sources.
 * Reuses the wall-accurate LOS raycast from dnd-hub-los.js.
 * Light radius is stored in canvas-pixel world units; convert to feet for computeVisibleCells.
 * Returns Set<string> of "cx,cy" cell keys.
 */
export function computeLitCells(lights, mapData) {
  if (!lights?.length || !mapData) return new Set();
  const gs = effectiveGs(mapData);
  const all = new Set();
  for (const raw of lights) {
    const light = lightPx(raw, mapData);
    const r = getEffectiveRadius(light);
    // computeVisibleCells expects visionFeet; radius is in world pixels → convert
    const radiusFeet = (r / gs) * 5;
    computeVisibleCells(light.x, light.y, radiusFeet, mapData).forEach(c => all.add(c));
  }
  return all;
}

// ── Flicker noise ─────────────────────────────────────────────────────────────

/**
 * Deterministic pseudo-noise in [-1, 1] from integer seed.
 * All clients compute the same value for the same seed bucket.
 */
function flickerNoise(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Return the effective radius for a light, applying ±5% flicker noise if enabled.
 * Seed is floored to 125ms buckets so all clients are in sync.
 */
export function getEffectiveRadius(light) {
  if (!light.flicker) return light.radius;
  // Use first char of id to offset each light's phase so they don't all pulse together
  const seed = Math.floor(Date.now() / 125) + (light.id?.charCodeAt(0) ?? 0);
  return light.radius * (1 + flickerNoise(seed) * 0.05);
}

// ── PIXI glow rendering ───────────────────────────────────────────────────────

/**
 * Render colored glow circles for all lights onto the lights layer.
 * Called for all users — for players the fog layer sits on top and naturally
 * masks non-visible areas. For DM the fog always clears lit cells, so the
 * glow shows through regardless of fog state.
 */
export function renderLights() {
  const layer = MAP.layers?.lights;
  if (!layer) return;
  layer.removeChildren();
  if (!MAP.mapData) return;

  const lights = MAP.mapData.lights || [];
  if (!lights.length) return;

  // Warm light that stops at walls (it used to be a 7–18 % disc that went straight through them, too faint to tell
  // whether a light worked). Drawn under the fog: players see it only where they can see.
  const walls = getOpaqueSegments(MAP.mapData).map(seg => wallPx(seg));
  const glow = new PIXI.Graphics();
  glow.blendMode = 'add';
  const g = new PIXI.Graphics();
  for (const raw of lights) {
    const light = lightPx(raw);
    const r = getEffectiveRadius(light);
    const col = light.color ?? 0xffd9a0;
    for (const [k, a] of [[1, 0.10], [0.7, 0.10], [0.45, 0.12], [0.22, 0.16]]) {
      const poly = computeVisibilityPolygon(light.x, light.y, r * k, walls);
      if (poly.length >= 3) glow.poly(poly.flatMap(p => [p.x, p.y])).fill({ color: col, alpha: a });
    }
    // The source itself, so the DM can find and select it
    if (MAP.isDM) {
      const isSelected = light.id === MAP.activeLightId;
      g.circle(light.x, light.y, isSelected ? 7 : 5)
        .fill({ color: isSelected ? 0xffdd44 : 0xffffff, alpha: 0.85 });
    }
  }

  // Preview ring for radius drag — drawn while MAP.lightDragState.mode === 'radius'
  if (MAP.isDM && MAP.lightDragState?.mode === 'radius') {
    const ds = MAP.lightDragState;
    const light = (lights).find(l => l.id === ds.lightId);
    if (light) {
      g.circle(light.x, light.y, light.radius)
        .stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
    }
  }

  layer.addChild(glow, g);
}

// ── Flicker ticker ────────────────────────────────────────────────────────────

let _flickerTimer = null;

/**
 * Start the 8 Hz flicker interval.
 * @param {Function} renderFogFn  - renderFog() reference passed in from main to avoid circular imports
 */
export function startFlicker(renderFogFn) {
  if (_flickerTimer) return;
  _flickerTimer = setInterval(() => {
    if (!MAP.mapData?.lights?.length) return;
    const hasFlicker = MAP.mapData.lights.some(l => l.flicker);
    if (!hasFlicker) return;
    renderLights();
    if (renderFogFn) renderFogFn();
  }, 125);
}

export function stopFlicker() {
  if (_flickerTimer) { clearInterval(_flickerTimer); _flickerTimer = null; }
}

// ── Storage / broadcast ───────────────────────────────────────────────────────

/**
 * Persist mapData.lights to hub-dm storage and broadcast lights:update to all clients.
 */
export async function saveLightsAndBroadcast() {
  if (!MAP.mapData || !MAP.campaignId || !MAP.mapId) return;
  serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
  await saveHubDm( serverData);
  await realtimePublish(EV.LIGHTS_UPDATE, { clientId: CLIENT_ID,
    type: EV.LIGHTS_UPDATE,
    campaignId: MAP.campaignId,
    mapId: MAP.mapId,
    lights: MAP.mapData.lights || [],
    fromUserId: userId,
  });
}
