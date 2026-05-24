// dnd-hub-audio-zones.js — ambient audio zone rendering and editing (Phase 7)
import { MAP, serverData, userId, effectiveGs, HUB_DM_KEY } from './dnd-hub-state.js?v=20260502p4';
import { storageSet, realtimePublish, genId, esc, request } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';

let _zoneSprites = [];  // { id, circle, label } — tracked for selective removal

// ── Render ─────────────────────────────────────────────────────────────────────

export function renderAudioZones() {
  const uiLayer = MAP.layers?.ui;
  if (!uiLayer) return;

  // Remove only our sprites (ui layer is shared with pins, rulers, etc.)
  _zoneSprites.forEach(({ circle, label }) => {
    if (circle.parent) circle.parent.removeChild(circle);
    if (label.parent)  label.parent.removeChild(label);
  });
  _zoneSprites = [];

  if (!MAP.isDM) return;  // audio zones are DM-only overlays
  if (!MAP.mapData?.audioZones?.length) return;

  const gs = effectiveGs(MAP.mapData);

  for (const zone of MAP.mapData.audioZones) {
    const cx = zone.x * gs + (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
    const cy = zone.y * gs + (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
    const r  = zone.radius * gs;

    const isSelected = zone.id === MAP.activeAudioZoneId;
    const color = isSelected ? 0xd4af37 : 0x22c55e;
    const alpha = isSelected ? 0.25 : 0.15;

    const circle = new PIXI.Graphics();
    circle.lineStyle(2, color, isSelected ? 0.9 : 0.6);
    circle.beginFill(color, alpha);
    circle.drawCircle(0, 0, r);
    circle.endFill();
    circle.x = cx;
    circle.y = cy;
    circle.eventMode = 'none';

    const style = new PIXI.TextStyle({ fontSize: 13, fill: '#22c55e', fontWeight: 'bold' });
    const label = new PIXI.Text('🔊 ' + (zone.name || 'Zone'), style);
    label.x = cx - label.width / 2;
    label.y = cy - r - 18;
    label.eventMode = 'none';

    uiLayer.addChild(circle);
    uiLayer.addChild(label);
    _zoneSprites.push({ id: zone.id, circle, label });
  }
}

// ── Persistence + broadcast ───────────────────────────────────────────────────

export async function saveZonesAndBroadcast() {
  await storageSet(HUB_DM_KEY, serverData);
  await realtimePublish(EV.AUDIO_ZONE_UPDATE, {
    campaignId: MAP.campaignId,
    mapId: MAP.mapId,
    audioZones: MAP.mapData.audioZones || [],
  });
  renderAudioZones();
}

// ── Context menu (right-click on zone) ───────────────────────────────────────

export function showZoneContextMenu(screenX, screenY, zone) {
  document.getElementById('zone-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'zone-ctx-menu';
  menu.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;background:#1e1e2e;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px;z-index:9998;min-width:164px;box-shadow:0 4px 16px rgba(0,0,0,.6)`;

  function _item(icon, label, fn) {
    const d = document.createElement('div');
    d.style.cssText = 'padding:7px 12px;font-size:12px;cursor:pointer;border-radius:5px;display:flex;align-items:center;gap:8px;color:#e2e8f0;white-space:nowrap';
    d.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    d.onmouseenter = () => { d.style.background = 'rgba(255,255,255,.08)'; };
    d.onmouseleave = () => { d.style.background = ''; };
    d.onclick = () => { menu.remove(); fn(); };
    return d;
  }

  menu.appendChild(_item('✏️', 'Edit Zone', () => showZoneDialog(0, 0, zone)));
  menu.appendChild(_item('🗑️', 'Remove Zone', async () => {
    if (!MAP.mapData) return;
    MAP.mapData.audioZones = (MAP.mapData.audioZones || []).filter(z => z.id !== zone.id);
    if (MAP.activeAudioZoneId === zone.id) MAP.activeAudioZoneId = null;
    await saveZonesAndBroadcast();
  }));

  document.body.appendChild(menu);
  // Dismiss on any outside click (setTimeout avoids catching the right-click that opened it)
  setTimeout(() => {
    document.addEventListener('click', () => document.getElementById('zone-ctx-menu')?.remove(), { once: true });
  }, 0);
}

// ── Zone editor dialog ────────────────────────────────────────────────────────

export function showZoneDialog(wx, wy, existingZone) {
  const gs  = effectiveGs(MAP.mapData);
  const ox  = (MAP._bgOffset?.x ?? 0) + (MAP.mapData?.gridOffsetX || 0);
  const oy  = (MAP._bgOffset?.y ?? 0) + (MAP.mapData?.gridOffsetY || 0);
  const cx  = (wx - ox) / gs;
  const cy  = (wy - oy) / gs;

  const zone = existingZone || {
    id: genId(),
    x: cx, y: cy,
    radius: 3,
    name: 'Ambient Zone',
    fileId: null,
    maxVolume: 1.0,
    loop: true,
  };

  const existing = document.getElementById('zone-dialog');
  if (existing) existing.remove();

  const d = document.createElement('div');
  d.id = 'zone-dialog';
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--dnd-surface,#1e1e2e);border:1px solid var(--dnd-border,#3f3f5a);border-radius:12px;padding:20px;z-index:9999;min-width:300px;color:var(--dnd-text,#e2e8f0);box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  d.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:12px">🔊 ${existingZone ? 'Edit' : 'New'} Audio Zone</div>
    <label style="font-size:12px;display:block;margin-bottom:4px">Name</label>
    <input id="zd-name" value="${esc(zone.name)}" style="width:100%;box-sizing:border-box;background:var(--dnd-bg,#13131f);border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px">
    <label style="font-size:12px;display:block;margin-bottom:4px">Radius (cells): <span id="zd-r-val">${zone.radius}</span></label>
    <input id="zd-radius" type="range" min="1" max="20" value="${zone.radius}" style="width:100%;margin-bottom:10px" oninput="document.getElementById('zd-r-val').textContent=this.value">
    <label style="font-size:12px;display:block;margin-bottom:4px">Volume: <span id="zd-v-val">${Math.round(zone.maxVolume * 100)}%</span></label>
    <input id="zd-vol" type="range" min="0" max="100" value="${Math.round(zone.maxVolume * 100)}" style="width:100%;margin-bottom:10px" oninput="document.getElementById('zd-v-val').textContent=this.value+'%'">
    <label style="font-size:12px;display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <input id="zd-loop" type="checkbox" ${zone.loop ? 'checked' : ''}> Loop audio
    </label>
    <label style="font-size:12px;display:block;margin-bottom:4px">Audio file</label>
    <input id="zd-file" type="file" accept="audio/*" style="font-size:12px;margin-bottom:10px">
    ${zone.fileId ? `<div style="font-size:11px;color:var(--dnd-muted,#64748b);margin-bottom:10px">Current file ID: ${esc(zone.fileId)}</div>` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button onclick="document.getElementById('zone-dialog').remove()" style="background:transparent;border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 14px;border-radius:6px;cursor:pointer">Cancel</button>
      <button id="zd-save" style="background:var(--dnd-primary,#6366f1);border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600">Save</button>
    </div>`;
  document.body.appendChild(d);

  document.getElementById('zd-save').onclick = async () => {
    const name    = document.getElementById('zd-name').value.trim() || 'Zone';
    const radius  = parseInt(document.getElementById('zd-radius').value) || 3;
    const maxVol  = parseInt(document.getElementById('zd-vol').value) / 100;
    const loop    = document.getElementById('zd-loop').checked;
    const fileEl  = document.getElementById('zd-file');

    let fileId = zone.fileId;
    if (fileEl.files[0]) {
      const file = fileEl.files[0];
      const buf  = await file.arrayBuffer();
      try {
        const res = await request('files:upload', { data: buf, name: file.name, mime: file.type });
        fileId = res?.id || null;
      } catch (e) {
        console.error('Zone audio upload failed', e);
      }
    }

    const updated = { ...zone, name, radius, maxVolume: maxVol, loop, fileId, x: zone.x, y: zone.y };
    if (!MAP.mapData.audioZones) MAP.mapData.audioZones = [];
    const idx = MAP.mapData.audioZones.findIndex(z => z.id === zone.id);
    if (idx >= 0) MAP.mapData.audioZones[idx] = updated;
    else          MAP.mapData.audioZones.push(updated);

    d.remove();
    await saveZonesAndBroadcast();
  };
}
