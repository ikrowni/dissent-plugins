// dnd-hub-map-bg.js — map background loading, upload, fitSprite, loadMapData
import { MAP, serverData } from './dnd-hub-state.js?v=20260502p4';
import { request, requestWithTransfer, storageSet, realtimePublish, genId } from '../plugin-sdk.js';
import { renderGrid } from './dnd-hub-grid.js?v=20260502p4';
import { renderTokens } from './dnd-hub-tokens.js?v=20260502p4';
import { renderFog } from './dnd-hub-fog.js?v=20260502p4';
import { renderWalls } from './dnd-hub-walls.js?v=20260502p4';
import { renderInitiativeHUD } from './dnd-hub-initiative.js?v=20260502p4';
import { computeLocalPlayerLOS } from './dnd-hub-los.js?v=20260502p4';
import { saveHubDm } from './dnd-hub-storage.js?v=20260502p4';

export function fitSprite(sprite, w, h, imgW, imgH) {
  // Math.min = letterbox: full map visible, image anchored at _bgOffset.
  // Grid, fog, and token snapping all align with this offset.
  // imgW/imgH are optional explicit image dimensions — use them instead of
  // sprite.texture.width/height when the texture hasn't decoded its first
  // frame yet (common for video textures at oncanplay time).
  const iw = imgW || sprite.texture.width;
  const ih = imgH || sprite.texture.height;
  const scale = Math.min(w / iw, h / ih);
  sprite.scale.set(scale);
  sprite.x = (w - iw * scale) / 2;
  sprite.y = (h - ih * scale) / 2;
  MAP._bgOffset = { x: sprite.x, y: sprite.y };
  MAP._bgScale  = scale;
  MAP._bgImgW   = iw;
  MAP._bgImgH   = ih;
}

export async function renderMapBackground() {
  const layers = MAP.layers;
  if (!layers?.bg) return;
  layers.bg.removeChildren();
  if (MAP._bgBlobUrl) { URL.revokeObjectURL(MAP._bgBlobUrl); MAP._bgBlobUrl = null; }

  const mapData = MAP.mapData;
  if (!mapData?.fileId) return;

  const app = MAP.app;

  // Remove any previous video ticker callback before adding a new one.
  // Without this, every background load stacks another callback on the same ticker,
  // and old callbacks fire tex.source.update() on dead/unmounted textures — causing
  // the glCopySubTextureCHROMIUM error flood every render frame.
  if (MAP._bgTickerCb) { app?.ticker?.remove(MAP._bgTickerCb); MAP._bgTickerCb = null; }

  // Determine mime.  If stored in mapData (new maps), use that — avoids a full
  // ArrayBuffer load just to discover it's a video.  Fall back to loading bytes.
  const storedMime = mapData.mime || '';
  const isVideo = storedMime ? storedMime.startsWith('video/') : false;
  const needsProbe = !storedMime;

  if (isVideo) {
    // ── Video path ──────────────────────────────────────────────────────────
    // Blob URLs created in a null-origin iframe CANNOT be used as WebGL
    // textures (SecurityError: the operation is insecure).  Instead, fetch the
    // server-side HTTPS URL — CORS headers are *, so texImage2D is allowed.
    let videoUrl;
    try {
      const res = await request('files:getUrl', { fileId: mapData.fileId });
      videoUrl = res?.url;
      if (!videoUrl) throw new Error('empty url');
    } catch (e) {
      alert('Failed to get video URL: ' + (e?.message || String(e)));
      return;
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; // required so WebGL can use the texture
    video.src = videoUrl;
    video.loop = true; video.muted = true; video.autoplay = true; video.playsInline = true;

    // Wait for canplay — this guarantees videoWidth/videoHeight are set AND at least
    // one frame has been decoded into the video element, so PIXI.Texture.from(video)
    // can successfully upload the first frame to the GPU.  loadedmetadata alone is not
    // sufficient: the GPU texture isn't allocated until the first frame decode, so any
    // tex.source.update() call before that triggers glCopySubTextureCHROMIUM errors.
    const videoReady = await new Promise(r => {
      const done = (result) => { video.onloadedmetadata = null; video.oncanplay = null; video.onerror = null; r(result); };
      video.onloadedmetadata = () => video.play().catch(() => {}); // start decode early
      video.oncanplay = () => done('ok');
      video.onerror = () => done('error');
      if (video.readyState >= 3) done('ok'); // already buffered (e.g. re-render)
    });
    if (videoReady === 'error') {
      alert('Failed to load video map — CORS or network error.\nCheck browser console for details.');
      return;
    }

    // Capture dims — available after loadedmetadata (called inside the promise above).
    const vw = video.videoWidth  || mapData.mapW;
    const vh = video.videoHeight || mapData.mapH;

    // Back-fill stored dims so future reloads never fall back to texture.width/height.
    if (vw && !mapData.mapW) {
      mapData.mapW = vw;
      mapData.mapH = vh;
    }

    const tex = PIXI.Texture.from(video);
    const sprite = new PIXI.Sprite(tex);
    // Pass explicit dims — tex.width may still be 0 until the first ticker update.
    fitSprite(sprite, app.screen.width, app.screen.height, vw, vh);
    layers.bg.addChild(sprite);
    // Track the callback so it can be removed before the next background load.
    MAP._bgTickerCb = () => tex.source.update();
    app.ticker.add(MAP._bgTickerCb);
    // No blob URL to revoke; video stays alive via the sprite reference

  } else {
    // ── Image path (or mime unknown — probe via ArrayBuffer) ────────────────
    let mime = storedMime;
    let blobUrl;
    try {
      const result = await request('files:loadArrayBuffer', { fileId: mapData.fileId });
      mime = result?.mime || 'application/octet-stream';
      if (needsProbe && mime.startsWith('video/')) {
        // Edge case: old map entry without stored mime, and file turned out to
        // be a video.  Re-enter via the video path by temporarily patching mime.
        mapData.mime = mime;
        return renderMapBackground();
      }
      blobUrl = URL.createObjectURL(new Blob([result.buffer], { type: mime }));
    } catch (e) {
      alert('Failed to load map image: ' + (e?.message || String(e)));
      return;
    }

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Image failed to load from blob URL'));
      img.src = blobUrl;
    });
    URL.revokeObjectURL(blobUrl);
    const tex = PIXI.Texture.from(img);
    const sprite = new PIXI.Sprite(tex);
    fitSprite(sprite, app.screen.width, app.screen.height);
    layers.bg.addChild(sprite);
  }

  const statusEl = document.getElementById('map-status');
  if (statusEl) statusEl.style.display = 'none';

  // Persist layout so the DM sidebar can compute off-map spawn coordinates
  // without needing hub runtime state (MAP._bgOffset is only in hub memory).
  if (MAP.mapData && MAP._bgOffset != null && MAP._bgScale != null) {
    MAP.mapData.bgOffsetX = MAP._bgOffset.x;
    MAP.mapData.bgOffsetY = MAP._bgOffset.y;
    MAP.mapData.bgScaledW = MAP._bgImgW * MAP._bgScale;
    MAP.mapData.bgScaledH = MAP._bgImgH * MAP._bgScale;
    if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
      serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
      saveHubDm( serverData).catch(() => {});
    }
  }
}

export async function loadMapData(campaignId) {
  const c = serverData?.campaigns?.[campaignId];
  if (!c) return;
  const activeMapId = c.activeMapId;
  if (!activeMapId || !c.maps?.[activeMapId]) { renderNoMapPlaceholder(); return; }

  MAP.mapId = activeMapId;
  MAP.mapData = c.maps[activeMapId];
  MAP.templates = [];
  await renderMapBackground();
  renderGrid();
  renderTokens();
  if (!MAP.isDM) computeLocalPlayerLOS();
  renderFog();
  renderWalls();
  renderInitiativeHUD(serverData?.campaigns?.[campaignId]?.initiative);
  syncGridPanel();
}

export async function setGridSettings(patch) {
  if (!MAP.mapData) return;
  if (patch.gridSize !== undefined) patch.gridSize = Math.max(10, Math.min(200, patch.gridSize));
  Object.assign(MAP.mapData, patch);
  if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
    serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  renderGrid();
  renderFog();
  renderTokens();
  syncGridPanel();
  await realtimePublish('map:grid-settings', {
    type: 'map:grid-settings',
    campaignId: MAP.campaignId,
    mapId: MAP.mapId,
    gridSize: MAP.mapData.gridSize,
    gridOffsetX: MAP.mapData.gridOffsetX,
    gridOffsetY: MAP.mapData.gridOffsetY,
    gridColor: MAP.mapData.gridColor,
    gridAlpha: MAP.mapData.gridAlpha,
  });
}

export function syncGridPanel() {
  if (!MAP.mapData) return;
  const ox = document.getElementById('grid-offset-x');
  const oy = document.getElementById('grid-offset-y');
  const gs = document.getElementById('grid-size-display');
  const ai = document.getElementById('grid-alpha-input');
  const av = document.getElementById('grid-alpha-val');
  const ci = document.getElementById('grid-color-input');
  if (ox) ox.textContent = MAP.mapData.gridOffsetX || 0;
  if (oy) oy.textContent = MAP.mapData.gridOffsetY || 0;
  if (gs) gs.textContent = MAP.mapData.gridSize || 40;
  const alphaVal = Math.round((MAP.mapData.gridAlpha ?? 0.08) * 100);
  if (ai) ai.value = alphaVal;
  if (av) av.textContent = alphaVal + '%';
  if (ci) ci.value = MAP.mapData.gridColor || '#ffffff';
}

export function toggleGridPanel() {
  const panel = document.getElementById('grid-panel');
  if (!panel) return;
  const isVisible = panel.style.display === 'flex';
  panel.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible) syncGridPanel();
  const btn = document.getElementById('btn-grid-settings');
  if (btn) btn.classList.toggle('active', !isVisible);
}

export async function removeAllWalls() {
  if (!MAP.mapData) return;
  if (!confirm('Remove all walls? This cannot be undone.')) return;
  MAP.mapData.walls = [];
  MAP.selectedWall = null;
  if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
    serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  renderWalls();
  await realtimePublish('walls:update', { type: 'walls:update', campaignId: MAP.campaignId, walls: [] });
}

export async function removeAllDoors() {
  if (!MAP.mapData) return;
  if (!confirm('Remove all doors? This cannot be undone.')) return;
  MAP.mapData.doors = {};
  MAP.selectedDoor = null;
  if (serverData?.campaigns?.[MAP.campaignId]?.maps?.[MAP.mapId]) {
    serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  renderWalls();
  await realtimePublish('door:state', { type: 'door:state', campaignId: MAP.campaignId, doors: {} });
}

export function renderNoMapPlaceholder() {
  if (!MAP.app) return;
  const txt = new PIXI.Text({
    text: MAP.isDM ? 'No map loaded\nClick 📁 Map in the toolbar to upload one' : 'Waiting for DM to load a map…',
    style: new PIXI.TextStyle({ fill: 0x888888, fontSize: 14, align: 'center', wordWrap: true, wordWrapWidth: 300 }),
  });
  txt.anchor.set(0.5);
  txt.x = MAP.app.screen.width / 2;
  txt.y = MAP.app.screen.height / 2;
  MAP.layers.ui.addChild(txt);
  const statusEl = document.getElementById('map-status');
  if (statusEl) statusEl.style.display = 'none';
}

export function triggerMapUpload() {
  document.getElementById('map-file-input')?.click();
}

export async function handleMapUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  const btn = document.getElementById('btn-upload-map');
  if (btn) { btn.textContent = '⏳ Uploading…'; btn.disabled = true; }

  try {
    const buf = await file.arrayBuffer();
    // attachContext ties the file to this campaign so it is reclaimed when the
    // campaign is deleted, and is never treated as an abandoned upload by the
    // node's 7-day sweep. See the plugin-storage spec §7.
    const uploadResult = await requestWithTransfer('files:upload', {
      name: file.name, mime: file.type, size: file.size, dmOnly: false, data: buf,
      attachContext: `campaign:${MAP.campaignId}`,
    }, [buf], 120000);

    const fileId = uploadResult?.id;
    if (!fileId) throw new Error('Upload response missing file id');
    const url = uploadResult?.url;
    if (!url) throw new Error('Upload response missing url');

    const mapId = genId();
    const mapEntry = {
      id: mapId, fileId,
      name: file.name.replace(/\.[^.]+$/, ''),
      mime: file.type || 'image/png',
      gridSize: 40, gridType: 'square', gridEnabled: true,
      gridOffsetX: 0, gridOffsetY: 0,
      gridColor: '#ffffff', gridAlpha: 0.08,
      walls: [], doors: {}, lights: [], audioZones: [], triggers: [], tokens: {}, fogState: {},
    };

    if (!serverData.campaigns[MAP.campaignId].maps) serverData.campaigns[MAP.campaignId].maps = {};
    serverData.campaigns[MAP.campaignId].maps[mapId] = mapEntry;
    serverData.campaigns[MAP.campaignId].activeMapId = mapId;
    serverData.campaigns[MAP.campaignId].updatedAt = new Date().toISOString();
    await saveHubDm( serverData);

    MAP.mapId = mapId;
    MAP.mapData = mapEntry;

    await realtimePublish('map:set', { type: 'map:set', campaignId: MAP.campaignId, mapId, fileId, signedUrl: url });

    await renderMapBackground();
    renderGrid();
    renderTokens();
    renderFog();
  } catch (err) {
    alert('Upload failed: ' + err.message);
  } finally {
    if (btn) { btn.textContent = '📁 Map'; btn.disabled = false; }
  }
}

// ── UniversalVTT (Dungeon Alchemist) import ───────────────────────────────────
let _vttDD2 = null, _vttVideo = null;

export function toggleVTTPanel() {
  const panel = document.getElementById('vtt-panel');
  if (!panel) return;
  const visible = panel.style.display === 'flex';
  panel.style.display = visible ? 'none' : 'flex';
  const btn = document.getElementById('btn-vtt-import');
  if (btn) btn.classList.toggle('active', !visible);
}

export function onVTTFileSelected() {
  _vttDD2 = document.getElementById('vtt-dd2vtt-input')?.files?.[0] || null;
  _updateVTTBtn();
}

export function onVTTVideoSelected() {
  _vttVideo = document.getElementById('vtt-video-input')?.files?.[0] || null;
  _updateVTTBtn();
}

function _updateVTTBtn() {
  const btn = document.getElementById('btn-run-vtt');
  if (!btn) return;
  const dd2Label = document.getElementById('vtt-dd2-label');
  const vidLabel = document.getElementById('vtt-vid-label');
  if (dd2Label) dd2Label.textContent = _vttDD2 ? _vttDD2.name : 'Choose .dd2vtt…';
  if (vidLabel) vidLabel.textContent = _vttVideo ? _vttVideo.name : 'Choose video…';
  btn.disabled = !(_vttDD2 && _vttVideo);
}

export async function runVTTImport() {
  if (!_vttDD2 || !_vttVideo || !MAP.app) return;
  const btn = document.getElementById('btn-run-vtt');
  if (btn) { btn.textContent = '⏳ Uploading…'; btn.disabled = true; }

  // Warn about Cloudflare's ~100 MB upload limit on free tier
  if (_vttVideo.size > 95 * 1024 * 1024) {
    const mb = (_vttVideo.size / 1024 / 1024).toFixed(0);
    if (!confirm(`This video is ${mb} MB. Uploads over ~100 MB may fail due to server limits. Continue anyway?`)) {
      if (btn) { btn.textContent = 'Import'; btn.disabled = false; }
      return;
    }
  }

  try {
    // 1. Parse dd2vtt
    let dd;
    try {
      dd = JSON.parse(await _vttDD2.text());
    } catch (e) {
      throw new Error('Failed to parse .dd2vtt file: ' + e.message);
    }
    const ppg      = dd.resolution.pixels_per_grid;
    const mapCellW = dd.resolution.map_size.x;
    const mapCellH = dd.resolution.map_size.y;

    // 2a. Probe actual video dimensions before computing wall coords.
    //     This mirrors exactly what fitSprite() will use, so walls land on grid lines.
    //     IMPORTANT: read videoWidth/videoHeight BEFORE clearing src — clearing resets them to 0.
    const probeUrl = URL.createObjectURL(_vttVideo);
    const { actualW, actualH } = await new Promise(resolve => {
      const v = document.createElement('video');
      v.onloadedmetadata = () => {
        const w = v.videoWidth, h = v.videoHeight; // capture before clearing src
        v.src = '';
        resolve({ actualW: w, actualH: h });
      };
      v.onerror = () => resolve({ actualW: mapCellW * ppg, actualH: mapCellH * ppg });
      v.src = probeUrl;
    });
    URL.revokeObjectURL(probeUrl);
    console.log('[VTT] video dims:', actualW, 'x', actualH, '| dd2vtt theoretical:', mapCellW * ppg, 'x', mapCellH * ppg);

    // 2b. Upload video
    let buf;
    try {
      buf = await _vttVideo.arrayBuffer();
    } catch (e) {
      throw new Error('Failed to read video file: ' + e.message);
    }
    const mime = (_vttVideo.type || 'video/webm').split(';')[0].trim();
    let upload;
    try {
      upload = await requestWithTransfer('files:upload', {
        name: _vttVideo.name, mime, size: _vttVideo.size,
        dmOnly: false, data: buf,
      }, [buf], 300000);
    } catch (e) {
      throw new Error('Upload failed: ' + e.message);
    }
    if (!upload?.id) throw new Error('Upload response missing file id');

    // 3. Compute scale/offset matching fitSprite() exactly.
    //    Use actual video dimensions so wall coords align with the rendered background.
    const canvasW = MAP.app.screen.width;
    const canvasH = MAP.app.screen.height;
    const scale   = Math.min(canvasW / actualW, canvasH / actualH);
    const bgX     = (canvasW - actualW * scale) / 2;
    const bgY     = (canvasH - actualH * scale) / 2;

    // Exact pixels-per-cell on screen — NOT rounded.  Rounding here causes walls
    // to drift from grid lines (e.g. 0.33px/cell → 6.7px off at the far edge of
    // a 20-cell map).  renderGrid() uses this float directly so they stay in sync.
    const cellPx  = (actualW * scale) / mapCellW;  // = ppg * scale when dims match
    const gridSize = cellPx;                        // store precise float

    console.log('[VTT] scale:', scale.toFixed(4), '| bgX:', bgX.toFixed(1), '| cellPx:', cellPx.toFixed(3));

    // 4. Convert line_of_sight → walls in cell-space (canvas-size-independent).
    //    renderWalls() converts to canvas pixels at render time via wallFmt:'cell'.
    const walls = (dd.line_of_sight || []).map(seg => ({
      id: genId(), cx1: seg[0].x, cy1: seg[0].y, cx2: seg[1].x, cy2: seg[1].y,
    }));

    // 5. Convert portals → doors/windows in cell-space.
    // In UVTT, freestanding:false means the portal sits in a wall gap (door or window).
    // freestanding:true means it's a standalone archway (open passage, no wall).
    // Windows are wall-attached portals that are never closed (closed:false, freestanding:false).
    // Mark them isWindow:true so wouldCrossWall() always blocks them regardless of state.
    const doors = {};
    (dd.portals || []).forEach(portal => {
      const id = genId();
      const inWall = portal.freestanding === false || portal.freestanding === undefined;
      const isWindow = !portal.closed && inWall;
      doors[id] = { id,
        cx1: portal.bounds[0].x, cy1: portal.bounds[0].y,
        cx2: portal.bounds[1].x, cy2: portal.bounds[1].y,
        state: portal.closed ? 'closed' : 'open',
        ...(isWindow && { isWindow: true }),
      };
    });

    // 6. Convert lights to cell-space
    const lights = (dd.lights || []).map(l => ({
      cx: l.position.x, cy: l.position.y,
      range: l.range,       // in grid cells
      intensity: l.intensity,
      color: l.color,       // AARRGGBB hex string
      shadows: l.shadows,
    }));

    // 7. Create map entry
    const mapId = genId();
    const mapEntry = {
      id: mapId, fileId: upload.id,
      name: _vttVideo.name.replace(/\.[^.]+$/, ''),
      mime,
      // Natural video dimensions — used by renderMapBackground() on reload so
      // fitSprite() uses correct dims even if the Pixi texture reports 0×0.
      mapW: actualW, mapH: actualH,
      mapCellW, mapCellH,
      wallFmt: 'cell',
      gridSize, gridType: 'square', gridEnabled: true,
      gridOffsetX: 0, gridOffsetY: 0,
      gridColor: '#ffffff', gridAlpha: 0.08,
      walls, doors, lights, audioZones: [], triggers: [], tokens: {}, fogState: {},
    };

    serverData.campaigns[MAP.campaignId].maps[mapId] = mapEntry;
    serverData.campaigns[MAP.campaignId].activeMapId = mapId;
    serverData.campaigns[MAP.campaignId].updatedAt = new Date().toISOString();
    await saveHubDm( serverData);

    MAP.mapId = mapId;
    MAP.mapData = mapEntry;

    // Reset panel
    toggleVTTPanel();
    _vttDD2 = null; _vttVideo = null;
    const d2i = document.getElementById('vtt-dd2vtt-input');
    const vvi = document.getElementById('vtt-video-input');
    if (d2i) d2i.value = '';
    if (vvi) vvi.value = '';
    _updateVTTBtn();

    // 7. Render
    await renderMapBackground();
    renderGrid();
    renderTokens();
    renderFog();
    renderWalls();
    syncGridPanel();

    // 8. Broadcast
    await realtimePublish('map:set', {
      type: 'map:set', campaignId: MAP.campaignId, mapId,
      fileId: upload.id, signedUrl: upload.url,
    });
    await realtimePublish('walls:update', {
      type: 'walls:update', campaignId: MAP.campaignId, walls,
    });
    await realtimePublish('door:state', {
      type: 'door:state', campaignId: MAP.campaignId, doors,
    });

  } catch (err) {
    console.error('[dnd-hub] VTT import error:', err);
    alert('VTT import failed: ' + (err.message || String(err)));
    if (btn) { btn.textContent = 'Import'; btn.disabled = false; }
  }
}
