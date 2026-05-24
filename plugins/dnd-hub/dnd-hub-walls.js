// dnd-hub-walls.js — wall/door rendering and toolbar tool state
import { MAP, segmentsIntersect } from './dnd-hub-state.js?v=20260502p4';
import { renderFog } from './dnd-hub-fog.js?v=20260502p4';
import { renderLights } from './dnd-hub-lights.js?v=20260502p4';
import { renderAudioZones } from './dnd-hub-audio-zones.js?v=20260502p4';
import { renderTriggers } from './dnd-hub-triggers.js?v=20260502p4';
import { renderTemplates } from './dnd-hub-templates.js?v=20260502p4';

// Convert a stored wall/door segment to canvas pixel coordinates.
// Handles both formats:
//   wallFmt:'cell' — cx1/cy1/cx2/cy2 in grid-cell space (canvas-size-independent)
//   (no wallFmt)   — x1/y1/x2/y2 in absolute canvas pixels (legacy, import-time baked)
export function wallPx(seg) {
  const md = MAP.mapData;
  if (md?.wallFmt === 'cell' && md.mapCellW) {
    const ox  = (MAP._bgOffset?.x ?? 0) + (md.gridOffsetX || 0);
    const oy  = (MAP._bgOffset?.y ?? 0) + (md.gridOffsetY || 0);
    const cpx = (MAP._bgImgW ?? md.mapW ?? 1) * (MAP._bgScale ?? 1) / md.mapCellW;
    return { x1: ox + seg.cx1 * cpx, y1: oy + seg.cy1 * cpx,
             x2: ox + seg.cx2 * cpx, y2: oy + seg.cy2 * cpx };
  }
  return { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 };
}

// Convert canvas pixel coordinates to cell-space (for storing manually-drawn walls).
export function pxToCell(px, py) {
  const md  = MAP.mapData;
  const ox  = (MAP._bgOffset?.x ?? 0) + (md?.gridOffsetX || 0);
  const oy  = (MAP._bgOffset?.y ?? 0) + (md?.gridOffsetY || 0);
  const cpx = (MAP._bgImgW ?? md?.mapW ?? 1) * (MAP._bgScale ?? 1) / (md?.mapCellW ?? 1);
  return { cx: (px - ox) / cpx, cy: (py - oy) / cpx };
}

// Returns true if moving from (fromX,fromY) to (toX,toY) would cross any wall or closed/locked door.
export function wouldCrossWall(fromX, fromY, toX, toY) {
  const mapData = MAP.mapData;
  if (!mapData) return false;
  const segs = [...(mapData.walls || [])];
  Object.values(mapData.doors || {}).forEach(d => {
    // Windows (isWindow:true) are always impassable regardless of state.
    // Closed/locked doors also block. Open non-window doors are passable.
    if (d.state === 'closed' || d.state === 'locked' || d.isWindow) segs.push(d);
  });
  for (const seg of segs) {
    const p = wallPx(seg);
    if (segmentsIntersect(fromX, fromY, toX, toY, p.x1, p.y1, p.x2, p.y2)) return true;
  }
  return false;
}

export function renderWalls() {
  const layers = MAP.layers;
  if (!layers?.walls || !MAP.mapData) return;
  layers.walls.removeChildren();

  if (!MAP.isDM && !MAP.editMode) return;

  const g = new PIXI.Graphics();

  (MAP.mapData.walls || []).forEach(w => {
    const isSelected = w.id === MAP.selectedWall;
    const isHover    = w.id === MAP.eraseHover;
    const color = isHover ? 0xef4444 : isSelected ? 0xd4af37 : 0xff6b35;
    const p = wallPx(w);
    g.moveTo(p.x1, p.y1).lineTo(p.x2, p.y2).stroke({ color, width: 3, alpha: 0.9 });
    g.circle(p.x1, p.y1, 4).fill(color);
    g.circle(p.x2, p.y2, 4).fill(color);
  });

  Object.values(MAP.mapData.doors || {}).forEach(d => {
    const isSelected = d.id === MAP.selectedDoor;
    const isHover    = d.id === MAP.eraseHover;
    let baseCol;
    if (d.isWindow) {
      // Windows: always cyan — visually distinct from doors, never openable by players
      baseCol = 0x22d3ee;
    } else {
      baseCol = d.state === 'open' ? 0x22c55e : d.state === 'locked' ? 0xef4444 : 0xf59e0b;
    }
    const color = isHover ? 0xef4444 : isSelected ? 0xd4af37 : baseCol;
    const p = wallPx(d);
    if (d.isWindow) {
      // Draw windows as a dashed-style double line to distinguish from solid doors
      g.moveTo(p.x1, p.y1).lineTo(p.x2, p.y2).stroke({ color, width: 3, alpha: 0.8 });
      g.moveTo(p.x1, p.y1).lineTo(p.x2, p.y2).stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
    } else {
      g.moveTo(p.x1, p.y1).lineTo(p.x2, p.y2).stroke({ color, width: 4, alpha: 0.9 });
    }
    const mx = (p.x1 + p.x2) / 2, my = (p.y1 + p.y2) / 2;
    g.circle(mx, my, d.isWindow ? 3 : 5).fill(color);
  });

  layers.walls.addChild(g);
}

export function toggleEditMode() {
  MAP.editMode = !MAP.editMode;
  const btn = document.getElementById('btn-edit-mode');
  if (btn) btn.classList.toggle('active', MAP.editMode);
  const editTools = document.getElementById('edit-tools');
  if (editTools) editTools.style.display = MAP.editMode ? 'flex' : 'none';
  if (!MAP.editMode) setTool('select');
  renderWalls();
}

export function toggleDMFog() {
  MAP.fogVisible = !MAP.fogVisible;
  const btn = document.getElementById('btn-fog-toggle');
  if (btn) btn.classList.toggle('active', !MAP.fogVisible);
  renderFog();
}

export function setTool(name) {
  MAP.activeTool = name;
  ['select', 'wall', 'door', 'erase', 'reveal', 'hide', 'pin', 'light', 'speaker', 'trap', 'template'].forEach(t => {
    const btnId = t === 'reveal' ? 'btn-tool-reveal'
                : t === 'hide'   ? 'btn-tool-hide'
                : `btn-tool-${t}`;
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('active', t === name || `brush-${t}` === name);
  });
  if (MAP.app?.canvas) {
    MAP.app.canvas.style.cursor = name === 'select' ? 'default' : 'crosshair';
  }
  // Clear selection state when leaving select tool
  if (name !== 'select') {
    MAP.selectedWall = null; MAP.selectedDoor = null;
    MAP.activeLightId = null; MAP.lightDragState = null;
    MAP.activeAudioZoneId = null; MAP.audioZoneDragState = null;
    MAP.activeTriggerId = null;
    MAP.activeTemplateId = null;
    MAP.templateDrawState = null;
    renderWalls(); renderLights(); renderAudioZones(); renderTriggers(); renderTemplates();
  }
  // Clear erase hover when leaving erase tool
  if (name !== 'erase')  { MAP.eraseHover = null; renderWalls(); }
}
