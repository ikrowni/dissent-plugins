// dnd-master-settings.js — the DM's Table rules page: presets, switches, then the table (hearing range, export).
// What each preset and switch means lives in lk-table-rules.js.
import { EV } from './dnd-hub-event-types.js?v=20261015f';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { publishTo } from './lk-bus.js';
import { esc } from '../plugin-sdk.js';
import { PRESET_ORDER, PRESET_INFO, RULE_KEYS, RULE_INFO, rule, presetOf, applyPreset, defaultSettings } from './lk-table-rules.js';

let _state = { dmCampaignId: null, dmCampaign: null, serverData: null, userId: null };

export function setSettingsState(state) { _state = state; }

const getSettings = () => _state.dmCampaign?.settings || defaultSettings();
const heading = (text, top = 16) =>
  `<div style="font-size:11px;font-weight:700;color:var(--gold);margin:${top}px 0 10px;letter-spacing:.05em">${text}</div>`;

export function renderSettings() {
  const el = document.getElementById('tab-settings');
  if (!el) return;
  const s = getSettings();
  const current = presetOf(s);
  const cards = PRESET_ORDER.map(p => {
    const on = p === current;
    return `<button class="lk-preset${on ? ' active' : ''}" data-preset="${p}" onclick="pickPreset('${p}')" ` +
      `style="flex:1;text-align:left;padding:8px;border-radius:8px;cursor:pointer;background:var(--surface);color:var(--text);` +
      `border:1px solid ${on ? 'var(--gold)' : 'var(--border)'}">` +
      `<div style="font-size:12px;font-weight:700;color:${on ? 'var(--gold)' : 'var(--text)'}">${PRESET_INFO[p].label}</div>` +
      `<div style="font-size:10px;color:var(--muted);margin-top:3px;line-height:1.35">${PRESET_INFO[p].blurb}</div></button>`;
  }).join('');
  const groups = [...new Set(RULE_KEYS.map(k => RULE_INFO[k].group))];
  el.innerHTML =
    heading('TABLE RULES', 0) +
    `<div style="display:flex;gap:6px">${cards}</div>` +
    `<div id="table-rules-preset" data-preset="${current}" style="font-size:10px;color:var(--muted);margin-top:6px">` +
      (current === 'custom' ? 'Custom: your own mix of switches. Pick a preset to reset them all.' : `Playing ${PRESET_INFO[current].label}.`) +
    '</div>' +
    groups.map(g => heading(g.toUpperCase()) +
      RULE_KEYS.filter(k => RULE_INFO[k].group === g).map(k => _row(k, RULE_INFO[k].label, rule(s, k), RULE_INFO[k].desc)).join('')
    ).join('') +
    heading('TABLE') +
    '<div class="setting-row">' +
      '<div style="flex:1">' +
        '<div style="font-size:11px;font-weight:600;color:var(--text)">Hearing Range (ft)</div>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:2px">Max distance players can hear each other (10–300 ft)</div>' +
      '</div>' +
      `<input type="number" min="10" max="300" step="5" value="${esc(String(s.spatialRange ?? 60))}" ` +
        `onchange="setSpatialRange(+this.value)" ` +
        `style="width:60px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:11px;text-align:center">` +
    '</div>' +
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
      `<input type="checkbox" data-rule="${key}" onchange="toggleSetting('${key}',this.checked)"${checked ? ' checked' : ''}>` +
      `<span class="toggle-slider"></span>` +
    `</label>` +
  `</div>`;
}

/** Save the campaign's settings and tell the Hub and every player sheet (they apply them live). */
async function _saveSettings(settings) {
  const { dmCampaignId, dmCampaign, serverData, userId } = _state;
  dmCampaign.settings = settings;
  serverData.campaigns[dmCampaignId].settings = settings;
  await saveHubDmCompanion(serverData);
  await publishTo(['hub', 'player'], EV.COMBAT_SETTINGS, { campaignId: dmCampaignId, settings, fromUserId: userId });
  renderSettings();
}

export async function pickPreset(name) {
  if (!_state.dmCampaign) return;
  await _saveSettings(applyPreset(getSettings(), name));
}

export async function toggleSetting(key, value) {
  if (!_state.dmCampaign) return;
  await _saveSettings({ ...getSettings(), [key]: !!value });
}

export async function setSpatialRange(value) {
  if (!_state.dmCampaign) return;
  await _saveSettings({ ...getSettings(), spatialRange: Math.max(10, Math.min(300, value || 60)) });
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
