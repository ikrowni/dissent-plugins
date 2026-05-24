// dnd-master-journals.js — Journals tab: create, edit, delete, push to players
import { storageSetCompanion, realtimePublish, genId, esc } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _editingId = null; // journal id currently open in editor
let _editVisibility = 'dm';

export function setJournalsState(state) { _state = state; }

export function renderJournalsTab() {
  const el = document.getElementById('tab-journals');
  if (!el) return;
  if (_editingId) { _renderEditor(el); return; }
  const journals = Object.values(_state.dmCampaign?.journals || {})
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">JOURNALS</div>' +
    '<button class="btn btn-gold" onclick="newJournal()" style="width:100%;margin-bottom:10px">+ New Entry</button>' +
    (journals.length === 0
      ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px 0">No journal entries yet</div>'
      : journals.map(j => _journalRow(j)).join(''));
}

function _journalRow(j) {
  const vis = j.visibility === 'player' ? '\uD83D\uDC41 Player' : '\uD83D\uDD12 DM Only';
  return '<div class="scene-row" style="flex-direction:column;align-items:stretch;gap:4px">' +
    '<div style="display:flex;align-items:center;gap:6px">' +
      '<span style="flex:1;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis">' + esc(j.title) + '</span>' +
      '<span style="font-size:9px;color:var(--muted)">' + vis + '</span>' +
    '</div>' +
    '<div style="display:flex;gap:4px">' +
      '<button class="btn btn-ghost" onclick="editJournal(\'' + j.id + '\')" style="flex:1;font-size:10px;padding:3px 6px">Edit</button>' +
      (j.visibility === 'player'
        ? '<button class="btn btn-gold" onclick="pushHandout(\'' + j.id + '\')" style="flex:1;font-size:10px;padding:3px 6px">Push</button>'
        : '') +
      '<button onclick="deleteJournal(\'' + j.id + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0 4px" title="Delete">&#x2715;</button>' +
    '</div>' +
  '</div>';
}

function _renderEditor(el) {
  const j = _state.dmCampaign?.journals?.[_editingId] || { id: _editingId, title: '', content: '', visibility: 'dm', createdAt: new Date().toISOString() };
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">' +
      '<button class="btn btn-ghost" onclick="closeJournalEditor()" style="font-size:10px;padding:3px 8px">\u2190 Back</button>' +
      '<span style="font-size:11px;font-weight:700;color:var(--gold)">' + (j.title ? esc(j.title) : 'New Entry') + '</span>' +
    '</div>' +
    '<input id="journal-title" class="search-input" placeholder="Title" value="' + esc(j.title) + '" style="margin-bottom:6px">' +
    '<textarea id="journal-content" placeholder="Journal content\u2026" style="width:100%;min-height:160px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:11px;resize:vertical;outline:none;margin-bottom:6px">' + esc(j.content) + '</textarea>' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<span style="font-size:10px;color:var(--muted)">Visibility:</span>' +
      '<label style="font-size:10px;display:flex;align-items:center;gap:4px;cursor:pointer">' +
        '<input type="radio" name="jvis" value="dm"' + (j.visibility !== 'player' ? ' checked' : '') + ' onchange="setJournalVisibility(\'dm\')"> DM Only</label>' +
      '<label style="font-size:10px;display:flex;align-items:center;gap:4px;cursor:pointer">' +
        '<input type="radio" name="jvis" value="player"' + (j.visibility === 'player' ? ' checked' : '') + ' onchange="setJournalVisibility(\'player\')"> Player Visible</label>' +
    '</div>' +
    '<button class="btn btn-gold" onclick="saveJournal()" style="width:100%">\uD83D\uDCBE Save</button>';
  document.getElementById('journal-title')?.focus();
}

export function setJournalVisibility(v) { _editVisibility = v; }

export function newJournal() {
  _editingId = genId();
  _editVisibility = 'dm';
  renderJournalsTab();
}

export function editJournal(id) {
  _editingId = id;
  _editVisibility = _state.dmCampaign?.journals?.[id]?.visibility || 'dm';
  renderJournalsTab();
}

export function closeJournalEditor() { _editingId = null; renderJournalsTab(); }

export async function saveJournal() {
  const title = document.getElementById('journal-title')?.value?.trim();
  if (!title) { alert('Title is required.'); return; }
  const content = document.getElementById('journal-content')?.value || '';
  if (!_state.dmCampaign.journals) _state.dmCampaign.journals = {};
  const existing = _state.dmCampaign.journals[_editingId];
  _state.dmCampaign.journals[_editingId] = {
    id: _editingId, title, content,
    visibility: _editVisibility,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  _state.serverData.campaigns[_state.dmCampaignId] = _state.dmCampaign;
  await storageSetCompanion('dnd-hub', 'hub-dm', 'server', _state.serverData);
  _editingId = null;
  renderJournalsTab();
}

export async function deleteJournal(id) {
  if (!confirm('Delete this journal entry?')) return;
  delete _state.dmCampaign.journals[id];
  _state.serverData.campaigns[_state.dmCampaignId] = _state.dmCampaign;
  await storageSetCompanion('dnd-hub', 'hub-dm', 'server', _state.serverData);
  renderJournalsTab();
}

export async function pushHandout(id) {
  const j = _state.dmCampaign?.journals?.[id];
  if (!j || j.visibility !== 'player') return;
  await realtimePublish(EV.HANDOUT_PUSH, {
    type: EV.HANDOUT_PUSH, campaignId: _state.dmCampaignId,
    journalId: id, title: j.title, content: j.content,
    fromUserId: _state.userId,
  });
}
