// dnd-master-scenes.js — Scenes tab: create, delete, load
import { requestWithTransfer, storageSetCompanion, realtimePublish, realtimePublishCompanion, genId, esc } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js?v=20260502p4';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _pendingVideo = null; // File object selected but not yet uploaded
let _pendingAudio = null; // File object selected but not yet uploaded

export function setScenesState(state) { _state = state; }

export function renderScenesTab() {
  const el = document.getElementById('tab-scenes');
  if (!el) return;
  const scenes = Object.values(_state.dmCampaign?.scenes || {});
  const maps   = Object.values(_state.dmCampaign?.maps   || {});
  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">SCENES</div>' +
    (scenes.length === 0
      ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px 0">No scenes yet</div>'
      : scenes.map(s => _sceneRow(s)).join('')) +
    _sceneForm(maps);
}

function _sceneRow(s) {
  return '<div class="scene-row">' +
    '<span style="flex:1;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name) + '</span>' +
    '<button class="btn btn-gold" onclick="loadScene(\'' + s.id + '\')" style="font-size:10px;padding:3px 8px">Load</button>' +
    '<button onclick="deleteScene(\'' + s.id + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0 4px" title="Delete">&#x2715;</button>' +
  '</div>';
}

function _sceneForm(maps) {
  const shops   = Object.values(_state.dmCampaign?.shops || {});
  const mapOpts  = maps.map(m => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join('');
  const shopOpts = shops.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('');
  return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">' +
    '<div style="font-size:10px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">NEW SCENE</div>' +
    '<input id="scene-name-input" class="search-input" placeholder="Scene name" style="margin-bottom:6px">' +
    '<select id="scene-map-select" class="search-input" style="margin-bottom:6px">' +
      '<option value="">\u2014 No map change \u2014</option>' + mapOpts +
    '</select>' +
    '<select id="scene-shop-select" class="search-input" style="margin-bottom:6px">' +
      '<option value="">\u2014 No shop \u2014</option>' + shopOpts +
    '</select>' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
      '<span style="font-size:10px;color:var(--muted);min-width:60px">Video BG</span>' +
      '<button class="btn btn-ghost" onclick="document.getElementById(\'scene-video-input\').click()" style="font-size:10px;padding:3px 8px">Choose\u2026</button>' +
      '<span id="scene-video-label" style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis">none</span>' +
    '</div>' +
    '<input type="file" id="scene-video-input" accept="video/*,image/*" style="display:none" onchange="onSceneVideoSelected()">' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
      '<span style="font-size:10px;color:var(--muted);min-width:60px">Soundtrack</span>' +
      '<button class="btn btn-ghost" onclick="document.getElementById(\'scene-audio-input\').click()" style="font-size:10px;padding:3px 8px">Choose\u2026</button>' +
      '<span id="scene-audio-label" style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis">none</span>' +
    '</div>' +
    '<input type="file" id="scene-audio-input" accept="audio/*" style="display:none" onchange="onSceneAudioSelected()">' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">' +
      '<span style="font-size:10px;color:var(--muted);min-width:60px">Volume</span>' +
      '<input type="range" id="scene-volume" min="0" max="1" step="0.05" value="0.5" style="flex:1">' +
    '</div>' +
    '<button class="btn btn-gold" onclick="saveNewScene()" style="width:100%">\uD83D\uDCBE Save Scene</button>' +
  '</div>';
}

export function onSceneVideoSelected() {
  const input = document.getElementById('scene-video-input');
  _pendingVideo = input?.files?.[0] || null;
  const label = document.getElementById('scene-video-label');
  if (label) label.textContent = _pendingVideo ? _pendingVideo.name : 'none';
}

export function onSceneAudioSelected() {
  const input = document.getElementById('scene-audio-input');
  _pendingAudio = input?.files?.[0] || null;
  const label = document.getElementById('scene-audio-label');
  if (label) label.textContent = _pendingAudio ? _pendingAudio.name : 'none';
}

export async function saveNewScene() {
  const name = document.getElementById('scene-name-input')?.value?.trim();
  if (!name) { alert('Scene name is required.'); return; }
  const mapId = document.getElementById('scene-map-select')?.value || null;
  const volume = parseFloat(document.getElementById('scene-volume')?.value || '0.5');
  const btn = document.querySelector('#tab-scenes .btn-gold:last-of-type');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }

  let videoFileId = null, soundtrackFileId = null;
  try {
    if (_pendingVideo) {
      const buf = await _pendingVideo.arrayBuffer();
      const res = await requestWithTransfer('files:upload',
        { name: _pendingVideo.name, mime: _pendingVideo.type, size: _pendingVideo.size, dmOnly: false, data: buf },
        [buf], 120000);
      videoFileId = res?.id || null;
    }
    if (_pendingAudio) {
      const buf = await _pendingAudio.arrayBuffer();
      const res = await requestWithTransfer('files:upload',
        { name: _pendingAudio.name, mime: _pendingAudio.type, size: _pendingAudio.size, dmOnly: false, data: buf },
        [buf], 120000);
      soundtrackFileId = res?.id || null;
    }
  } catch (e) {
    alert('Upload failed: ' + (e?.message || String(e)));
    if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDCBE Save Scene'; }
    return;
  }

  const id = genId();
  if (!_state.dmCampaign.scenes) _state.dmCampaign.scenes = {};
  const shopId = document.getElementById('scene-shop-select')?.value || null;
  _state.dmCampaign.scenes[id] = { id, name, mapId: mapId || null, shopId, videoFileId, soundtrackFileId, ambientVolume: volume };
  _state.serverData.campaigns[_state.dmCampaignId] = _state.dmCampaign;
  await saveHubDmCompanion(_state.serverData);
  _pendingVideo = null; _pendingAudio = null;
  renderScenesTab();
}

export async function deleteScene(id) {
  if (!confirm('Delete this scene?')) return;
  delete _state.dmCampaign.scenes[id];
  _state.serverData.campaigns[_state.dmCampaignId] = _state.dmCampaign;
  await saveHubDmCompanion(_state.serverData);
  renderScenesTab();
}

export async function loadScene(id) {
  const scene = _state.dmCampaign.scenes?.[id];
  if (!scene) return;
  await realtimePublish(EV.SCENE_LOAD, {
    type: EV.SCENE_LOAD, campaignId: _state.dmCampaignId,
    sceneId: id, mapId: scene.mapId,
    shopId: scene.shopId || null,
    videoFileId: scene.videoFileId, soundtrackFileId: scene.soundtrackFileId,
    ambientVolume: scene.ambientVolume, fromUserId: _state.userId,
  });
  await realtimePublishCompanion('dnd-player', EV.SCENE_LOAD, {
    type: EV.SCENE_LOAD, campaignId: _state.dmCampaignId,
    sceneId: id, shopId: scene.shopId || null,
    fromUserId: _state.userId,
  });
}
