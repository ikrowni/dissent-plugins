// dnd-master-maps.js — Maps tab: list, activate, rename, upload
import { request, requestWithTransfer, storageSetCompanion, realtimePublish, realtimePublishCompanion, localPublish, esc, genId } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _fileInput = null;
const _thumbCache = new Map(); // mapId → signedUrl

export function setMapsState(state) { _state = state; }

export function renderMapsTab() {
  const el = document.getElementById('tab-maps');
  if (!el) return;
  const maps    = _state.dmCampaign?.maps    || {};
  const activeId = _state.dmCampaign?.activeMapId || null;
  const mapList  = Object.values(maps);

  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">MAPS</div>' +
    '<button class="btn btn-gold" onclick="uploadNewMap()" style="width:100%;margin-bottom:10px">&#x1F4C1; Upload New Map</button>' +
    (mapList.length === 0
      ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:16px">No maps uploaded yet</div>'
      : mapList.map(m => _mapRow(m, activeId)).join('')
    );

  _loadThumbnails(mapList);
}

async function _loadThumbnails(mapList) {
  const toFetch = mapList.filter(m => m.fileId && !_thumbCache.has(m.id));
  if (!toFetch.length) return;
  await Promise.all(toFetch.map(async m => {
    try {
      const r = await request('files:getUrl', { fileId: m.fileId });
      if (r?.url) _thumbCache.set(m.id, r.url);
    } catch { /* ignore */ }
  }));
  // Re-render rows with thumbnails now that URLs are available
  const activeId = _state.dmCampaign?.activeMapId || null;
  const maps = Object.values(_state.dmCampaign?.maps || {});
  const listEl = document.getElementById('tab-maps');
  if (!listEl) return;
  // Only update map rows, not the header/button
  const rowsHtml = maps.map(m => _mapRow(m, activeId)).join('');
  const uploadBtn = listEl.querySelector('.btn-gold');
  if (uploadBtn) {
    // Replace everything after the upload button
    const existingRows = listEl.querySelectorAll('.map-row');
    existingRows.forEach(r => r.remove());
    const emptyMsg = listEl.querySelector('[data-empty]');
    if (emptyMsg) emptyMsg.remove();
    listEl.insertAdjacentHTML('beforeend', rowsHtml);
  }
}

function _mapRow(m, activeId) {
  const isActive = m.id === activeId;
  const thumb = _thumbCache.get(m.id);
  const thumbHtml = thumb
    ? `<img src="${thumb}" style="width:44px;height:33px;object-fit:cover;border-radius:3px;flex-shrink:0" onerror="this.style.display='none'">`
    : `<div style="width:44px;height:33px;background:rgba(255,255,255,.06);border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px">&#x1F5FA;&#xFE0F;</div>`;
  return '<div class="map-row' + (isActive ? ' active-map' : '') + '" style="gap:8px">' +
    thumbHtml +
    '<span class="map-name-label" data-mapid="' + m.id + '" onclick="renameMapInline(\'' + m.id + '\')"' +
      ' style="flex:1;font-size:11px;font-weight:600;cursor:text;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Click to rename">' +
      esc(m.name) + '</span>' +
    (isActive
      ? '<span style="font-size:9px;color:var(--gold);font-weight:700;flex-shrink:0">ACTIVE</span>'
      : '<button class="btn btn-ghost" onclick="activateMapFromList(\'' + m.id + '\')" style="font-size:10px;padding:3px 8px;flex-shrink:0">Activate</button>'
    ) +
    '<button onclick="deleteMap(\'' + m.id + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0 2px;flex-shrink:0" title="Delete">&#x2715;</button>' +
  '</div>';
}

export function renameMapInline(mapId) {
  const label = document.querySelector('.map-name-label[data-mapid="' + mapId + '"]');
  if (!label) return;
  const currentName = label.textContent;
  const input = document.createElement('input');
  input.value = currentName;
  input.style.cssText = 'font-size:11px;font-weight:600;flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.25);border-radius:3px;padding:2px 5px;color:#fff;outline:none;min-width:0;width:100%';
  label.replaceWith(input);
  input.focus(); input.select();

  const saveRename = async () => {
    const newName = input.value.trim() || currentName;
    const maps = _state.dmCampaign?.maps || {};
    if (maps[mapId]) {
      maps[mapId].name = newName;
      _state.serverData.campaigns[_state.dmCampaignId].maps = maps;
      await saveHubDmCompanion(_state.serverData);
    }
    renderMapsTab();
  };
  input.onblur = saveRename;
  input.onkeydown = e => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') renderMapsTab();
  };
}

export async function activateMapFromList(mapId) {
  const maps = _state.dmCampaign?.maps || {};
  const m    = maps[mapId];
  if (!m) return;
  try {
    const r = await request('files:getUrl', { fileId: m.fileId });
    if (!r?.url) { alert('Could not get map URL.'); return; }
    _state.dmCampaign.activeMapId = mapId;
    _state.serverData.campaigns[_state.dmCampaignId].activeMapId = mapId;
    await saveHubDmCompanion(_state.serverData);
    const mapPayload = { type: EV.MAP_SET, campaignId: _state.dmCampaignId, mapId, fileId: m.fileId, signedUrl: r.url, mapEntry: m };
    // Reach all hub canvas instances (players + DM's own hub tab)
    localPublish('dnd-hub', EV.MAP_SET, mapPayload);
    await realtimePublishCompanion('dnd-hub', EV.MAP_SET, mapPayload);
    renderMapsTab();
  } catch (err) {
    alert('Failed to activate map: ' + err.message);
  }
}

export function uploadNewMap() {
  if (!_fileInput) {
    _fileInput = document.createElement('input');
    _fileInput.type = 'file';
    _fileInput.accept = 'image/*,video/*';
    _fileInput.style.display = 'none';
    _fileInput.addEventListener('change', () => {
      const file = _fileInput.files[0];
      _fileInput.value = '';
      if (file) _handleMapFile(file);
    });
    document.body.appendChild(_fileInput);
  }
  _fileInput.click();
}

async function _handleMapFile(file) {
  const btn = document.querySelector('[onclick="uploadNewMap()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Uploading…'; }
  try {
    const buf          = await file.arrayBuffer();
    const uploadResult = await requestWithTransfer('files:upload',
      { name: file.name, mime: file.type, dmOnly: false, data: buf }, [buf], 120000);
    const fileId = uploadResult?.id;
    const url    = uploadResult?.url;
    if (!fileId || !url) throw new Error('Upload response missing id or url');

    const mapId    = genId();
    const mapEntry = {
      id: mapId, fileId,
      name: file.name.replace(/\.[^.]+$/, ''),
      mime: file.type || 'image/png',
      gridSize: 40, gridType: 'square', gridEnabled: true,
      gridOffsetX: 0, gridOffsetY: 0,
      gridColor: '#ffffff', gridAlpha: 0.08,
      walls: [], doors: {}, tokens: {}, fogState: {},
    };
    if (!_state.dmCampaign.maps) _state.dmCampaign.maps = {};
    _state.dmCampaign.maps[mapId]    = mapEntry;
    _state.dmCampaign.activeMapId    = mapId;
    _state.serverData.campaigns[_state.dmCampaignId].maps      = _state.dmCampaign.maps;
    _state.serverData.campaigns[_state.dmCampaignId].activeMapId = mapId;
    _thumbCache.set(mapId, url);
    await saveHubDmCompanion(_state.serverData);
    const uploadPayload = { type: EV.MAP_SET, campaignId: _state.dmCampaignId, mapId, fileId, signedUrl: url };
    localPublish('dnd-hub', EV.MAP_SET, uploadPayload);
    await realtimePublishCompanion('dnd-hub', EV.MAP_SET, uploadPayload);
    renderMapsTab();
  } catch (err) {
    alert('Upload failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📁 Upload New Map'; }
  }
}

export async function deleteMap(mapId) {
  if (!confirm('Delete this map? Tokens and walls on it will be lost.')) return;
  const maps = _state.dmCampaign?.maps || {};
  delete maps[mapId];
  _thumbCache.delete(mapId);
  if (_state.dmCampaign.activeMapId === mapId) _state.dmCampaign.activeMapId = null;
  _state.serverData.campaigns[_state.dmCampaignId].maps      = maps;
  _state.serverData.campaigns[_state.dmCampaignId].activeMapId = _state.dmCampaign.activeMapId;
  await saveHubDmCompanion(_state.serverData);
  renderMapsTab();
}
