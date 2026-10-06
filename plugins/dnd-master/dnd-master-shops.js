// dnd-master-shops.js — Shops tab: shop creation and inventory manager
import { storageGet, storageSet, esc, genId, requestWithTransfer, realtimePublishCompanion } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20261014o';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';

import { guarded } from './lk-upload.js';
let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
const _shopVolDebounce = {};    // debounce timers keyed by shopId

/** The shops as this tab holds them (read only, for the playtests). */
export const currentShops = () => Object.values(_state?.dmCampaign?.shops || {});

export function setShopsState(sharedState) {
  _state = sharedState;
}

/**
 * A backup of what the Loot tabs made (items, shops, taverns, game setups) in the DM's own storage: the Hub writes
 * hub-dm often from its own copy, and an older copy could drop them (restored in dnd-master-main.js onInit).
 */
export async function persistDmCatalog() { return _persistDmCatalog(); }
async function _persistDmCatalog() {
  try {
    const camp = _state.serverData?.campaigns?.[_state.dmCampaignId];
    if (!camp) return;
    const existing = (await storageGet('dm-catalog')) || { campaigns: {} };
    if (!existing.campaigns) existing.campaigns = {};
    existing.campaigns[_state.dmCampaignId] = {
      items: camp.items || {},
      shops: camp.shops || {},
      taverns: camp.taverns || {},
      gameSetups: camp.gameSetups || {},
    };
    await storageSet('dm-catalog', existing);
  } catch { /* non-critical */ }
}

export async function renderShopsTab() {
  const el = document.getElementById('tab-shops');
  if (!el) return;

  const items = Object.values(_state.dmCampaign?.items || {});
  const shops = Object.values(_state.dmCampaign?.shops || {});

  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">CREATE SHOP</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      '<input id="shop-name-input" class="search-input" placeholder="Shop name…" style="margin:0;flex:1">' +
    '</div>' +
    // A background sound for while players shop (the shop scene itself is drawn by the Hub). It replaced the
    // video/image choice (owner, 2026-10-05).
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
      '<span style="font-size:10px;color:var(--muted);min-width:60px">Sound</span>' +
      '<input id="shop-sound-input" type="file" accept="audio/*" style="font-size:10px;flex:1;min-width:0">' +
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
          '<span style="flex:1">' + esc(item.name) + ((si.qty ?? 1) > 1 ? ' <span style="color:var(--muted)">×' + si.qty + '</span>' : '') + '</span>' +
          '<span style="color:var(--gold);font-size:10px">' + esc(String(si.price)) + ' gp</span>' +
          '<button onclick="removeShopItem(\'' + shop.id + '\',\'' + si.slotId + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px">&#x2715;</button>' +
        '</div>'
      : '';
  }).join('');

  const hasSound = shop.soundFileId || shop.videoFileId;
  const volSlider =
    '<div style="display:flex;align-items:center;gap:6px;margin-top:6px">' +
      '<span style="font-size:10px;color:var(--muted);min-width:60px">' + (hasSound ? '🔊 Sound' : 'No sound') + '</span>' +
      (hasSound ? '<input type="range" min="0" max="1" step="0.05" value="' + (shop.ambientVolume ?? 0.5) + '" ' +
        'oninput="onShopVolumeChange(\'' + shop.id + '\', this.value)" style="flex:1" title="Volume">' : '<span style="flex:1"></span>') +
      '<label class="btn btn-ghost" style="font-size:10px;cursor:pointer">' + (hasSound ? 'Change' : 'Add sound') +
        '<input type="file" accept="audio/*" style="display:none" onchange="onShopSoundSelected(\'' + shop.id + '\', this)"></label>' +
    '</div>' +
    // Your own picture or video for the main panel, instead of the drawn shop (owner, 2026-10-05: keep both).
    '<div style="display:flex;align-items:center;gap:6px;margin-top:6px">' +
      '<span style="font-size:10px;color:var(--muted);flex:1">' + (shop.videoFileId ? '🖼 Your picture/video' : '🏮 The drawn shop') + '</span>' +
      '<label class="btn btn-ghost" style="font-size:10px;cursor:pointer">' + (shop.videoFileId ? 'Change' : 'Use a picture/video') +
        '<input type="file" accept="image/*,video/*" style="display:none" onchange="onShopMediaSelected(\'' + shop.id + '\', this)"></label>' +
      (shop.videoFileId ? '<button class="btn btn-ghost" style="font-size:10px" onclick="onShopMediaSelected(\'' + shop.id + '\', null)">Remove</button>' : '') +
    '</div>';

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
          '<input  id="shop-qty-'      + shop.id + '" class="num-input" type="number" value="1" min="1" style="width:40px" title="How many">' +
          '<input  id="shop-price-'    + shop.id + '" class="num-input" type="number" value="10" style="width:52px" title="Price in gp, each">' +
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

  let soundFileId = null;
  const file = document.getElementById('shop-sound-input')?.files?.[0];
  if (file) {
    soundFileId = await _uploadSound(file);
    if (soundFileId === false) { if (btn) { btn.disabled = false; btn.textContent = '+ Shop'; } return; }
  }

  const shop = { id: genId(), name, items: [], soundFileId, ambientVolume };
  if (!_state.dmCampaign.shops) _state.dmCampaign.shops = {};
  _state.dmCampaign.shops[shop.id] = shop;
  _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
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
  const qty    = Math.max(1, Math.min(999, parseInt(document.getElementById('shop-qty-' + shopId)?.value) || 1));
  if (!itemId) return;
  if (!shop.items) shop.items = [];
  // How many, at this price each (owner, 2026-10-05). The same item at the same price adds to its line.
  const line = shop.items.find(si => si.itemId === itemId && si.price === price);
  if (line) line.qty = (line.qty ?? 1) + qty;
  else shop.items.push({ slotId: genId(), itemId, price, qty });
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
    type: EV.SHOP_OPEN, shopId, shopName: shop.name || '',
    soundFileId: shop.soundFileId || null,
    videoFileId: shop.videoFileId || null, // the shop's own picture/video (dnd-hub-shop-scene.js startShopMedia)
    videoMime: shop.videoMime || '',
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

/** Upload a shop's file (its sound, or its picture/video): the file id, or false when it failed (the user has been told). */
async function _uploadSound(file, opts = {}) {
  try {
    const buf = await file.arrayBuffer();
    const res = await guarded(requestWithTransfer)('files:upload',
      { name: file.name, mime: file.type, size: file.size, dmOnly: false, data: buf, attachContext: `campaign:${_state.dmCampaignId}`, ...opts },
      [buf], 120000);
    return res?.id || null;
  } catch (e) {
    if (!e?.shown) alert('That file could not be uploaded: ' + (e?.message || String(e)));
    return false;
  }
}

/** A shop's own picture or video for the main panel; `input` null removes it (the drawn shop comes back). */
export async function onShopMediaSelected(shopId, input) {
  const shop = _state.dmCampaign.shops?.[shopId];
  if (!shop) return;
  if (input === null) { delete shop.videoFileId; delete shop.videoMime; }
  else {
    const file = input?.files?.[0];
    if (!file) return;
    const id = await _uploadSound(file);
    if (!id) return;
    shop.videoFileId = id; shop.videoMime = file.type || '';
  }
  _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  renderShopsTab();
}

/** A new background sound for an existing shop. */
export async function onShopSoundSelected(shopId, input) {
  const shop = _state.dmCampaign.shops?.[shopId];
  const file = input?.files?.[0];
  if (!shop || !file) return;
  const id = await _uploadSound(file);
  if (!id) return;
  shop.soundFileId = id;
  _state.serverData.campaigns[_state.dmCampaignId].shops = _state.dmCampaign.shops;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  renderShopsTab();
}

/** Upload a file for this campaign (a tavern's sound, picture or video): its id, or false when it failed (said). */
export const uploadCampaignFile = (file, opts) => _uploadSound(file, opts); // opts.maxSide: a picture shown small
