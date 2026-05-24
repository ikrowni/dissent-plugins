// dnd-hub-lights.js — dynamic light sources: raycasting, PIXI glow rendering, flicker, storage
import { MAP, serverData, userId, effectiveGs, HUB_DM_KEY } from './dnd-hub-state.js?v=20260502p4';
import { storageSet, realtimePublish } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { computeVisibleCells } from './dnd-hub-los.js?v=20260502p4';

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
  for (const light of lights) {
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

  const g = new PIXI.Graphics();
  for (const light of lights) {
    const r = getEffectiveRadius(light);
    const col = light.color ?? 0xfff5cc;

    // Three concentric circles: edge glow → mid → bright center
    g.circle(light.x, light.y, r)       .fill({ color: col, alpha: 0.07 });
    g.circle(light.x, light.y, r * 0.6) .fill({ color: col, alpha: 0.11 });
    g.circle(light.x, light.y, r * 0.28).fill({ color: col, alpha: 0.18 });

    // Small white center dot so DM can see the source position
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

  layer.addChild(g);
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
  await storageSet(HUB_DM_KEY, serverData);
  await realtimePublish(EV.LIGHTS_UPDATE, {
    type: EV.LIGHTS_UPDATE,
    campaignId: MAP.campaignId,
    mapId: MAP.mapId,
    lights: MAP.mapData.lights || [],
    fromUserId: userId,
  });
}
