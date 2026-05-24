// dnd-hub-los.js — line-of-sight math, fog update from LOS
import { MAP, serverData, userId, segmentsIntersect, effectiveGs } from './dnd-hub-state.js?v=20260502p4';
import { renderFog, saveFogState } from './dnd-hub-fog.js?v=20260502p4';
import { wallPx } from './dnd-hub-walls.js?v=20260502p4';

function getOpaqueSegments(mapData) {
  const segs = [...(mapData.walls || [])];
  Object.values(mapData.doors || {}).forEach(d => {
    if (d.state === 'closed' || d.state === 'locked' || d.isWindow) segs.push(d);
  });
  return segs;
}

// Returns the distance t along ray (ox,oy)+(dx,dy)*t where it hits segment (x1,y1)-(x2,y2),
// or null if no valid intersection (parallel, wrong direction, or outside segment).
function raySegmentIntersect(ox, oy, dx, dy, x1, y1, x2, y2) {
  const ex = x2 - x1, ey = y2 - y1;
  const det = ex * dy - dx * ey;
  if (Math.abs(det) < 1e-10) return null;
  const fx = x1 - ox, fy = y1 - oy;
  const t = (ex * fy - ey * fx) / det;
  const s = (dx * fy - dy * fx) / det;
  if (t >= 0 && s >= 0 && s <= 1) return t;
  return null;
}

// Visibility polygon via angular sweep. Casts rays toward every wall endpoint
// (plus ±ε to capture both sides of a corner) and fills gaps with uniform circle
// samples for open areas. Returns a polygon as {x,y}[] in canvas-pixel space.
function computeVisibilityPolygon(ox, oy, visionPx, walls) {
  const angles = [];

  // Uniform circle samples — ensures correct shape when no walls are in range.
  const N_CIRCLE = 72;
  for (let i = 0; i < N_CIRCLE; i++) {
    angles.push((i / N_CIRCLE) * Math.PI * 2 - Math.PI);
  }

  // One ray per wall endpoint, with ±ε neighbours to capture both sides of corners.
  const vr2 = visionPx * visionPx * 1.5;
  for (const w of walls) {
    for (const [px, py] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const fdx = px - ox, fdy = py - oy;
      if (fdx * fdx + fdy * fdy > vr2) continue;
      const a = Math.atan2(fdy, fdx);
      angles.push(a - 0.00001, a, a + 0.00001);
    }
  }

  angles.sort((a, b) => a - b);

  const poly = [];
  for (const angle of angles) {
    const cdx = Math.cos(angle), cdy = Math.sin(angle);
    let minT = visionPx;
    for (const w of walls) {
      const t = raySegmentIntersect(ox, oy, cdx, cdy, w.x1, w.y1, w.x2, w.y2);
      if (t !== null && t < minT) minT = t;
    }
    poly.push({ x: ox + cdx * minT, y: oy + cdy * minT });
  }
  return poly;
}

// Grid-cell set used by the DM side for persistent fogState (unchanged from before).
export function computeVisibleCells(tokenX, tokenY, visionFeet, mapData) {
  const gs = effectiveGs(mapData);
  const visionPx = (visionFeet / 5) * gs;
  const segs = getOpaqueSegments(mapData).map(seg => wallPx(seg));
  const visible = new Set();
  const RAY_COUNT = 360;

  for (let i = 0; i < RAY_COUNT; i++) {
    const angle = (i / RAY_COUNT) * Math.PI * 2;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const stepPx = gs / 2;
    const steps = Math.ceil(visionPx / stepPx);

    for (let s = 1; s <= steps; s++) {
      const rx = tokenX + cosA * stepPx * s;
      const ry = tokenY + sinA * stepPx * s;
      const dx = rx - tokenX, dy = ry - tokenY;
      if (dx * dx + dy * dy > visionPx * visionPx) break;

      let blocked = false;
      for (const seg of segs) {
        if (segmentsIntersect(tokenX, tokenY, rx, ry, seg.x1, seg.y1, seg.x2, seg.y2)) {
          blocked = true; break;
        }
      }
      if (blocked) break;

      const ox = (MAP._bgOffset?.x ?? 0) + (mapData.gridOffsetX || 0);
      const oy = (MAP._bgOffset?.y ?? 0) + (mapData.gridOffsetY || 0);
      visible.add(`${Math.floor((rx - ox) / gs)},${Math.floor((ry - oy) / gs)}`);
    }
  }
  return visible;
}

// Client-side only: compute smooth visibility polygons for each player token.
// Stored in MAP.localVisiblePoly (Array<{x,y}[]>) — never saved to server.
export function computeLocalPlayerLOS() {
  if (MAP.isDM || !MAP.mapData) { MAP.localVisiblePoly = null; return; }

  const myTokens = Object.values(MAP.mapData.tokens || {}).filter(t =>
    t.type === 'player' && t.visible && t.userId === userId
  );

  if (!myTokens.length) { MAP.localVisiblePoly = null; return; }

  const gs = effectiveGs(MAP.mapData);
  const walls = getOpaqueSegments(MAP.mapData).map(seg => wallPx(seg));
  const polys = [];

  for (const t of myTokens) {
    const visionPx = ((t.visionRadius || 60) / 5) * gs;
    const poly = computeVisibilityPolygon(t.x, t.y, visionPx, walls);
    if (poly.length >= 3) polys.push(poly);
  }

  MAP.localVisiblePoly = polys.length > 0 ? polys : null;
}

// DM-only: compute LOS from all player tokens, update server fog state.
export function updateFogFromLOS() {
  if (!MAP.isDM || !MAP.mapData) return;
  const mapData = MAP.mapData;
  const playerTokens = Object.values(mapData.tokens).filter(t => t.type === 'player' && t.visible);
  if (!playerTokens.length) return;

  const newVisible = new Set();
  playerTokens.forEach(t => {
    computeVisibleCells(t.x, t.y, t.visionRadius || 60, mapData).forEach(c => newVisible.add(c));
  });

  const fogState = mapData.fogState;
  Object.keys(fogState).forEach(key => { if (fogState[key] === 'visible') fogState[key] = 'explored'; });
  newVisible.forEach(key => { fogState[key] = 'visible'; });
  renderFog();
}

export async function updateAndBroadcastFog() {
  updateFogFromLOS();
  await saveFogState();
}
