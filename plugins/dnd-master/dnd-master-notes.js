// dnd-master-notes.js — Notes tab: freeform DM notes, debounce-saved every 2 s
import { storageSetCompanion } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';

let _state        = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _debounceTimer = null;
let _statusEl      = null;

export function setNotesState(state) { _state = state; }

export function renderNotesTab() {
  const el = document.getElementById('tab-notes');
  if (!el) return;
  const notes = _state.dmCampaign?.notes || '';
  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">CAMPAIGN NOTES</div>' +
    '<textarea id="notes-area" placeholder="Session notes, NPC details, plot hooks\u2026">' + _esc(notes) + '</textarea>' +
    '<div class="notes-status" id="notes-status"></div>';
  _statusEl = document.getElementById('notes-status');
  document.getElementById('notes-area')?.addEventListener('input', e => _onInput(e.target.value));
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _onInput(value) {
  clearTimeout(_debounceTimer);
  if (_statusEl) _statusEl.textContent = 'Unsaved\u2026';
  _debounceTimer = setTimeout(() => _save(value), 2000);
}

async function _save(value) {
  _state.dmCampaign.notes = value;
  _state.serverData.campaigns[_state.dmCampaignId].notes = value;
  await saveHubDmCompanion(_state.serverData);
  if (_statusEl) { _statusEl.textContent = 'Saved'; setTimeout(() => { if (_statusEl) _statusEl.textContent = ''; }, 2000); }
}
