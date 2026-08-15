// dnd-master-shops.js — Shops tab: shop creation and inventory manager
import { storageGet, storageSet, storageSetCompanion, esc, genId, requestWithTransfer, request, realtimePublishCompanion } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js?v=20260503';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _pendingShopVideo = null;   // File object for new shop upload
const _shopVolDebounce = {};    // debounce timers keyed by shopId

export function setShopsState(sharedState) {
  _state = sharedState;
}

async function _persistDmCatalog() {
  try {
    const camp = _state.serverData?.campaigns?.[_state.dmCampaignId];
    if (!camp) return;
    const existing = (await storageGet('dm-catalog')) || { campaigns: {} };
    if (!existing.campaigns) existing.campaigns = {};
    existing.campaigns[_state.dmCampaignId] = {
      items: camp.items || {},
      shops: camp.shops || {},
    };
    await storageSet('dm-catalog', existing);
  } catch { /* non-critical */ }
}

export async function renderShopsTab() {
  const el = document.getElementById('tab-shops');
  if (!el) return;

  const items = Object.values(_state.dmCampaign?.items || {});
  const shops = Object.values(_state.dmCampaign?.shops || {});

  // Build video file options for the creation form
  let fileOpts = '<option value="">none</option>';
  try {
    const filesRes = await request('files:list', {});
    const videoFiles = (filesRes || []).filter(f => f.mime_type?.startsWith('video/') || f.mime_type?.startsWith('image/'));
    fileOpts += videoFiles.map(f =>
      '<option value="' + f.id + '">' + esc(f.filename) + '</option>'
    ).join('');
  } catch { /* ignore — file list unavailable */ }

  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">CREATE SHOP</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      '<input id="shop-name-input" class="search-input" placeholder="Shop name…" style="margin:0;flex:1">' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
      '<span style="font-size:10px;color:var(--muted);min-width:60px">Video/Image</span>' +
      '<select id="shop-video-select" class="search-input" style="margin:0;flex:1" onchange="onShopVideoSelected(null, this.value)">' +
        fileOpts +
      '</select>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">' +
      '<span style="font-size:10px;color:var(--muted);min-width:60px">Volume</span>' +
      '<input type="range" id="shop-new-volume" min="0" max="1" step="0.05" value="0.5" style="flex:1">' +
    '</div>' +
    '<button id="btn-save-shop" class="btn btn-gold" onclick="saveNewShop()" style="width:100%;margin-bottom:12px">+ Shop</button>' +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">SHOPS</div>' +
    (shops.length === 0
      ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:8px">No shops created yet</div>'
      : shops.map(s => _shopCard(s, items)).join('')
    );
}

function _shopCard(shop, allItems) {
  const itemOpts = allItems.map(i =>
    '<option value="' + i.id + '">' + esc(i.name) + '</option>'
  ).join('');

  const shopItemsHtml = (shop.items || []).map(si => {
    const item = allItems.find(i => i.id === si.itemId);
    return item
      ? '<div style="display:flex;align-items:center;gap:4px;padding:3px 0;font-size:11px">' +
          '<span style="flex:1">' + esc(item.name) + '</span>' +
          '<span style="color:var(--gold);font-size:10px">' + esc(String(si.price)) + ' gp</span>' +
          '<button onclick="removeShopItem(\'' + shop.id + '\',\'' + si.slotId + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px">&#x2715;</button>' +
        '</div>'
      : '';
  }).join('');

  const volSlider = shop.videoFileId
    ? '<div style="display:flex;align-items:center;gap:6px;margin-top:6px">' +
        '<span style="font-size:10px;color:var(--muted);min-width:60px">Volume</span>' +
        '<input type="range" min="0" max="1" step="0.05" value="' + (shop.ambientVolume ?? 0.5) + '" ' +
          'oninput="onShopVolumeChange(\'' + shop.id + '\', this.value)" style="flex:1">' +
      '</div>'
    : '';

  return '<div class="shop-card">' +
    '<div style="display:flex;align-items:center;margin-bottom:6px">' +
      '<span style="font-size:11px;font-weight:700;flex:1">&#x1F3EA; ' + esc(shop.name) + '</span>' +
      '<button class="btn btn-gold" onclick="loadShop(\'' + shop.id + '\')" style="font-size:10px;padding:2px 8px;margin-right:4px">&#x25B6; Load</button>' +
      '<button onclick="deleteShop(\'' + shop.id + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px" title="Delete shop">&#x1F5D1;</button>' +
    '</div>' +
    (shopItemsHtml || '<div style="font-size:10px;color:var(--muted);padding:3px 0">Empty shop</div>') +
    (allItems.length > 0
      ? '<div style="display:flex;gap:4px;margin-top:6px">' +
          '<select id="shop-item-sel-' + shop.id + '" class="search-input" style="flex:2;margin:0;padding:4px 6px">' + itemOpts + '</select>' +
          '<input  id="shop-price-'    + shop.id + '" class="num-input" type="number" value="10" style="width:52px" title="Price in gp">' +
          '<button class="btn btn-ghost" onclick="addItemToShop(\'' + shop.id + '\')" style="font-size:10px">Add</button>' +
        '</div>'
      : '<div style="font-size:10px;color:var(--muted);margin-top:4px">Create items above to stock this shop</div>'
    ) +
    volSlider +
  '</div>';
}

export async function saveNewShop() {
  const name = document.getElementById('shop-name-input')?.value.trim();
  if (!name) { alert('Shop name is required.'); return; }
  const ambientVolume = parseFloat(document.getElementById('shop-new-volume')?.value || '0.5');
  const btn = document.getElementById('btn-save-shop');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  let videoFileId = null;
  try {
    if (_pendingShopVideo) {
      const buf = await _pendingShopVideo.arrayBuffer();
      const res = await requestWithTransfer('files:upload',
        { name: _pendingShopVideo.name, mime: _pendingShopVideo.type, size: _pendingShopVideo.size, dmOnly: false, data: buf },
        [buf], 120000);
      videoFileId = res?.id || null;
    } else {
      // Video may have been chosen from the existing files list
      const sel = document.getElementById('shop-video-select');
      videoFileId = sel?.value || null;
    }
  } catch (e) {
    alert('Video upload failed: ' + (e?.message || String(e)));
    if (btn) { btn.disabled = false; btn.textContent = '+ Shop'; }
    return;
  }

  const videoMime = _pendingShopVideo?.type || '';
  const shop = { id: genId(), name, items: [], videoFileId, videoMime, ambientVolume };
  if (!_state.dmCampaign.shops) _state.dmCampaign.shops = {};
  _state.dmCampaign.shops[shop.id] = shop;
  _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  _pendingShopVideo = null;
  if (btn) { btn.disabled = false; btn.textContent = '+ Shop'; }
  renderShopsTab();
}

export async function deleteShop(shopId) {
  if (!confirm('Delete this shop?')) return;
  if (_state.dmCampaign.shops?.[shopId]) delete _state.dmCampaign.shops[shopId];
  _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  renderShopsTab();
}

export async function addItemToShop(shopId) {
  const shop   = _state.dmCampaign.shops?.[shopId];
  if (!shop) return;
  const itemId = document.getElementById('shop-item-sel-' + shopId)?.value;
  const price  = parseInt(document.getElementById('shop-price-' + shopId)?.value) || 0;
  if (!itemId) return;
  if (!shop.items) shop.items = [];
  shop.items.push({ slotId: genId(), itemId, price });
  _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  renderShopsTab();
}

export async function removeShopItem(shopId, slotId) {
  const shop = _state.dmCampaign.shops?.[shopId];
  if (!shop) return;
  shop.items = (shop.items || []).filter(si => si.slotId !== slotId);
  _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  renderShopsTab();
}

export async function loadShop(shopId) {
  const shop = _state.dmCampaign.shops?.[shopId];
  if (!shop) return;
  // Flush DM's authoritative serverData to hub-dm before the player reads it.
  // Without this, a concurrent hub write (token move, map update) can overwrite
  // hub-dm with stale data that lacks items/shops, leaving the player shop empty.
  await saveHubDmCompanion(_state.serverData);
  await realtimePublishCompanion('dnd-hub', EV.SHOP_OPEN, {
    type: EV.SHOP_OPEN, shopId,
    videoFileId: shop.videoFileId || null,
    ambientVolume: shop.ambientVolume ?? 0.5,
    campaignId: _state.dmCampaignId,
    fromUserId: _state.userId,
  });
  await realtimePublishCompanion('dnd-player', EV.SHOP_OPEN, {
    type: EV.SHOP_OPEN, shopId,
    campaignId: _state.dmCampaignId,
    fromUserId: _state.userId,
  });
}

export function onShopVolumeChange(shopId, value) {
  const shop = _state.dmCampaign.shops?.[shopId];
  if (!shop) return;
  shop.ambientVolume = Math.min(1, Math.max(0, parseFloat(value) || 0));
  clearTimeout(_shopVolDebounce[shopId]);
  _shopVolDebounce[shopId] = setTimeout(async () => {
    _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
    await saveHubDmCompanion(_state.serverData);
    await realtimePublishCompanion('dnd-hub', EV.SHOP_VOLUME, {
      type: EV.SHOP_VOLUME, shopId,
      volume: shop.ambientVolume,
      campaignId: _state.dmCampaignId,
      fromUserId: _state.userId,
    });
  }, 100);
}

// Called when a video/image file is selected from the files list dropdown for an existing shop.
// shopId=null means the new-shop creation form; fileId is the file registry ID.
export async function onShopVideoSelected(shopId, fileId) {
  if (shopId) {
    // Update an existing shop's video in place
    const shop = _state.dmCampaign.shops?.[shopId];
    if (!shop) return;
    shop.videoFileId = fileId || null;
    _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
    await saveHubDmCompanion(_state.serverData);
    await _persistDmCatalog();
    renderShopsTab();
  }
  // For shopId=null (new shop form) the selected value is read directly from the
  // <select id="shop-video-select"> in saveNewShop(), so no further action needed here.
}
