// dnd-hub-pins.js — map pin placement, rendering, and journal overlay
import { MAP, serverData, userId, effectiveGs } from './dnd-hub-state.js?v=20261015a';
import { storageSet, genId, esc, request } from '../plugin-sdk.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { EV } from './dnd-hub-event-types.js?v=20261015a';
import { saveHubDm } from './dnd-hub-storage.js?v=20261015a';

import { CLIENT_ID } from './dnd-hub-client-id.js';
import { canTravel, travelFields, travelSummary } from './dnd-hub-pin-travel.js';
import { campaignScenes, travelToScene, requestTravel, travelNotice } from './dnd-hub-travel.js';
let _pinSprites = []; // PixiJS containers currently on the ui layer

// ── Rendering ────────────────────────────────────────────────────────────────

export function renderPins() {
  if (!MAP.layers?.ui) return;
  _pinSprites.forEach(s => { if (s.parent) s.parent.removeChild(s); });
  _pinSprites = [];
  const pins = MAP.mapData?.pins || [];
  pins.forEach((pin, i) => {
    if (!MAP.isDM && (pin.visible !== 'all' || !_seenByPlayer(pin))) return;
    const container = new PIXI.Container();
    container.x = pin.cx;
    container.y = pin.cy;
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const circ = new PIXI.Graphics();
    // A travel pin (it opens a scene) is blue, so the table can tell a door from a note.
    circ.circle(0, 0, 9).fill({ color: pin.sceneId ? 0x6fb8d8 : 0xd4af37, alpha: 0.9 })
        .circle(0, 0, 9).stroke({ color: 0x000000, width: 1.5, alpha: 0.6 });
    container.addChild(circ);

    const label = new PIXI.Text({ text: String(i + 1), style: { fontSize: 9, fontWeight: 'bold', fill: 0x000000 } });
    label.anchor.set(0.5, 0.5);
    container.addChild(label);
    if (pin.label) {
      const name = new PIXI.Text({ text: pin.label, style: { fontSize: 11, fontWeight: 'bold', fill: 0xf3d27a,
        fontFamily: 'Georgia, serif', stroke: { color: 0x000000, width: 3 } } });
      name.anchor.set(0.5, 0); name.y = 11;
      container.addChild(name);
    }

    container.on('pointerdown', (e) => {
      e.stopPropagation();
      if (MAP.isDM) { _showDMPinMenu(pin); }
      else _showPinToPlayer(pin);
    });

    MAP.layers.ui.addChild(container);
    _pinSprites.push(container);
  });
}

// A player sees a pin once its square has been seen (it is drawn above the fog, so it would otherwise give away
// what is in rooms they have not reached).
function _seenByPlayer(pin) {
  const md = MAP.mapData;
  const gs = effectiveGs(md);
  const ox = (MAP._bgOffset?.x ?? 0) + (md.gridOffsetX || 0), oy = (MAP._bgOffset?.y ?? 0) + (md.gridOffsetY || 0);
  const key = `${Math.floor((pin.cx - ox) / gs)},${Math.floor((pin.cy - oy) / gs)}`;
  const st = md.fogState?.[key];
  return st === 'visible' || st === 'explored' || !!MAP.localSightCells?.has(key);
}

// What a player gets on clicking a pin: its note, then the linked journal page. Before, a pin with no linked
// journal did nothing at all, so a DM's note on the map never reached anyone (owner report 2026-10-03).
function _showPinToPlayer(pin) {
  const journal = pin.journalId ? serverData?.campaigns?.[MAP.campaignId]?.journals?.[pin.journalId] : null;
  const page = journal?.visibility === 'player' ? journal : null;
  const content = [pin.note, page ? page.content : ''].filter(Boolean).join('\n\n');
  // A travel pin the DM let this player use: the click asks the DM's Hub, which loads the scene for everyone.
  const action = canTravel(pin, userId, serverData?.campaigns?.[MAP.campaignId]?.dmUserId) ? {
    label: 'Travel', onClick: async (btn, close) => {
      btn.disabled = true; btn.textContent = 'Asking the DM\u2019s table\u2026';
      if (await requestTravel(pin)) close();
      else { btn.disabled = false; btn.textContent = 'Travel'; travelNotice('The DM\u2019s map did not answer. Is it open?'); }
    },
  } : null;
  showHandoutOverlay({ title: pin.label || page?.title || 'Map note', content: content || (action ? '' : '(no note)'), action });
}

// ── DM pin management menu ────────────────────────────────────────────────────

const _btn = 'width:100%;padding:6px;border-radius:6px;font-size:11px;cursor:pointer;margin-bottom:6px;';
const BTN_GOLD = _btn + 'background:rgba(212,175,55,.15);border:1px solid rgba(212,175,55,.4);color:var(--lk-gold);font-weight:700';
const BTN_PLAIN = _btn + 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.7)';
const BTN_DANGER = _btn + 'background:rgba(192,57,43,.15);border:1px solid rgba(192,57,43,.4);color:#f87171';

// A player's name for the DM's pin screens: their hero's token name, else a short id.
function _playerName(uid) {
  return MAP.mapData?.tokens?.['player_' + uid]?.name || 'Player ' + String(uid).slice(0, 4);
}

function _showDMPinMenu(pin) {
  _removePinDialog();
  const d = document.createElement('div');
  d.id = 'pin-menu';
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:var(--lk-raise);border:1px solid rgba(212,175,55,.4);border-radius:8px;padding:12px;' +
    'z-index:9998;min-width:220px;max-width:300px;font-family:system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.7)';
  d.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--lk-gold);margin-bottom:6px">PIN: ' + esc(pin.label || '(no label)') + '</div>' +
    (pin.note ? '<div style="font-size:11px;color:rgba(255,255,255,.8);white-space:pre-wrap;margin-bottom:6px">' + esc(pin.note) + '</div>' : '') +
    '<div style="font-size:10px;color:rgba(255,255,255,.5);margin-bottom:4px">' + (pin.visible === 'all' ? 'Players can open it once they have seen this spot' : 'DM only') + '</div>' +
    (pin.sceneId ? '<div style="font-size:10px;color:rgba(255,255,255,.5);margin-bottom:8px">' + esc(travelSummary(pin, _playerName)) + '</div>' +
      '<button id="pin-travel-btn" style="' + BTN_GOLD + '">\u27A4 Go to <span id="pin-scene-name">the scene</span></button>' : '<div style="height:4px"></div>') +
    '<button id="pin-edit-btn" style="' + BTN_PLAIN + '">\u270E Edit pin</button>' +
    '<button id="pin-del-btn" style="' + BTN_DANGER + '">\uD83D\uDDD1 Delete Pin</button>' +
    '<button id="pin-cancel-btn" style="' + BTN_PLAIN + ';margin-bottom:0">Cancel</button>';
  document.body.appendChild(d);
  document.getElementById('pin-del-btn').onclick = () => { _removePinDialog(); deletePinById(pin.id); };
  document.getElementById('pin-edit-btn').onclick = () => showPinDialog(pin.cx, pin.cy, pin);
  document.getElementById('pin-cancel-btn').onclick = _removePinDialog;
  const go = document.getElementById('pin-travel-btn');
  if (go) {
    campaignScenes().then(sc => {
      const name = document.getElementById('pin-scene-name');
      if (name) name.textContent = sc[pin.sceneId]?.name || 'a deleted scene';
    });
    go.onclick = async () => { go.disabled = true; _removePinDialog(); await travelToScene(pin.sceneId); };
  }
}

function _removePinDialog() {
  document.getElementById('pin-dialog')?.remove();
  document.getElementById('pin-menu')?.remove();
}

// ── Pin placement dialog (DM, called from canvas on pin tool click) ───────────

const FIELD = 'width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(212,175,55,.25);border-radius:6px;padding:6px 8px;color:#fff;font-size:11px;outline:none;margin-bottom:8px';
const HINT = 'font-size:10px;color:rgba(255,255,255,.5);margin-bottom:4px';
const radio = (name, value, label, cur) => '<label style="font-size:10px;display:flex;align-items:center;gap:4px;cursor:pointer;color:rgba(255,255,255,.7)">' +
  '<input type="radio" name="' + name + '" value="' + value + '"' + (cur === value ? ' checked' : '') + '> ' + label + '</label>';

/** The DM's pin form: a new pin at (worldX, worldY), or `edit` (an existing pin) changed in place. */
export function showPinDialog(worldX, worldY, edit = null) {
  _removePinDialog();
  const camp = serverData?.campaigns?.[MAP.campaignId];
  const journals = Object.values(camp?.journals || {}).filter(j => j.visibility === 'player');
  const players = (camp?.members || []).filter(uid => uid && uid !== camp?.dmUserId);
  const cur = { label: '', note: '', journalId: '', visible: 'all', sceneId: '', travel: 'dm', travelers: [], ...(edit || {}) };
  const d = document.createElement('div');
  d.id = 'pin-dialog';
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:var(--lk-raise);border:1px solid rgba(212,175,55,.4);border-radius:8px;padding:12px;' +
    'z-index:9998;width:260px;max-height:90vh;overflow-y:auto;font-family:system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.7)';
  const journalOpts = '<option value="">\u2014 None \u2014</option>' +
    journals.map(j => '<option value="' + esc(j.id) + '"' + (j.id === cur.journalId ? ' selected' : '') + '>' + esc(j.title) + '</option>').join('');
  d.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--lk-gold);margin-bottom:10px">\uD83D\uDCCC ' + (edit ? 'Edit Map Pin' : 'New Map Pin') + '</div>' +
    '<input id="pin-label-input" placeholder="Title (shown on the map)" value="' + esc(cur.label) + '" style="' + FIELD + '">' +
    '<textarea id="pin-note-input" rows="3" placeholder="Note (what players read when they click it)" style="' + FIELD + ';resize:vertical;font-family:inherit">' + esc(cur.note) + '</textarea>' +
    '<div style="' + HINT + '">Linked journal page (optional)</div>' +
    '<select id="pin-journal-select" style="' + FIELD + '">' + journalOpts + '</select>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px">' + radio('pvis', 'all', 'Players too', cur.visible) + radio('pvis', 'dm', 'DM only', cur.visible) + '</div>' +
    '<div style="' + HINT + '">Opens a scene (optional)</div>' +
    '<select id="pin-scene-select" style="' + FIELD + '"><option value="">\u2014 No scene \u2014</option></select>' +
    '<div id="pin-travel-box" style="display:none;margin:-2px 0 8px">' +
      '<div style="' + HINT + '">Who can travel with it</div>' +
      '<div style="display:flex;flex-direction:column;gap:3px">' + radio('ptravel', 'dm', 'Only me', cur.travel) + radio('ptravel', 'all', 'Every player', cur.travel) +
        (players.length ? radio('ptravel', 'some', 'Chosen players', cur.travel) : '') + '</div>' +
      '<div id="pin-travelers" style="display:none;margin:4px 0 0 16px;flex-direction:column;gap:3px">' +
        players.map(uid => '<label style="font-size:10px;display:flex;align-items:center;gap:4px;cursor:pointer;color:rgba(255,255,255,.7)">' +
          '<input type="checkbox" name="ptraveler" value="' + esc(uid) + '"' + (cur.travelers.includes(uid) ? ' checked' : '') + '> ' + esc(_playerName(uid)) + '</label>').join('') +
      '</div>' +
      '<div id="pin-travel-hint" style="font-size:10px;color:#f0b35a;margin-top:4px;display:none">Players cannot use a DM-only pin.</div>' +
    '</div>' +
    '<div style="display:flex;gap:6px">' +
      '<button id="pin-place-btn" style="flex:1;padding:7px;background:rgba(212,175,55,.15);border:1px solid rgba(212,175,55,.4);border-radius:6px;color:var(--lk-gold);font-size:11px;font-weight:700;cursor:pointer">' + (edit ? 'Save Pin' : 'Place Pin') + '</button>' +
      '<button id="pin-cancel-btn" style="padding:7px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:rgba(255,255,255,.7);font-size:11px;cursor:pointer">Cancel</button>' +
    '</div>';
  document.body.appendChild(d);
  const sceneSel = document.getElementById('pin-scene-select');
  const sync = () => {
    const travel = document.querySelector('input[name="ptravel"]:checked')?.value || 'dm';
    const dmOnly = document.querySelector('input[name="pvis"]:checked')?.value === 'dm';
    document.getElementById('pin-travel-box').style.display = sceneSel.value ? 'block' : 'none';
    document.getElementById('pin-travelers').style.display = travel === 'some' ? 'flex' : 'none';
    document.getElementById('pin-travel-hint').style.display = dmOnly && travel !== 'dm' ? 'block' : 'none';
  };
  d.addEventListener('change', sync);
  campaignScenes().then(scenes => {
    const list = Object.values(scenes);
    sceneSel.innerHTML = '<option value="">' + (list.length ? '\u2014 No scene \u2014' : '\u2014 No scenes yet (DM sidebar \u2192 Scenes) \u2014') + '</option>' +
      list.map(sc => '<option value="' + esc(sc.id) + '"' + (sc.id === cur.sceneId ? ' selected' : '') + '>' + esc(sc.name) + '</option>').join('') +
      (cur.sceneId && !scenes[cur.sceneId] ? '<option value="' + esc(cur.sceneId) + '" selected>(a deleted scene)</option>' : '');
    sync();
  });
  sync();
  document.getElementById('pin-label-input').focus();
  document.getElementById('pin-place-btn').onclick = () => _placePin(worldX, worldY, edit);
  document.getElementById('pin-cancel-btn').onclick = _removePinDialog;
}

async function _placePin(worldX, worldY, edit) {
  const label     = document.getElementById('pin-label-input')?.value?.trim() || '';
  const note      = document.getElementById('pin-note-input')?.value?.trim() || '';
  const journalId = document.getElementById('pin-journal-select')?.value || null;
  const visible   = document.querySelector('input[name="pvis"]:checked')?.value || 'dm';
  const travel    = travelFields({
    sceneId: document.getElementById('pin-scene-select')?.value || null,
    travel: document.querySelector('input[name="ptravel"]:checked')?.value,
    travelers: [...document.querySelectorAll('input[name="ptraveler"]:checked')].map(x => x.value),
  });
  _removePinDialog();
  if (!MAP.mapData) return;
  if (!MAP.mapData.pins) MAP.mapData.pins = [];
  const pin = { ...(edit || {}), id: edit?.id || genId(), cx: worldX, cy: worldY, label, note, journalId: journalId || null, visible, ...travel };
  const i = MAP.mapData.pins.findIndex(x => x.id === pin.id);
  if (i >= 0) MAP.mapData.pins[i] = pin; else MAP.mapData.pins.push(pin);
  await savePinsAndBroadcast();
}

export async function savePinsAndBroadcast() {
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (camp) {
    camp.maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  await realtimePublish(EV.PINS_UPDATE, { clientId: CLIENT_ID,
    type: EV.PINS_UPDATE, campaignId: MAP.campaignId, mapId: MAP.mapId,
    pins: MAP.mapData.pins, fromUserId: userId,
  });
  renderPins();
}

export async function deletePinById(id) {
  if (!MAP.mapData?.pins) return;
  MAP.mapData.pins = MAP.mapData.pins.filter(p => p.id !== id);
  await savePinsAndBroadcast();
}

// ── Player journal overlay ────────────────────────────────────────────────────

/**
 * A page the DM shared, over the map: its title, its text, and (a picture from a book, or any image the DM showed)
 * its picture, loaded from the campaign's copy. Esc or Dismiss closes it.
 */
export function showHandoutOverlay({ title, content, imageFileId, action = null }) {
  document.getElementById('handout-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'handout-overlay';
  overlay.className = 'lk-handout';
  overlay.innerHTML =
    `<div class="lk-handout-card${imageFileId ? ' has-pic' : ''}" role="dialog" aria-label="${esc(title)}">` +
      `<div class="lk-handout-title">${esc(title)}</div>` +
      (imageFileId ? '<div class="lk-handout-pic"><div class="lk-handout-wait">Unrolling…</div></div>' : '') +
      (content ? `<div class="lk-handout-text">${esc(content)}</div>` : '') +
      (action ? `<button class="lk-handout-close lk-handout-action">${esc(action.label)}</button>` : '') +
      '<button class="lk-handout-close">Dismiss</button>' +
    '</div>';
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  overlay.querySelector('.lk-handout-close:not(.lk-handout-action)').onclick = close;
  const act = overlay.querySelector('.lk-handout-action');
  if (act) act.onclick = () => action.onClick(act, close);
  overlay.onclick = e => { if (e.target === overlay) close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  if (imageFileId) {
    request('files:loadArrayBuffer', { fileId: imageFileId }, 60000).then(r => {
      const url = URL.createObjectURL(new Blob([r.buffer], { type: r.mime || 'image/webp' }));
      const box = overlay.querySelector('.lk-handout-pic');
      if (box) box.innerHTML = `<img src="${url}" alt="${esc(title)}">`;
    }).catch(() => { const w = overlay.querySelector('.lk-handout-wait'); if (w) w.textContent = 'The picture could not be loaded.'; });
  }
}
