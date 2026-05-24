// dnd-hub-templates.js — AoE template placement, rendering, and broadcast
import { MAP, userId, effectiveGs } from './dnd-hub-state.js?v=20260502p4';
import { realtimePublish, genId } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';

// 6 preset colors (PIXI hex + CSS hex pairs)
export const TEMPLATE_COLORS = [
  { pixi: 0xff4444, css: '#ff4444', label: 'Red' },
  { pixi: 0xff9900, css: '#ff9900', label: 'Orange' },
  { pixi: 0xffdd00, css: '#ffdd00', label: 'Yellow' },
  { pixi: 0x44cc44, css: '#44cc44', label: 'Green' },
  { pixi: 0x4488ff, css: '#4488ff', label: 'Blue' },
  { pixi: 0xcc44ff, css: '#cc44ff', label: 'Purple' },
];

let _pickerOpen = false;
let _pendingType = null;   // shape type chosen from picker, waiting for mousedown
let _pendingColor = TEMPLATE_COLORS[0].pixi;
let _pendingOrigin = null; // { x, y } world coords set on mousedown
let _previewGraphics = null;

// ── State helpers ─────────────────────────────────────────────────────────────

export function getTemplates() { return MAP.templates || []; }

export async function broadcastTemplates() {
  await realtimePublish(EV.TEMPLATE_UPDATE, {
    type: EV.TEMPLATE_UPDATE,
    campaignId: MAP.campaignId,
    templates: MAP.templates,
    fromUserId: userId,
  });
}

export async function addTemplate(type, x, y, radius, angle, length, color, ownerId) {
  const tmpl = { id: genId(), type, x, y, radius, angle, length, color, ownerId };
  MAP.templates.push(tmpl);
  renderTemplates();
  await broadcastTemplates();
}

export async function removeTemplate(id) {
  MAP.templates = MAP.templates.filter(t => t.id !== id);
  renderTemplates();
  await broadcastTemplates();
}

export async function clearMyTemplates() {
  MAP.templates = MAP.templates.filter(t => t.ownerId !== userId);
  renderTemplates();
  await broadcastTemplates();
}

export async function clearAllTemplates() {
  MAP.templates = [];
  renderTemplates();
  await broadcastTemplates();
}

// ── Picker panel ──────────────────────────────────────────────────────────────

export function showTemplatePicker() {
  destroyTemplatePicker();
  _pickerOpen = true;
  const panel = document.createElement('div');
  panel.id = 'template-picker';
  panel.style.cssText = 'position:fixed;top:48px;left:50%;transform:translateX(-50%);' +
    'background:#1a1a2e;border:1px solid rgba(212,175,55,.4);border-radius:10px;' +
    'padding:12px;z-index:9000;display:flex;flex-direction:column;gap:10px;min-width:220px;' +
    'box-shadow:0 8px 32px rgba(0,0,0,.6)';
  panel.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:#d4af37;letter-spacing:.05em">PLACE TEMPLATE</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px" id="tmpl-shape-btns">' +
      ['circle','cone','line','cube'].map(t =>
        `<button id="tmpl-shape-${t}" onclick="selectTemplateShape('${t}')" ` +
        `style="padding:7px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);` +
        `border-radius:6px;color:#fff;font-size:11px;cursor:pointer">${_shapeIcon(t)} ${t[0].toUpperCase()+t.slice(1)}</button>`
      ).join('') +
    '</div>' +
    '<div style="font-size:10px;color:rgba(255,255,255,.5)">Color:</div>' +
    '<div style="display:flex;gap:6px">' +
      TEMPLATE_COLORS.map((c, i) =>
        `<div onclick="selectTemplateColor(${i})" style="width:20px;height:20px;border-radius:50%;` +
        `background:${c.css};cursor:pointer;border:2px solid ${i===0?'#fff':'transparent'}" ` +
        `id="tmpl-color-${i}"></div>`
      ).join('') +
    '</div>' +
    (MAP.isDM
      ? '<button onclick="clearAllTemplates()" style="padding:5px;background:rgba(248,113,113,.12);' +
        'border:1px solid rgba(248,113,113,.3);border-radius:6px;color:#f87171;font-size:10px;cursor:pointer">Clear All</button>'
      : '<button onclick="clearMyTemplates()" style="padding:5px;background:rgba(255,255,255,.06);' +
        'border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#94a3b8;font-size:10px;cursor:pointer">Clear Mine</button>') +
    '<div style="font-size:10px;color:rgba(255,255,255,.4)" id="tmpl-hint">Click a shape, then click-drag on map</div>';
  document.body.appendChild(panel);
}

export function destroyTemplatePicker() {
  document.getElementById('template-picker')?.remove();
  _pickerOpen = false;
  _pendingType = null;
}

function _shapeIcon(t) {
  return { circle: '◯', cone: '△', line: '—', cube: '□' }[t] || '?';
}

export function selectTemplateShape(type) {
  _pendingType = type;
  document.querySelectorAll('[id^="tmpl-shape-"]').forEach(b => {
    b.style.borderColor = b.id === `tmpl-shape-${type}` ? '#d4af37' : 'rgba(255,255,255,.15)';
    b.style.background  = b.id === `tmpl-shape-${type}` ? 'rgba(212,175,55,.15)' : 'rgba(255,255,255,.06)';
  });
  const hint = document.getElementById('tmpl-hint');
  if (hint) hint.textContent = 'Click-drag on map to place';
  // Activate template tool
  if (typeof window.setTool === 'function') window.setTool('template');
}

export function selectTemplateColor(idx) {
  _pendingColor = TEMPLATE_COLORS[idx]?.pixi ?? TEMPLATE_COLORS[0].pixi;
  document.querySelectorAll('[id^="tmpl-color-"]').forEach((el, i) => {
    el.style.border = `2px solid ${i === idx ? '#fff' : 'transparent'}`;
  });
}

// Called from canvas to start drawing
export function startTemplateDraw(wx, wy) {
  if (!_pendingType) return false;
  _pendingOrigin = { x: wx, y: wy };
  return true;
}

export function updateTemplatePreview(wx, wy) {
  if (!_pendingOrigin || !_pendingType || !MAP.layers?.ui) return;
  if (_previewGraphics) MAP.layers.ui.removeChild(_previewGraphics);
  _previewGraphics = new PIXI.Graphics();
  const gs = effectiveGs(MAP.mapData);
  const angle = Math.atan2(wy - _pendingOrigin.y, wx - _pendingOrigin.x);
  const dist = Math.hypot(wx - _pendingOrigin.x, wy - _pendingOrigin.y);
  const radiusFt = (dist / gs) * 5;
  _drawShape(_previewGraphics, _pendingType, _pendingOrigin.x, _pendingOrigin.y,
    radiusFt, angle, radiusFt, _pendingColor, gs, 0.5);
  MAP.layers.ui.addChild(_previewGraphics);
}

export async function finishTemplateDraw(wx, wy) {
  if (!_pendingOrigin || !_pendingType) return;
  if (_previewGraphics) { MAP.layers.ui.removeChild(_previewGraphics); _previewGraphics = null; }
  const gs = effectiveGs(MAP.mapData);
  const angle = Math.atan2(wy - _pendingOrigin.y, wx - _pendingOrigin.x);
  const dist = Math.hypot(wx - _pendingOrigin.x, wy - _pendingOrigin.y);
  const radiusFt = Math.max(5, Math.round((dist / gs) * 5 / 5) * 5);
  const origin = _pendingOrigin;
  _pendingOrigin = null;
  await addTemplate(_pendingType, origin.x, origin.y, radiusFt, angle, radiusFt, _pendingColor, userId);
}

export function cancelTemplateDraw() {
  if (_previewGraphics) { MAP.layers.ui.removeChild(_previewGraphics); _previewGraphics = null; }
  _pendingOrigin = null;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

export function renderTemplates() {
  const layer = MAP.layers?.ui;
  if (!layer || !MAP.mapData) return;

  // Remove old template graphics (tagged with _isTemplate)
  const toRemove = layer.children.filter(c => c._isTemplate);
  toRemove.forEach(c => layer.removeChild(c));

  if (!MAP.templates?.length) return;
  const gs = effectiveGs(MAP.mapData);

  for (const tmpl of MAP.templates) {
    const g = new PIXI.Graphics();
    g._isTemplate = true;
    _drawShape(g, tmpl.type, tmpl.x, tmpl.y, tmpl.radius, tmpl.angle, tmpl.length, tmpl.color, gs, 0.35);
    layer.addChild(g);

    const canEdit = MAP.isDM || tmpl.ownerId === userId;
    if (!canEdit) continue;

    // ✕ removal button
    const btnR = (tmpl.radius / 5) * gs;
    const btn = new PIXI.Text({ text: '✕',
      style: new PIXI.TextStyle({ fill: 0xffffff, fontSize: 11, fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 } }) });
    btn._isTemplate = true;
    btn.anchor.set(0.5, 0.5);
    btn.x = tmpl.x;
    btn.y = tmpl.y - btnR - 10;
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.on('pointerdown', e => { e.stopPropagation(); removeTemplate(tmpl.id); });
    layer.addChild(btn);

    // Drag handle — transparent circle at origin; update in-place during drag to avoid re-render loop
    const handle = new PIXI.Graphics();
    handle._isTemplate = true;
    handle.circle(tmpl.x, tmpl.y, 12).fill({ color: 0xffffff, alpha: 0.01 });
    handle.eventMode = 'static';
    handle.cursor = 'grab';
    let dragging = false;
    handle.on('pointerdown', e => {
      if (e.button !== 0) return;
      dragging = true; handle.cursor = 'grabbing'; e.stopPropagation();
    });
    handle.on('globalpointermove', e => {
      if (!dragging) return;
      const pos = e.getLocalPosition(layer);
      tmpl.x = pos.x; tmpl.y = pos.y;
      // Update graphics in-place to avoid destroying this handle mid-drag
      g.clear();
      _drawShape(g, tmpl.type, tmpl.x, tmpl.y, tmpl.radius, tmpl.angle, tmpl.length, tmpl.color, gs, 0.35);
      btn.x = tmpl.x;
      btn.y = tmpl.y - (tmpl.radius / 5) * gs - 10;
      handle.clear();
      handle.circle(tmpl.x, tmpl.y, 12).fill({ color: 0xffffff, alpha: 0.01 });
    });
    handle.on('pointerup', async () => {
      if (!dragging) return;
      dragging = false; handle.cursor = 'grab';
      await broadcastTemplates();
      renderTemplates();
    });
    handle.on('pointerupoutside', () => {
      if (dragging) { dragging = false; broadcastTemplates().then(() => renderTemplates()); }
    });
    layer.addChild(handle);
  }
}

// ── Shape drawing ─────────────────────────────────────────────────────────────

function _drawShape(g, type, wx, wy, radiusFt, angle, lengthFt, color, gs, alpha) {
  const r  = (radiusFt / 5) * gs;
  const ln = (lengthFt / 5) * gs;

  g.setStrokeStyle({ color, width: 2, alpha: Math.min(1, alpha + 0.3) });

  if (type === 'circle') {
    g.circle(wx, wy, r).fill({ color, alpha }).stroke();
    _highlightCells(g, wx, wy, radiusFt, angle, lengthFt, type, gs, color);

  } else if (type === 'cone') {
    const halfAngle = Math.PI / 6; // 30° = 60° cone
    const ax = wx + ln * Math.cos(angle - halfAngle);
    const ay = wy + ln * Math.sin(angle - halfAngle);
    const bx = wx + ln * Math.cos(angle + halfAngle);
    const by = wy + ln * Math.sin(angle + halfAngle);
    g.moveTo(wx, wy).lineTo(ax, ay).lineTo(bx, by).closePath().fill({ color, alpha }).stroke();
    _highlightCells(g, wx, wy, radiusFt, angle, lengthFt, type, gs, color);

  } else if (type === 'line') {
    const halfW = (2.5 / 5) * gs;
    const px = Math.cos(angle + Math.PI / 2) * halfW;
    const py = Math.sin(angle + Math.PI / 2) * halfW;
    const ex = wx + ln * Math.cos(angle);
    const ey = wy + ln * Math.sin(angle);
    g.moveTo(wx - px, wy - py).lineTo(wx + px, wy + py)
     .lineTo(ex + px, ey + py).lineTo(ex - px, ey - py).closePath()
     .fill({ color, alpha }).stroke();
    _highlightCells(g, wx, wy, radiusFt, angle, lengthFt, type, gs, color);

  } else if (type === 'cube') {
    const half = r;
    g.rect(wx - half, wy - half, half * 2, half * 2).fill({ color, alpha }).stroke();
    _highlightCells(g, wx, wy, radiusFt, angle, lengthFt, type, gs, color);
  }
}

function _highlightCells(g, wx, wy, radiusFt, angle, lengthFt, type, gs, color) {
  const ox = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
  const oy = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);

  const r  = (radiusFt / 5) * gs;
  const ln = (lengthFt / 5) * gs;

  // Scan a bounding box of cells
  const minX = Math.floor((wx - Math.max(r, ln) - ox) / gs) - 1;
  const maxX = Math.ceil( (wx + Math.max(r, ln) - ox) / gs) + 1;
  const minY = Math.floor((wy - Math.max(r, ln) - oy) / gs) - 1;
  const maxY = Math.ceil( (wy + Math.max(r, ln) - oy) / gs) + 1;

  for (let cx = minX; cx <= maxX; cx++) {
    for (let cy = minY; cy <= maxY; cy++) {
      const ccx = ox + (cx + 0.5) * gs;
      const ccy = oy + (cy + 0.5) * gs;
      if (_cellInTemplate(ccx, ccy, wx, wy, type, r, angle, ln, gs)) {
        g.rect(ox + cx * gs, oy + cy * gs, gs, gs).fill({ color, alpha: 0.15 });
      }
    }
  }
}

function _cellInTemplate(ccx, ccy, wx, wy, type, r, angle, ln, gs) {
  if (type === 'circle') {
    return Math.hypot(ccx - wx, ccy - wy) <= r;
  } else if (type === 'cube') {
    return Math.abs(ccx - wx) <= r && Math.abs(ccy - wy) <= r;
  } else if (type === 'cone') {
    const dist = Math.hypot(ccx - wx, ccy - wy);
    if (dist > ln) return false;
    const a = Math.atan2(ccy - wy, ccx - wx);
    let da = ((a - angle) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    return Math.abs(da) <= Math.PI / 6;
  } else if (type === 'line') {
    const halfW = (2.5 / 5) * gs;
    // Project cell center onto line direction
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const dot = (ccx - wx) * dx + (ccy - wy) * dy;
    if (dot < 0 || dot > ln) return false;
    const perp = Math.abs((ccx - wx) * dy - (ccy - wy) * dx);
    return perp <= halfW;
  }
  return false;
}
