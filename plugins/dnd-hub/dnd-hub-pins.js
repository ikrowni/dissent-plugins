// dnd-hub-pins.js — map pin placement, rendering, and journal overlay
import { MAP, serverData, userId } from './dnd-hub-state.js?v=20260502p4';
import { storageSet, realtimePublish, genId, esc } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { saveHubDm } from './dnd-hub-storage.js?v=20260502p4';

let _pinSprites = []; // PixiJS containers currently on the ui layer

// ── Rendering ────────────────────────────────────────────────────────────────

export function renderPins() {
  if (!MAP.layers?.ui) return;
  _pinSprites.forEach(s => { if (s.parent) s.parent.removeChild(s); });
  _pinSprites = [];
  const pins = MAP.mapData?.pins || [];
  pins.forEach((pin, i) => {
    if (!MAP.isDM && pin.visible !== 'all') return;
    const container = new PIXI.Container();
    container.x = pin.cx;
    container.y = pin.cy;
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const circ = new PIXI.Graphics();
    circ.circle(0, 0, 9).fill({ color: 0xd4af37, alpha: 0.9 })
        .circle(0, 0, 9).stroke({ color: 0x000000, width: 1.5, alpha: 0.6 });
    container.addChild(circ);

    const label = new PIXI.Text({ text: String(i + 1), style: { fontSize: 9, fontWeight: 'bold', fill: 0x000000 } });
    label.anchor.set(0.5, 0.5);
    container.addChild(label);

    container.on('pointerdown', (e) => {
      e.stopPropagation();
      if (MAP.isDM) { _showDMPinMenu(pin); }
      else if (pin.visible === 'all' && pin.journalId) { _showJournalOverlay(pin.journalId); }
    });

    MAP.layers.ui.addChild(container);
    _pinSprites.push(container);
  });
}

// ── DM pin management menu ────────────────────────────────────────────────────

function _showDMPinMenu(pin) {
  _removePinDialog();
  const d = document.createElement('div');
  d.id = 'pin-menu';
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:#1a1610;border:1px solid rgba(212,175,55,.4);border-radius:8px;padding:12px;' +
    'z-index:9998;min-width:200px;font-family:system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.7)';
  d.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:#d4af37;margin-bottom:8px">PIN: ' + esc(pin.label || '(no label)') + '</div>' +
    '<button id="pin-del-btn" style="width:100%;padding:6px;background:rgba(192,57,43,.15);border:1px solid rgba(192,57,43,.4);border-radius:6px;color:#f87171;font-size:11px;cursor:pointer;margin-bottom:6px">\uD83D\uDDD1 Delete Pin</button>' +
    '<button id="pin-cancel-btn" style="width:100%;padding:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:rgba(255,255,255,.7);font-size:11px;cursor:pointer">Cancel</button>';
  document.body.appendChild(d);
  document.getElementById('pin-del-btn').onclick = () => { _removePinDialog(); deletePinById(pin.id); };
  document.getElementById('pin-cancel-btn').onclick = _removePinDialog;
}

function _removePinDialog() {
  document.getElementById('pin-dialog')?.remove();
  document.getElementById('pin-menu')?.remove();
}

// ── Pin placement dialog (DM, called from canvas on pin tool click) ───────────

export function showPinDialog(worldX, worldY) {
  _removePinDialog();
  const journals = Object.values(serverData?.campaigns?.[MAP.campaignId]?.journals || {})
    .filter(j => j.visibility === 'player');
  const d = document.createElement('div');
  d.id = 'pin-dialog';
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:#1a1610;border:1px solid rgba(212,175,55,.4);border-radius:8px;padding:12px;' +
    'z-index:9998;min-width:220px;font-family:system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.7)';
  const journalOpts = '<option value="">\u2014 None \u2014</option>' +
    journals.map(j => '<option value="' + esc(j.id) + '">' + esc(j.title) + '</option>').join('');
  d.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:#d4af37;margin-bottom:10px">\uD83D\uDCCC New Map Pin</div>' +
    '<input id="pin-label-input" placeholder="Label (optional)" style="width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(212,175,55,.25);border-radius:6px;padding:6px 8px;color:#fff;font-size:11px;outline:none;margin-bottom:8px">' +
    '<select id="pin-journal-select" style="width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(212,175,55,.25);border-radius:6px;padding:6px 8px;color:#fff;font-size:11px;outline:none;margin-bottom:8px">' + journalOpts + '</select>' +
    '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<label style="font-size:10px;display:flex;align-items:center;gap:4px;cursor:pointer;color:rgba(255,255,255,.7)">' +
        '<input type="radio" name="pvis" value="dm" checked> DM only</label>' +
      '<label style="font-size:10px;display:flex;align-items:center;gap:4px;cursor:pointer;color:rgba(255,255,255,.7)">' +
        '<input type="radio" name="pvis" value="all"> All players</label>' +
    '</div>' +
    '<div style="display:flex;gap:6px">' +
      '<button id="pin-place-btn" style="flex:1;padding:7px;background:rgba(212,175,55,.15);border:1px solid rgba(212,175,55,.4);border-radius:6px;color:#d4af37;font-size:11px;font-weight:700;cursor:pointer">Place Pin</button>' +
      '<button id="pin-cancel-btn" style="padding:7px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:rgba(255,255,255,.7);font-size:11px;cursor:pointer">Cancel</button>' +
    '</div>';
  document.body.appendChild(d);
  document.getElementById('pin-label-input').focus();
  document.getElementById('pin-place-btn').onclick = () => _placePin(worldX, worldY);
  document.getElementById('pin-cancel-btn').onclick = _removePinDialog;
}

async function _placePin(worldX, worldY) {
  const label     = document.getElementById('pin-label-input')?.value?.trim() || '';
  const journalId = document.getElementById('pin-journal-select')?.value || null;
  const visible   = document.querySelector('input[name="pvis"]:checked')?.value || 'dm';
  _removePinDialog();
  if (!MAP.mapData) return;
  if (!MAP.mapData.pins) MAP.mapData.pins = [];
  const pin = { id: genId(), cx: worldX, cy: worldY, label, journalId: journalId || null, visible };
  MAP.mapData.pins.push(pin);
  // Persist
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (camp) {
    camp.maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  await realtimePublish(EV.PINS_UPDATE, {
    type: EV.PINS_UPDATE, campaignId: MAP.campaignId, mapId: MAP.mapId,
    pins: MAP.mapData.pins, fromUserId: userId,
  });
  renderPins();
}

export async function deletePinById(id) {
  if (!MAP.mapData?.pins) return;
  MAP.mapData.pins = MAP.mapData.pins.filter(p => p.id !== id);
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (camp) {
    camp.maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  await realtimePublish(EV.PINS_UPDATE, {
    type: EV.PINS_UPDATE, campaignId: MAP.campaignId, mapId: MAP.mapId,
    pins: MAP.mapData.pins, fromUserId: userId,
  });
  renderPins();
}

// ── Player journal overlay ────────────────────────────────────────────────────

function _showJournalOverlay(journalId) {
  const journal = serverData?.campaigns?.[MAP.campaignId]?.journals?.[journalId];
  if (!journal || journal.visibility !== 'player') return;
  showHandoutOverlay({ title: journal.title, content: journal.content });
}

export function showHandoutOverlay({ title, content }) {
  document.getElementById('handout-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'handout-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,sans-serif';
  overlay.innerHTML =
    '<div style="background:#1a1610;border:1px solid rgba(212,175,55,.4);border-radius:10px;padding:20px;max-width:360px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,.8)">' +
      '<div style="font-size:13px;font-weight:800;color:#d4af37;margin-bottom:10px;border-bottom:1px solid rgba(212,175,55,.25);padding-bottom:8px">' + esc(title) + '</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.85);line-height:1.6;white-space:pre-wrap">' + esc(content) + '</div>' +
      '<button onclick="document.getElementById(\'handout-overlay\').remove()" style="margin-top:14px;width:100%;padding:8px;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.3);border-radius:6px;color:#d4af37;font-size:11px;font-weight:700;cursor:pointer">Dismiss</button>' +
    '</div>';
  document.body.appendChild(overlay);
}
