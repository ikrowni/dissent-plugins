// dnd-master-settings.js — DM automation toggles (Phase 2)
import { storageSetCompanion, realtimePublish } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js';
import { saveHubDmCompanion } from '../dnd-hub-shared-storage.js';

let _state = { dmCampaignId: null, dmCampaign: null, serverData: null, userId: null };

const DEFAULT_SETTINGS = { autoHit: true, autoDamage: true, turnLock: false, deathSaves: true, spatialRange: 60, concentrationAutoRoll: false };

export function setSettingsState(state) { _state = state; }

function getSettings() {
  return _state.dmCampaign?.settings || { ...DEFAULT_SETTINGS };
}

export function renderSettings() {
  const el = document.getElementById('tab-settings');
  if (!el) return;
  const s = getSettings();
  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:12px;letter-spacing:.05em">AUTOMATION</div>' +
    _row('autoHit',    'Auto Hit/Miss',   s.autoHit,    'Compare attack rolls to AC of selected token') +
    _row('autoDamage', 'Auto Damage',      s.autoDamage, 'Apply damage rolls automatically after a hit') +
    _row('turnLock',   'Turn Lock',        s.turnLock,   'Prevent non-active players from moving tokens') +
    _row('deathSaves', 'Death Saves',      s.deathSaves, 'Show death save UI when a token reaches 0 HP') +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin:16px 0 12px;letter-spacing:.05em">SPATIAL AUDIO</div>' +
    '<div class="setting-row">' +
      '<div style="flex:1">' +
        '<div style="font-size:11px;font-weight:600;color:var(--text)">Hearing Range (ft)</div>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:2px">Max distance players can hear each other (10–300 ft)</div>' +
      '</div>' +
      `<input type="number" min="10" max="300" step="5" value="${s.spatialRange ?? 60}" ` +
        `onchange="setSpatialRange(+this.value)" ` +
        `style="width:60px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:11px;text-align:center">` +
    '</div>' +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin:16px 0 12px;letter-spacing:.05em">CONCENTRATION</div>' +
    _row('concentrationAutoRoll', 'Auto-roll Concentration Saves',
      s.concentrationAutoRoll ?? false,
      'Automatically roll CON save when a concentrating player takes damage') +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin:16px 0 12px;letter-spacing:.05em">BACKUP</div>' +
    '<div class="setting-row">' +
      '<div style="flex:1">' +
        '<div style="font-size:11px;font-weight:600;color:var(--text)">Export Campaign</div>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:2px">Download full campaign data as JSON</div>' +
      '</div>' +
      '<button class="btn btn-ghost" onclick="exportCampaign()" style="flex-shrink:0">&#x1F4E5; Export</button>' +
    '</div>';
}

function _row(key, label, checked, desc) {
  return `<div class="setting-row">` +
    `<div style="flex:1">` +
      `<div style="font-size:11px;font-weight:600;color:var(--text)">${label}</div>` +
      `<div style="font-size:10px;color:var(--muted);margin-top:2px">${desc}</div>` +
    `</div>` +
    `<label class="toggle-switch">` +
      `<input type="checkbox" onchange="toggleSetting('${key}',this.checked)"${checked ? ' checked' : ''}>` +
      `<span class="toggle-slider"></span>` +
    `</label>` +
  `</div>`;
}

export async function setSpatialRange(value) {
  const { dmCampaignId, dmCampaign, serverData, userId } = _state;
  if (!dmCampaign) return;
  const range = Math.max(10, Math.min(300, value || 60));
  if (!dmCampaign.settings) dmCampaign.settings = { ...DEFAULT_SETTINGS };
  dmCampaign.settings.spatialRange = range;
  serverData.campaigns[dmCampaignId].settings = dmCampaign.settings;
  await saveHubDmCompanion(serverData);
  await realtimePublish(EV.COMBAT_SETTINGS, {
    type: EV.COMBAT_SETTINGS, campaignId: dmCampaignId,
    settings: dmCampaign.settings, fromUserId: userId,
  });
}

export async function toggleSetting(key, value) {
  const { dmCampaignId, dmCampaign, serverData, userId } = _state;
  if (!dmCampaign) return;
  if (!dmCampaign.settings) dmCampaign.settings = { ...DEFAULT_SETTINGS };
  dmCampaign.settings[key] = value;
  serverData.campaigns[dmCampaignId].settings = dmCampaign.settings;
  await saveHubDmCompanion(serverData);
  await realtimePublish(EV.COMBAT_SETTINGS, {
    type: EV.COMBAT_SETTINGS, campaignId: dmCampaignId,
    settings: dmCampaign.settings, fromUserId: userId,
  });
}

export function exportCampaign() {
  const { dmCampaignId, dmCampaign } = _state;
  if (!dmCampaign) return;
  const encoded = encodeURIComponent(JSON.stringify(dmCampaign, null, 2));
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encoded;
  a.download = 'campaign-' + dmCampaignId + '-' + Date.now() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
