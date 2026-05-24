// dnd-master-triggers.js — DM sidebar tab: list triggers and audio zones (Phase 7)
import { storageGetCompanion } from '../plugin-sdk.js';

let _sharedState = null;

export function setTriggersState(state) {
  _sharedState = state;
}

export async function renderTriggersTab() {
  const el = document.getElementById('tab-triggers');
  if (!el) return;

  // Always read fresh data — triggers are placed in the hub and the master's
  // cached dmCampaign won't reflect them until we re-read from storage.
  const freshData = await storageGetCompanion('dnd-hub', 'hub-dm', 'server');
  const dmCampaignId = _sharedState?.dmCampaignId;
  const campaign = freshData?.campaigns?.[dmCampaignId] || _sharedState?.dmCampaign;
  const activeMapId = campaign?.activeMapId;
  const mapData = activeMapId ? campaign?.maps?.[activeMapId] : null;
  const triggers   = mapData?.triggers   || [];
  const audioZones = mapData?.audioZones || [];

  el.innerHTML = `
    <div style="padding:10px 12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--fg)">🪤 Trigger Tiles</div>
      ${triggers.length === 0
        ? '<div style="font-size:11px;color:var(--muted);padding:6px 0">No triggers placed. Use the Trap tool on the map.</div>'
        : triggers.map(t => `
          <div style="background:var(--surface2,#1e1e2e);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:11px">
            <div style="font-weight:700;margin-bottom:2px">${_esc(t.label || t.type)} — Cell (${t.cx},${t.cy})</div>
            <div style="color:var(--muted)">Type: ${_esc(t.type)} | ${t.requireConfirm ? 'Confirm required' : 'Auto-fire'} | ${t.oneShot ? 'One-shot' : 'Repeatable'} | ${t.disabled ? '<span style="color:#ef4444">Disabled</span>' : '<span style="color:#22c55e">Active</span>'}</div>
          </div>`).join('')}
      <div style="font-size:12px;font-weight:700;margin-top:16px;margin-bottom:8px;color:var(--fg)">🔊 Audio Zones</div>
      ${audioZones.length === 0
        ? '<div style="font-size:11px;color:var(--muted);padding:6px 0">No audio zones placed. Use the Zone tool on the map.</div>'
        : audioZones.map(z => `
          <div style="background:var(--surface2,#1e1e2e);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:11px">
            <div style="font-weight:700;margin-bottom:2px">🔊 ${_esc(z.name)}</div>
            <div style="color:var(--muted)">Radius: ${z.radius} cells | Volume: ${Math.round((z.maxVolume || 1) * 100)}% | ${z.loop ? 'Loop' : 'One-shot'} | ${z.fileId ? 'Audio loaded' : 'No audio'}</div>
          </div>`).join('')}
    </div>`;
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
