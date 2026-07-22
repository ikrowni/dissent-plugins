// dnd-hub-screens.js — lobby, DM portal, join screen, campaign view, campaign wizard
import { MAP, serverData, userId, showScreen, setServerData } from './dnd-hub-state.js?v=20260502p4';
import { storageGet, storageSet, storageGetUser, storageSetUser, realtimePublish, getIdentity, esc, fmtDate, genId, storageDelete, releaseFileContext } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { initPixiApp, initKeyboardHandlers } from './dnd-hub-canvas.js?v=20260502p4';
import { loadMapData } from './dnd-hub-map-bg.js?v=20260502p4';
import { startCharacterCreator } from './dnd-hub-char.js?v=20260502p4';
import { saveHubDm, loadHubDm, hubCampKey } from './dnd-hub-storage.js?v=20260502p4';

// ── Screen frame renderers ────────────────────────────────────────────────────
export function renderLobbyScreen() {
  document.getElementById('screen-lobby').innerHTML = `
    <div class="lobby-logo">⚔️</div>
    <div class="lobby-title">D&amp;D Hub</div>
    <div class="lobby-sub">Your Dungeons &amp; Dragons virtual tabletop</div>
    <div class="lobby-cards">
      <div class="lobby-card" onclick="showDMPortal()">
        <div class="lobby-card-icon">🏰</div>
        <div class="lobby-card-label">Create</div>
        <div class="lobby-card-desc">Start a new campaign or manage one you're running</div>
      </div>
      <div class="lobby-card" onclick="showJoinScreen()">
        <div class="lobby-card-icon">🗺️</div>
        <div class="lobby-card-label">Join</div>
        <div class="lobby-card-desc">Find a campaign to join or continue an existing one</div>
      </div>
    </div>`;
}

export function renderDMPortalFrame() {
  document.getElementById('screen-dm-portal').innerHTML = `
    <div class="screen-header">
      <button class="screen-back" onclick="showScreen('lobby')">←</button>
      <div class="screen-title">🏰 Dungeon Master Portal</div>
    </div>
    <div class="new-campaign-btn" onclick="showCampaignWizard()">
      <div class="new-campaign-icon">✨</div>
      <div class="new-campaign-text">
        <strong>Start New Campaign</strong>
        <span>Create a brand new adventure</span>
      </div>
      <span style="margin-left:auto;color:var(--dnd-gold);font-size:18px">→</span>
    </div>
    <div class="section-label">Your Campaigns</div>
    <div class="campaign-list" id="dm-campaign-list"></div>`;
}

export function renderJoinFrame() {
  document.getElementById('screen-join').innerHTML = `
    <div class="screen-header">
      <button class="screen-back" onclick="showScreen('lobby')">←</button>
      <div class="screen-title">🗺️ Join a Campaign</div>
    </div>
    <div class="join-columns">
      <div>
        <div class="join-section-title">🔓 Available Campaigns</div>
        <div id="available-list"></div>
      </div>
      <div>
        <div class="join-section-title">⚔️ My Campaigns</div>
        <div id="my-campaigns-list"></div>
      </div>
    </div>`;
}

export function renderCampaignWizardFrame() {
  document.getElementById('screen-cam-wizard').innerHTML = `
    <div class="screen-header">
      <button class="screen-back" onclick="showScreen('dm-portal')">←</button>
      <div class="screen-title">✨ New Campaign</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;max-width:500px;margin:0 auto;width:100%">
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Campaign Name *</label>
        <input id="cw-name" type="text" placeholder="e.g. Curse of Strahd" maxlength="80"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:14px;outline:none">
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Description</label>
        <textarea id="cw-desc" placeholder="Describe your campaign…" rows="3" maxlength="300"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:13px;outline:none;resize:vertical;line-height:1.5"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Max Players</label>
          <input id="cw-max" type="number" value="4" min="1" max="8"
            style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:14px;outline:none">
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Starting Level</label>
          <input id="cw-level" type="number" value="1" min="1" max="20"
            style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:14px;outline:none">
        </div>
      </div>
      <div>
        <label style="font-size:12px;font-weight:600;color:var(--dnd-gold);display:block;margin-bottom:6px">Visibility</label>
        <select id="cw-visibility"
          style="width:100%;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:10px 12px;color:var(--dnd-text);font-size:14px;outline:none">
          <option value="open">Open — anyone on the server can join</option>
          <option value="approval">Approval required</option>
          <option value="invite">Invite only</option>
        </select>
      </div>
      <div id="cw-error" style="display:none;padding:10px 12px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);border-radius:8px;font-size:12px;color:#ef4444"></div>
      <button id="btn-create-campaign" class="btn btn-primary" onclick="createCampaign()" style="width:100%;padding:14px">
        🏰 Create Campaign
      </button>
    </div>`;
}

// ── Navigation helpers ────────────────────────────────────────────────────────
export function showDMPortal() { renderDMPortalFrame(); renderDMPortal(); showScreen('dm-portal'); }
export function showJoinScreen() { renderJoinFrame(); renderJoinScreen(); showScreen('join'); }
export function showCampaignWizard() { renderCampaignWizardFrame(); showScreen('cam-wizard'); }

// ── DM Portal ─────────────────────────────────────────────────────────────────
export function renderDMPortal() {
  const listEl = document.getElementById('dm-campaign-list');
  if (!serverData?.campaigns || !userId) {
    listEl.innerHTML = '<div class="empty-state">No campaigns yet. Start your first adventure above.</div>';
    return;
  }
  const myCampaigns = Object.values(serverData.campaigns)
    .filter(c => c.dmUserId === userId)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  if (!myCampaigns.length) {
    listEl.innerHTML = '<div class="empty-state">No campaigns yet. Start your first adventure above.</div>';
    return;
  }
  listEl.innerHTML = myCampaigns.map(c => c.id === _pendingDelete ? `
    <div class="campaign-row" style="border-color:#ef4444">
      <div class="campaign-row-icon">🗑</div>
      <div class="campaign-row-info">
        <div class="campaign-row-name">Delete “${esc(c.name)}”?</div>
        <div class="campaign-row-meta">Maps, tokens and uploaded files for this campaign are removed. This cannot be undone.</div>
      </div>
      <button class="btn btn-danger" style="padding:6px 12px;margin-right:6px"
              onclick="event.stopPropagation();deleteCampaign('${c.id}')">Delete</button>
      <button class="btn" style="padding:6px 12px"
              onclick="event.stopPropagation();cancelDeleteCampaign()">Cancel</button>
    </div>
  ` : `
    <div class="campaign-row" onclick="enterCampaignAsDM('${c.id}')">
      <div class="campaign-row-icon">🏰</div>
      <div class="campaign-row-info">
        <div class="campaign-row-name">${esc(c.name)}</div>
        <div class="campaign-row-meta">${c.members?.length ?? 0} players · Last updated ${fmtDate(c.updatedAt)}</div>
      </div>
      <span class="status-badge status-${c.status || 'active'}">${c.status || 'active'}</span>
      <button class="btn" title="Delete campaign" style="padding:4px 9px;margin-left:8px;opacity:0.55"
              onclick="event.stopPropagation();confirmDeleteCampaign('${c.id}')">🗑</button>
    </div>
  `).join('');
}

// ── Campaign deletion ─────────────────────────────────────────────────────────
// Two-step inline confirm rather than window.confirm(): Tauri routes native
// dialogs through IPC, which the plugin CSP blocks (same reason alert() is
// shimmed in plugin.html).
let _pendingDelete = null;

export function confirmDeleteCampaign(id) { _pendingDelete = id; renderDMPortal(); }
export function cancelDeleteCampaign() { _pendingDelete = null; renderDMPortal(); }

export async function deleteCampaign(id) {
  _pendingDelete = null;
  const camp = serverData?.campaigns?.[id];
  if (!camp) { renderDMPortal(); return; }

  delete serverData.campaigns[id];
  // Persist the removal FIRST. If the later cleanup fails the campaign is still
  // gone from the DM's list rather than reappearing on next load.
  await saveHubDm(serverData);

  // Reclaim the campaign's own storage: its shard key, and any files uploaded
  // under attachContext "campaign:<id>" (map backgrounds, zone audio, portraits).
  try { await storageDelete(hubCampKey(id)); } catch { /* index no longer lists it */ }
  try { await releaseFileContext(`campaign:${id}`); } catch { /* swept after 7d anyway */ }

  renderDMPortal();
}

// ── Join Screen ───────────────────────────────────────────────────────────────
export function renderJoinScreen() {
  const availEl = document.getElementById('available-list');
  const myEl = document.getElementById('my-campaigns-list');
  if (!serverData?.campaigns || !userId) {
    availEl.innerHTML = '<div class="empty-state">No open campaigns on this server.</div>';
    myEl.innerHTML = '<div class="empty-state">You haven\'t joined any campaigns yet.</div>';
    return;
  }
  const all = Object.values(serverData.campaigns);
  const available = all.filter(c =>
    c.visibility === 'open' &&
    c.dmUserId !== userId &&
    !(c.members || []).includes(userId) &&
    (c.members?.length ?? 0) < (c.maxPlayers ?? 6)
  );
  const mine = all.filter(c => (c.members || []).includes(userId) || c.dmUserId === userId);

  availEl.innerHTML = available.length ? available.map(c => `
    <div class="available-card" onclick="requestJoin('${c.id}')">
      <div class="available-card-header">
        <div class="available-card-name">${esc(c.name)}</div>
        <span class="tag">${c.members?.length ?? 0}/${c.maxPlayers ?? 6} players</span>
      </div>
      <div class="available-card-dm">DM: ${esc(c.dmDisplayName || 'Unknown')}</div>
      <div class="available-card-desc">${esc(c.description || '')}</div>
      <div class="available-card-footer">
        <span class="tag">Level ${c.startingLevel ?? 1}</span>
        <span class="tag">${c.autoAccept ? 'Open' : 'Approval required'}</span>
      </div>
    </div>
  `).join('') : '<div class="empty-state">No open campaigns on this server.</div>';

  myEl.innerHTML = mine.length ? mine.map(c => `
    <div class="campaign-row" onclick="enterCampaignAsPlayer('${c.id}')">
      <div class="campaign-row-icon">${c.dmUserId === userId ? '🏰' : '⚔️'}</div>
      <div class="campaign-row-info">
        <div class="campaign-row-name">${esc(c.name)}</div>
        <div class="campaign-row-meta">${c.dmUserId === userId ? 'You are the DM' : 'Player'}</div>
      </div>
      <span class="status-badge status-${c.status || 'active'}">${c.status || 'active'}</span>
    </div>
  `).join('') : '<div class="empty-state">You haven\'t joined any campaigns yet.</div>';
}

export async function requestJoin(campaignId) {
  if (!userId || !serverData?.campaigns?.[campaignId]) return;
  const c = serverData.campaigns[campaignId];
  if (c.autoAccept) {
    c.members = [...(c.members || []), userId];
    serverData.campaigns[campaignId] = c;
    await saveHubDm( serverData);
    await realtimePublish(EV.JOIN_APPROVED, { type: EV.JOIN_APPROVED, campaignId, userId });
    renderJoinScreen();
    await enterCampaignAsPlayer(campaignId);
  } else {
    c.joinRequests = [...new Set([...(c.joinRequests || []), userId])];
    serverData.campaigns[campaignId] = c;
    await saveHubDm( serverData);
    await realtimePublish(EV.JOIN_REQUEST, { type: EV.JOIN_REQUEST, campaignId, userId });
    alert('Join request sent! The DM will review it.');
  }
}

// ── Campaign Wizard ───────────────────────────────────────────────────────────
export function renderCampaignWizard() {
  // static form — nothing to pre-render
}

export async function createCampaign() {
  const btn = document.getElementById('btn-create-campaign');
  const errEl = document.getElementById('cw-error');
  if (btn) btn.disabled = true;
  if (errEl) errEl.style.display = 'none';

  try {
    const name = document.getElementById('cw-name').value.trim();
    if (!name) { alert('Campaign name is required.'); if (btn) btn.disabled = false; return; }

    const description = document.getElementById('cw-desc').value.trim();
    const maxPlayers = parseInt(document.getElementById('cw-max')?.value) || 4;
    const startingLevel = parseInt(document.getElementById('cw-level')?.value) || 1;
    const visibility = document.getElementById('cw-visibility')?.value || 'open';
    const autoAccept = visibility === 'open';

    const identity = await getIdentity();
    if (!identity?.id) {
      if (errEl) { errEl.textContent = 'Could not get user identity. Remove and re-add the plugin to re-grant permissions.'; errEl.style.display = 'block'; }
      if (btn) btn.disabled = false;
      return;
    }

    const campaignId = genId();
    const now = new Date().toISOString();
    const campaign = {
      id: campaignId, name, description,
      dmUserId: identity.id, dmDisplayName: identity.displayName || 'Unknown DM',
      visibility, autoAccept, maxPlayers, startingLevel,
      currentLevel: startingLevel, members: [], joinRequests: [],
      status: 'active', createdAt: now, updatedAt: now,
      maps: {}, sessions: [], history: [], handouts: [],
      storyRecap: '', xpSystem: 'milestone', partyXP: 0,
      library: { monsters: {}, spells: {}, items: {}, subclasses: {} },
      dmNotes: '', activeMapId: null, initiative: null, encounters: {},
    };

    if (!serverData) setServerData({ campaigns: {} });
    if (!serverData.campaigns) serverData.campaigns = {};
    serverData.campaigns[campaignId] = campaign;
    if (identity.id !== campaign.dmUserId) {
      console.warn('[dnd-hub] blocked non-DM write to hub-dm in createCampaign');
      if (btn) btn.disabled = false;
      return;
    }
    await saveHubDm( serverData);
    await realtimePublish(EV.CAMPAIGN_CREATED, { type: EV.CAMPAIGN_CREATED, campaignId, name });
    enterCampaignAsDM(campaignId);
  } catch (err) {
    console.error('[dnd-hub] createCampaign error:', err);
    if (errEl) { errEl.textContent = 'Error creating campaign: ' + (err?.message || String(err)); errEl.style.display = 'block'; }
    if (btn) btn.disabled = false;
  }
}

// ── Campaign View ─────────────────────────────────────────────────────────────
export async function enterCampaignAsDM(campaignId) {
  await renderCampaignView(campaignId, true);
  showScreen('campaign');
}

export async function enterCampaignAsPlayer(campaignId) {
  const characters = await storageGetUser('characters') || {};
  if (!characters[campaignId]) {
    startCharacterCreator(campaignId);
    return;
  }
  // Persist the active campaign so the dnd-player sidebar can read it on init.
  await storageSetUser('activePlayerCampaignId', campaignId);
  await renderCampaignView(campaignId, false);
  showScreen('campaign');
}

export async function renderCampaignView(campaignId, isDM) {
  // Refresh from storage so characterSummaries and any other changes made
  // since onInit (e.g. just after character creation) are visible to renderTokens.
  const fresh = await loadHubDm();
  if (fresh) setServerData(fresh);

  // Tear down prior PixiJS instance
  if (MAP.app) { MAP.app.destroy(true); MAP.app = null; }
  if (MAP.resizeObserver) { MAP.resizeObserver.disconnect(); MAP.resizeObserver = null; }
  if (MAP.fogThrottle) { cancelAnimationFrame(MAP.fogThrottle); MAP.fogThrottle = null; }
  if (MAP._fogTexture) { MAP._fogTexture.destroy(true); MAP._fogTexture = null; }
  MAP._fogCanvas = null; MAP._fogSprite = null; MAP._visCanvas = null; MAP._maskCanvas = null;
  MAP.tokenSprites = {};
  MAP.activeTool = 'select';
  MAP.editMode = false;
  MAP.fogVisible = true;
  MAP.dragState = null;
  MAP.wallDrawing = null;
  MAP.fogThrottle = null;
  MAP.mapId = null;
  MAP.mapData = null;
  MAP.localVisible = null;
  MAP.localVisiblePoly = null;
  if (MAP._wasdBroadcastTimer) { clearTimeout(MAP._wasdBroadcastTimer); MAP._wasdBroadcastTimer = null; }
  MAP._wasdPendingMove = null;
  MAP._bgOffset = { x: 0, y: 0 };
  MAP.zoom = 1;
  MAP.campaignId = campaignId;
  MAP.isDM = isDM;

  const c = serverData?.campaigns?.[campaignId];
  if (!c) {
    document.getElementById('screen-campaign').innerHTML = '<div class="empty-state">Campaign not found.</div>';
    return;
  }

  document.getElementById('screen-campaign').innerHTML = `
    <div id="map-root">
      <div id="map-toolbar">
        <button class="map-tool-btn" onclick="showScreen('lobby')" style="padding:5px 8px" title="Back to lobby">←</button>
        <span style="font-size:12px;font-weight:700;color:var(--dnd-gold);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
        <div class="map-tool-sep"></div>
        ${isDM ? `
          <button class="map-tool-btn" id="btn-upload-map" onclick="triggerMapUpload()" title="Upload a map image">📁 Map</button>
          <button class="map-tool-btn" id="btn-vtt-import" onclick="toggleVTTPanel()" title="Import Dungeon Alchemist / UniversalVTT map">📥 VTT</button>
          <button class="map-tool-btn" id="btn-edit-mode" onclick="toggleEditMode()" title="Toggle edit mode (walls, doors, fog tools)">✏️ Edit</button>
          <button class="map-tool-btn" id="btn-fog-toggle" onclick="toggleDMFog()" title="Toggle DM fog visibility">🌫️ Fog</button>
          <button class="map-tool-btn" onclick="updateAndBroadcastFog()" title="Recalculate fog from player token positions">👁 LOS</button>
          <button class="map-tool-btn" id="btn-grid-settings" onclick="toggleGridPanel()" title="Adjust grid size, offset, color and opacity">⚙ Grid</button>
          <div id="edit-tools" style="display:none;align-items:center;gap:6px">
            <div class="map-tool-sep"></div>
            <button class="map-tool-btn" id="btn-tool-select" onclick="setTool('select')" title="Select and drag tokens">↖ Select</button>
            <button class="map-tool-btn" id="btn-tool-wall" onclick="setTool('wall')" title="Draw an impassable wall segment">🧱 Wall</button>
            <button class="map-tool-btn" id="btn-tool-door" onclick="setTool('door')" title="Draw a door (right-click to cycle open/closed/locked)">🚪 Door</button>
            <button class="map-tool-btn" id="btn-tool-reveal" onclick="setTool('brush-reveal')" title="Brush-reveal fog area">👁 Reveal</button>
            <button class="map-tool-btn" id="btn-tool-hide" onclick="setTool('brush-hide')" title="Brush-hide fog area">🌑 Hide</button>
            <button class="map-tool-btn" onclick="resetFog()" style="color:#f87171;border-color:rgba(248,113,113,.3)" title="Flood the entire map with fog">🗑 Reset Fog</button>
            <button class="map-tool-btn" id="btn-tool-pin" onclick="setTool('pin')" title="Place map pin">&#x1F4CC; Pin</button>
            <button class="map-tool-btn" id="btn-tool-light"   onclick="setTool('light')"   title="Place light source">&#x1F56F; Light</button>
            <button class="map-tool-btn" id="btn-tool-speaker" onclick="setTool('speaker')" title="Place audio zone">&#x1F50A; Zone</button>
            <button class="map-tool-btn" id="btn-tool-trap"    onclick="setTool('trap')"    title="Place trigger tile">&#x1FAA4; Trap</button>
            <button class="map-tool-btn" id="btn-tool-template" onclick="showTemplatePicker()" title="Place AoE template">&#x1F3AF; Template</button>
          </div>
          <input type="file" id="map-file-input" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm" style="display:none" onchange="handleMapUpload(this)">
          <input type="file" id="vtt-dd2vtt-input" accept=".dd2vtt,.json" style="display:none" onchange="onVTTFileSelected()">
          <input type="file" id="vtt-video-input" accept="video/webm,video/mp4" style="display:none" onchange="onVTTVideoSelected()">
        ` : `
          <button class="map-tool-btn" id="btn-place-token" onclick="window._togglePlaceTokenMode()" title="Click anywhere on the map to move your token there">📍 Place Token</button>
          <button class="map-tool-btn" onclick="showTemplatePicker()" title="Place AoE template">🎯 Template</button>
        `}
        <div style="margin-left:auto;display:flex;align-items:center;gap:4px">
          <button class="map-tool-btn" onclick="setZoom(MAP.zoom - 0.25)" title="Zoom out">−</button>
          <span id="zoom-display" title="Press ? for keyboard shortcuts" style="font-size:10px;color:var(--dnd-muted);min-width:32px;text-align:center">100%</span>
          <button class="map-tool-btn" onclick="setZoom(MAP.zoom + 0.25)" title="Zoom in">+</button>
          <div style="width:1px;height:14px;background:rgba(255,255,255,.12);margin:0 2px"></div>
          <span style="font-size:11px;color:var(--dnd-muted)" id="map-coord-display"></span>
        </div>
      </div>
      ${isDM ? `
      <!-- Grid settings panel — toggled by ⚙ Grid button, shown between toolbar and canvas -->
      <div id="grid-panel" style="display:none;align-items:center;gap:8px;padding:5px 10px;background:rgba(0,0,0,.88);border-bottom:1px solid var(--dnd-border);flex-shrink:0;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:3px">
          <span style="font-size:10px;color:var(--dnd-muted);margin-right:2px">Size</span>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridSize',-5)">−5</button>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridSize',-1)">−1</button>
          <span id="grid-size-display" style="min-width:30px;text-align:center;font-size:11px;color:#fff">40</span>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridSize',1)">+1</button>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridSize',5)">+5</button>
        </div>
        <div style="width:1px;height:14px;background:var(--dnd-border);flex-shrink:0"></div>
        <div style="display:flex;align-items:center;gap:3px">
          <span style="font-size:10px;color:var(--dnd-muted);margin-right:2px">Offset X</span>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridOffsetX',-5)">−5</button>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridOffsetX',-1)">−1</button>
          <span id="grid-offset-x" style="min-width:30px;text-align:center;font-size:11px;color:#fff">0</span>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridOffsetX',1)">+1</button>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridOffsetX',5)">+5</button>
        </div>
        <div style="width:1px;height:14px;background:var(--dnd-border);flex-shrink:0"></div>
        <div style="display:flex;align-items:center;gap:3px">
          <span style="font-size:10px;color:var(--dnd-muted);margin-right:2px">Offset Y</span>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridOffsetY',-5)">−5</button>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridOffsetY',-1)">−1</button>
          <span id="grid-offset-y" style="min-width:30px;text-align:center;font-size:11px;color:#fff">0</span>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridOffsetY',1)">+1</button>
          <button class="map-tool-btn" style="padding:2px 7px" onclick="adjustGrid('gridOffsetY',5)">+5</button>
        </div>
        <div style="width:1px;height:14px;background:var(--dnd-border);flex-shrink:0"></div>
        <div style="display:flex;align-items:center;gap:4px">
          <span style="font-size:10px;color:var(--dnd-muted)">Color</span>
          <input id="grid-color-input" type="color" value="#ffffff" oninput="setGridSettings({gridColor:this.value})" style="width:28px;height:22px;border:none;background:none;cursor:pointer;padding:0;border-radius:3px">
        </div>
        <div style="width:1px;height:14px;background:var(--dnd-border);flex-shrink:0"></div>
        <div style="display:flex;align-items:center;gap:4px">
          <span style="font-size:10px;color:var(--dnd-muted)">Opacity</span>
          <input id="grid-alpha-input" type="range" min="0" max="100" value="8" oninput="setGridSettings({gridAlpha:this.value/100})" style="width:72px;accent-color:var(--dnd-gold)">
          <span id="grid-alpha-val" style="font-size:10px;color:var(--dnd-muted);min-width:26px">8%</span>
        </div>
      </div>` : ''}
      <!-- VTT import panel -->
      ${isDM ? `
      <div id="vtt-panel" style="display:none;align-items:center;gap:10px;padding:6px 12px;background:rgba(0,0,0,.88);border-bottom:1px solid var(--dnd-border);flex-shrink:0;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:700;color:var(--dnd-gold);white-space:nowrap">📥 Dungeon Alchemist / UniversalVTT</span>
        <div style="width:1px;height:14px;background:var(--dnd-border);flex-shrink:0"></div>
        <label style="display:flex;flex-direction:column;gap:2px;cursor:pointer">
          <span style="font-size:9px;color:var(--dnd-muted);text-transform:uppercase;letter-spacing:.05em">Map data</span>
          <button class="map-tool-btn" style="padding:3px 10px;font-size:10px" onclick="document.getElementById('vtt-dd2vtt-input').click()">
            <span id="vtt-dd2-label">Choose .dd2vtt…</span>
          </button>
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;cursor:pointer">
          <span style="font-size:9px;color:var(--dnd-muted);text-transform:uppercase;letter-spacing:.05em">Video</span>
          <button class="map-tool-btn" style="padding:3px 10px;font-size:10px" onclick="document.getElementById('vtt-video-input').click()">
            <span id="vtt-vid-label">Choose video…</span>
          </button>
        </label>
        <div style="width:1px;height:14px;background:var(--dnd-border);flex-shrink:0"></div>
        <button id="btn-run-vtt" class="map-tool-btn" style="padding:3px 12px;color:var(--dnd-gold);border-color:rgba(212,175,55,.4)" onclick="runVTTImport()" disabled>Import</button>
        <span style="font-size:9px;color:var(--dnd-muted)">Grid auto-snaps · Walls &amp; doors imported from .dd2vtt</span>
      </div>` : ''}
      <div id="map-canvas-wrap">
        <div id="map-status">No map loaded${isDM ? ' — click 📁 Map to upload' : ''}</div>
        <div id="initiative-hud"></div>
        <div id="dice-overlay"></div>
        <div id="roll-toast"></div>
      </div>
    </div>
  `;

  await initPixiApp();
  initKeyboardHandlers();
  await loadMapData(campaignId);
}
