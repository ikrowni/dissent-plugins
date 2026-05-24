// dnd-master-sounds.js — Sounds tab: upload, local test, broadcast
import { request, requestWithTransfer, storageGet, storageSet, realtimePublishCompanion, localPublish, genId, esc } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _localAudio = null; // currently playing local <audio> element

// Sounds are stored in dnd-master's own storage (not hub-dm) to avoid being
// overwritten when dnd-hub saves its own serverData on token/map events.
function _soundsKey() { return 'sounds-' + (_state.dmCampaignId || 'default'); }

export function setSoundsState(state) {
  _state = state;
  // Async-load sounds from own storage and repopulate the tab when ready.
  if (_state.dmCampaignId) {
    storageGet(_soundsKey(), 'server').then(sounds => {
      if (Array.isArray(sounds) && _state.dmCampaign) {
        _state.dmCampaign.sounds = sounds;
        renderSoundsTab();
      }
    }).catch(() => {});
  }
}

export function renderSoundsTab() {
  const el = document.getElementById('tab-sounds');
  if (!el) return;
  const sounds = _state.dmCampaign?.sounds || [];
  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">SOUNDS</div>' +
    '<button class="btn btn-gold" onclick="document.getElementById(\'sound-upload-input\').click()" style="width:100%;margin-bottom:10px">🎵 Upload Audio</button>' +
    '<input type="file" id="sound-upload-input" accept="audio/*" style="display:none" onchange="uploadNewSound()">' +
    (sounds.length === 0
      ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px 0">No sounds uploaded yet</div>'
      : sounds.map(s => _soundRow(s)).join(''));
}

function _soundRow(s) {
  return '<div class="scene-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-bottom:8px">' +
    '<div style="display:flex;align-items:center;gap:6px">' +
      '<span style="flex:1;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis">' + esc(s.name) + '</span>' +
      '<button onclick="deleteSoundEntry(\'' + s.id + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0 4px" title="Delete">&#x2715;</button>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:4px">' +
      '<span style="font-size:10px;color:var(--muted);min-width:40px">Vol</span>' +
      '<input type="range" id="svol-' + s.id + '" min="0" max="1" step="0.05" value="0.7" style="flex:1" oninput="updateSoundVolume(this.value)">' +
      '<label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--muted);cursor:pointer">' +
        '<input type="checkbox" id="sloop-' + s.id + '"> Loop</label>' +
    '</div>' +
    '<div style="display:flex;gap:4px">' +
      '<button class="btn btn-ghost" onclick="testSound(\'' + s.fileId + '\',\'' + s.id + '\')" style="flex:1;font-size:10px;padding:3px 6px">▶ Test</button>' +
      '<button class="btn btn-ghost" onclick="stopLocalSound()" style="font-size:10px;padding:3px 8px">■ Stop</button>' +
      '<button class="btn btn-gold" onclick="broadcastSound(\'' + s.fileId + '\',\'' + s.id + '\')" style="flex:1;font-size:10px;padding:3px 6px">📢 Broadcast</button>' +
    '</div>' +
  '</div>';
}

export async function uploadNewSound() {
  const input = document.getElementById('sound-upload-input');
  const file = input?.files?.[0];
  if (!file) return;
  const btn = document.querySelector('#tab-sounds .btn-gold');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  try {
    const buf = await file.arrayBuffer();
    const res = await requestWithTransfer('files:upload',
      { name: file.name, mime: file.type, size: file.size, dmOnly: false, data: buf },
      [buf], 120000);
    if (!res?.id) throw new Error('Upload returned no file ID');
    if (!_state.dmCampaign.sounds) _state.dmCampaign.sounds = [];
    _state.dmCampaign.sounds.push({ id: genId(), name: file.name.replace(/\.[^.]+$/, ''), fileId: res.id });
    await storageSet(_soundsKey(), _state.dmCampaign.sounds, 'server');
    if (input) input.value = '';
    renderSoundsTab();
  } catch (e) {
    alert('Upload failed: ' + (e?.message || String(e)));
    if (btn) { btn.disabled = false; btn.textContent = '🎵 Upload Audio'; }
  }
}

export async function testSound(fileId, rowId) {
  if (_localAudio) { _localAudio.pause(); _localAudio.src = ''; _localAudio = null; }
  try {
    const res = await request('files:getUrl', { fileId });
    if (!res?.url) throw new Error('No URL');
    const vol  = parseFloat(document.getElementById('svol-' + rowId)?.value  || '0.7');
    const loop = document.getElementById('sloop-' + rowId)?.checked || false;
    _localAudio = new Audio(res.url);
    _localAudio.volume = Math.min(1, Math.max(0, vol));
    _localAudio.loop   = loop;
    _localAudio.crossOrigin = 'anonymous';
    _localAudio.play().catch(e => alert('Playback error: ' + e.message));
  } catch (e) {
    alert('Playback failed: ' + (e?.message || String(e)));
  }
}

export function stopLocalSound() {
  if (_localAudio) { _localAudio.pause(); _localAudio.src = ''; _localAudio = null; }
}

export function updateSoundVolume(val) {
  if (_localAudio) _localAudio.volume = Math.min(1, Math.max(0, parseFloat(val) || 0));
}

export async function broadcastSound(fileId, rowId) {
  const vol  = parseFloat(document.getElementById('svol-' + rowId)?.value  || '0.7');
  const loop = document.getElementById('sloop-' + rowId)?.checked || false;
  const payload = { type: EV.AUDIO_PLAY, campaignId: _state.dmCampaignId, fileId, volume: vol, loop, fromUserId: _state.userId };
  realtimePublishCompanion('dnd-player', EV.AUDIO_PLAY, payload).catch(() => {});
  localPublish('dnd-player', EV.AUDIO_PLAY, payload);
  // DM hears their own broadcast locally (they don't have dnd-player open)
  if (_localAudio) { _localAudio.pause(); _localAudio.src = ''; _localAudio = null; }
  try {
    const res = await request('files:getUrl', { fileId });
    if (res?.url) {
      _localAudio = new Audio(res.url);
      _localAudio.volume = Math.min(1, Math.max(0, vol));
      _localAudio.loop   = loop;
      _localAudio.crossOrigin = 'anonymous';
      _localAudio.play().catch(() => {});
    }
  } catch { /* ignore */ }
}

export async function deleteSoundEntry(id) {
  if (!confirm('Remove this sound?')) return;
  _state.dmCampaign.sounds = (_state.dmCampaign.sounds || []).filter(s => s.id !== id);
  await storageSet(_soundsKey(), _state.dmCampaign.sounds, 'server');
  renderSoundsTab();
}
