// dnd-hub-grid.js — grid overlay rendering
import { MAP, effectiveGs } from './dnd-hub-state.js?v=20260502p4';

export function renderGrid() {
  const layers = MAP.layers;
  if (!layers?.grid) return;
  layers.grid.removeChildren();

  const mapData = MAP.mapData;
  if (!mapData?.gridEnabled) return;

  const gs = effectiveGs(mapData);
  const ox = (MAP._bgOffset?.x ?? 0) + (mapData.gridOffsetX || 0);
  const oy = (MAP._bgOffset?.y ?? 0) + (mapData.gridOffsetY || 0);

  // Convert hex color string to PIXI integer
  const colorStr = mapData.gridColor || '#ffffff';
  const color = parseInt(colorStr.replace('#', ''), 16);
  const alpha = mapData.gridAlpha ?? 0.08;

  const W = MAP.app.screen.width;
  const H = MAP.app.screen.height;
  const z = MAP.zoom || 1;
  const panX = MAP.panX || 0;
  const panY = MAP.panY || 0;

  // Visible world bounds — extend by one cell on each side so lines don't
  // pop in/out at the viewport edge during pan.
  const worldLeft   = (-panX) / z - gs;
  const worldTop    = (-panY) / z - gs;
  const worldRight  = (W - panX) / z + gs;
  const worldBottom = (H - panY) / z + gs;

  const startX = Math.floor((worldLeft  - ox) / gs) * gs + ox;
  const startY = Math.floor((worldTop   - oy) / gs) * gs + oy;

  const g = new PIXI.Graphics();
  for (let x = startX; x <= worldRight; x += gs) {
    g.moveTo(x, worldTop).lineTo(x, worldBottom).stroke({ color, alpha, width: 1 });
  }
  for (let y = startY; y <= worldBottom; y += gs) {
    g.moveTo(worldLeft, y).lineTo(worldRight, y).stroke({ color, alpha, width: 1 });
  }
  layers.grid.addChild(g);
}
