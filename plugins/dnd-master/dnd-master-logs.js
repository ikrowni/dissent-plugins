// dnd-master-logs.js — Logs tab: append-only campaign event log (max 500 entries)
import { storageSetCompanion } from '../plugin-sdk.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };

export function setLogsState(state) { _state = state; }

export function renderLogsTab() {
  const el = document.getElementById('tab-logs');
  if (!el) return;
  const log = [...(_state.dmCampaign?.log || [])].reverse(); // newest first
  el.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--gold);letter-spacing:.05em">CAMPAIGN LOG</div>' +
      '<div style="display:flex;gap:4px">' +
        '<button class="btn btn-ghost" onclick="exportLog()" style="font-size:10px;padding:3px 8px">Export</button>' +
        '<button class="btn btn-red"   onclick="clearLog()"  style="font-size:10px;padding:3px 8px">Clear</button>' +
      '</div>' +
    '</div>' +
    '<div id="log-list">' +
    (log.length === 0
      ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:16px">No events logged yet</div>'
      : log.map(e => _entryHtml(e)).join('')
    ) +
    '</div>';
}

const _BADGE = {
  'roll':          'log-badge-roll',
  'hp-change':     'log-badge-hp',
  'death-save':    'log-badge-death',
  'combat-start':  'log-badge-combat',
  'combat-end':    'log-badge-combat',
  'scene-load':    'log-badge-combat',
  'weapon-attack': 'log-badge-roll',
};
const _LABEL = {
  'roll': 'Roll', 'hp-change': 'HP', 'death-save': 'Death',
  'combat-start': 'Combat\u2191', 'combat-end': 'Combat\u2193', 'scene-load': 'Scene',
  'weapon-attack': '\u2694\ufe0f Atk',
};

function _entryHtml(entry) {
  const badgeCls = _BADGE[entry.type] || 'log-badge-roll';
  const label    = _LABEL[entry.type] || entry.type;
  const ts       = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
  return '<div class="log-entry">' +
    '<span class="log-ts">' + ts + '</span>' +
    '<span class="log-badge ' + badgeCls + '">' + label + '</span>' +
    '<span style="flex:1;color:var(--text)">' + _esc(entry.message) + '</span>' +
  '</div>';
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export async function appendLogEntry({ type, message }) {
  if (!_state.dmCampaign) return;
  if (!_state.dmCampaign.log) _state.dmCampaign.log = [];
  _state.dmCampaign.log.push({ ts: new Date().toISOString(), type, message });
  if (_state.dmCampaign.log.length > 500) _state.dmCampaign.log = _state.dmCampaign.log.slice(-500);
  _state.serverData.campaigns[_state.dmCampaignId].log = _state.dmCampaign.log;
  await storageSetCompanion('dnd-hub', 'hub-dm', 'server', _state.serverData);
  const el = document.getElementById('tab-logs');
  if (el && !el.classList.contains('hidden')) renderLogsTab();
}

export async function clearLog() {
  if (!confirm('Clear the entire campaign log? This cannot be undone.')) return;
  _state.dmCampaign.log = [];
  _state.serverData.campaigns[_state.dmCampaignId].log = [];
  await storageSetCompanion('dnd-hub', 'hub-dm', 'server', _state.serverData);
  renderLogsTab();
}

export function exportLog() {
  const log   = _state.dmCampaign?.log || [];
  const lines = log.map(e => '[' + (e.ts ? new Date(e.ts).toLocaleString() : '') + '] [' + (e.type || '') + '] ' + (e.message || ''));
  const blob  = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = 'campaign-log.txt';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
