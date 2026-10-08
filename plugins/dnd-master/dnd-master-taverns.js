// dnd-master-taverns.js — the Taverns tab: a tavern is a map, a sound, and the NPCs who stand in it (owner, 2026-10-07).
//
// Load: the NPCs not yet on the tavern's map are stood on it (free squares near the middle; ones already there stay
// where the DM dragged them), the map becomes the active map, and `tavern:open` tells every Hub to switch to it and
// play the sound (dnd-hub-tavern.js). The games belong to the NPCs (Actors tab); a tavern only lists who is there.
import { esc, genId, request, realtimePublishCompanion } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { persistDmCatalog, uploadCampaignFile } from './dnd-master-shops.js?v=20261015v';
import { cleanTavern, MAX_TAVERN_NPCS } from './lk-tavern.js';
import { setNpcGame, placeNpcs, npcTalkPayload } from './dnd-master-actor-talk.js?v=20261015v';

let _state = null;
let _volTimer = 0;

export function setTavernsState(s) { _state = s; }

/** The taverns as this tab holds them (read only, for the playtests). */
export const currentTaverns = () => Object.values(_state?.dmCampaign?.taverns || {});

const npcs = () => Object.values(_state.dmCampaign.customActors || {}).filter(a => a.type === 'npc');
const maps = () => Object.values(_state.dmCampaign.maps || {});
const setups = () => Object.values(_state.dmCampaign.gameSetups || {});

export function renderTavernsTab() {
  const el = document.getElementById('tab-taverns');
  if (!el || !_state?.dmCampaign) return;
  const taverns = currentTaverns();
  el.innerHTML =
    '<div class="lk-sec">CREATE TAVERN</div>' +
    '<div class="lk-row"><input id="tavern-name-input" class="search-input" placeholder="Tavern name…" style="margin:0;flex:1"></div>' +
    '<div class="lk-row"><span class="lk-lbl">Map</span>' + mapSelect('id="tavern-map-input"', null) + '</div>' +
    '<div class="lk-row"><span class="lk-lbl">Sound</span><input id="tavern-sound-input" type="file" accept="audio/*" style="font-size:10px;flex:1;min-width:0"></div>' +
    '<div class="lk-row"><span class="lk-lbl">Volume</span><input type="range" id="tavern-new-volume" min="0" max="1" step="0.05" value="0.5" style="flex:1"></div>' +
    '<button id="btn-save-tavern" class="btn btn-gold" data-act="create" style="width:100%;margin-bottom:12px">+ Tavern</button>' +
    '<div class="lk-sec">TAVERNS</div>' +
    (taverns.length ? taverns.map(tavernCard).join('') : '<div class="lk-empty">No taverns yet</div>');
  el.onclick = onClick;
  el.oninput = onInput;
  el.onchange = onChange;
}

function mapSelect(attrs, chosen) {
  return '<select ' + attrs + ' style="flex:1;min-width:0"><option value="">' + (maps().length ? 'Pick a map…' : 'Upload a map in the Maps tab first') + '</option>' +
    maps().map(m => '<option value="' + esc(m.id) + '"' + (m.id === chosen ? ' selected' : '') + '>' + esc(m.name || 'Map') + '</option>').join('') + '</select>';
}

function tavernCard(raw) {
  const t = cleanTavern(raw);
  const actors = _state.dmCampaign.customActors || {};
  const rows = t.npcIds.map(id => actors[id]).filter(Boolean).map(a =>
    '<div class="host-row"><span class="who">🍺 <b>' + esc(a.name) + '</b></span>' +
      '<select data-f="game" data-a="' + a.id + '" title="The game ' + esc(a.name) + ' runs"><option value="">Just talks</option>' +
        setups().map(s => '<option value="' + s.id + '"' + (s.id === a.setupId ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select>' +
      '<button class="icon-x" data-act="del-npc" data-t="' + t.id + '" data-a="' + a.id + '" title="Take ' + esc(a.name) + ' out of this tavern">&#x2715;</button></div>').join('');
  const free = npcs().filter(a => !t.npcIds.includes(a.id));
  const add = t.npcIds.length >= MAX_TAVERN_NPCS ? '<div style="font-size:10px;color:var(--muted);margin-top:6px">A tavern holds up to ' + MAX_TAVERN_NPCS + ' NPCs.</div>'
    : free.length
      ? '<div class="lk-row" style="margin-top:6px"><select data-f="npc" data-t="' + t.id + '" style="flex:1;min-width:0">' +
          free.map(a => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('') + '</select>' +
        '<button class="btn btn-ghost" data-act="add-npc" data-t="' + t.id + '" style="font-size:10px">+ NPC</button></div>'
      : '<div style="font-size:10px;color:var(--muted);margin-top:6px">' + (npcs().length ? 'Every NPC is here.' : 'Make an NPC in the Actors tab to put them here.') + '</div>';
  const hasSound = !!t.soundFileId;
  return '<div class="tavern-card" data-tavern="' + t.id + '">' +
    '<div class="lk-row" style="margin-bottom:6px"><span style="font-size:11px;font-weight:700;flex:1">🏮 ' + esc(t.name) + '</span>' +
      '<button class="btn btn-gold" data-act="open" data-t="' + t.id + '" style="font-size:10px;padding:2px 8px"' +
        (t.mapId ? ' title="Everyone moves to this map, the NPCs appear, and the sound plays"' : ' disabled title="Pick a map first"') + '>&#x25B6; Load</button>' +
      '<button class="icon-x" data-act="del" data-t="' + t.id + '" title="Delete tavern (the NPCs are kept)">&#x1F5D1;</button></div>' +
    '<div class="lk-row"><span class="lk-lbl">Map</span>' + mapSelect('data-f="map" data-t="' + t.id + '"', t.mapId) + '</div>' +
    (rows || '<div style="font-size:10px;color:var(--muted)">No NPCs here yet</div>') + add +
    '<div class="lk-row" style="margin-top:6px"><span class="lk-lbl">' + (hasSound ? '🔊 Sound' : 'No sound') + '</span>' +
      (hasSound ? '<input type="range" min="0" max="1" step="0.05" value="' + t.ambientVolume + '" data-f="volume" data-t="' + t.id + '" style="flex:1">' : '<span style="flex:1"></span>') +
      '<label class="btn btn-ghost" style="font-size:10px;cursor:pointer">' + (hasSound ? 'Change' : 'Add sound') +
        '<input type="file" accept="audio/*" style="display:none" data-f="sound" data-t="' + t.id + '"></label></div>' +
  '</div>';
}

async function save() {
  _state.serverData.campaigns[_state.dmCampaignId].taverns = _state.dmCampaign.taverns;
  await saveHubDmCompanion(_state.serverData);
  await persistDmCatalog();
}

const field = (tid, f) => document.querySelector(`#tab-taverns [data-f="${f}"][data-t="${tid}"]`);

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const taverns = (_state.dmCampaign.taverns ||= {});
  const t = taverns[b.dataset.t];
  switch (b.dataset.act) {
    case 'create': return createTavern(b);
    case 'del':
      if (!t || !confirm(`Delete ${t.name}? Its NPCs are kept.`)) return;
      delete taverns[t.id]; break;
    case 'del-npc':
      if (!t) return;
      t.npcIds = (t.npcIds || []).filter(id => id !== b.dataset.a); break;
    case 'add-npc': {
      const id = field(t?.id, 'npc')?.value;
      if (!t || !id) return;
      taverns[t.id] = cleanTavern({ ...t, npcIds: [...(t.npcIds || []), id] }); break;
    }
    case 'open': return openTavern(t, b);
    default: return;
  }
  // Drawn first, saved after: a redraw when the save lands would wipe whatever the DM typed meanwhile.
  renderTavernsTab();
  await save();
}

async function createTavern(btn) {
  const name = document.getElementById('tavern-name-input')?.value.trim();
  if (!name) { alert('Tavern name is required.'); return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  const done = () => { btn.disabled = false; btn.textContent = '+ Tavern'; };
  const f = document.getElementById('tavern-sound-input')?.files?.[0];
  const soundFileId = f ? await uploadCampaignFile(f) : null;
  if (soundFileId === false) return done();
  const t = cleanTavern({ id: genId(), name, soundFileId, mapId: document.getElementById('tavern-map-input')?.value || null,
    ambientVolume: parseFloat(document.getElementById('tavern-new-volume')?.value || '0.5') });
  (_state.dmCampaign.taverns ||= {})[t.id] = t;
  done();
  renderTavernsTab();
  await save();
}

/**
 * Load the tavern for everyone: its NPCs onto its map (saved first), then `tavern:open`, which carries the tavern and
 * who talks, so every Hub acts without reading storage (under HTTP 429 a read came back stale or not at all). Sent
 * with `request` (the SDK's helper swallows a failure), retried once, and the DM is told if it still did not go.
 */
export async function openTavern(t, btn = null) {
  if (!t) return;
  const tavern = cleanTavern(t);
  if (!tavern.mapId || !_state.dmCampaign.maps?.[tavern.mapId]) { alert('Pick a map for this tavern first.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const placed = await placeNpcs(tavern.npcIds, tavern.mapId);
    if (placed === false) { alert(`${tavern.name} did not load: its map is gone. Pick another.`); return; }
    const payload = { type: 'tavern:open', tavernId: tavern.id, tavern, npcTokens: placed, ...npcTalkPayload(),
      campaignId: _state.dmCampaignId, fromUserId: _state.userId };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await request('realtime:publish-companion', { registryId: 'dnd-hub', event: 'tavern:open', data: payload });
        return;
      } catch { await new Promise(r => setTimeout(r, 2000)); }
    }
    alert(`${tavern.name} did not open: the server is busy. Try again in a moment.`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Load'; }
  }
}

function onInput(e) {
  if (e.target.dataset.f !== 'volume') return;
  const t = _state.dmCampaign.taverns?.[e.target.dataset.t];
  if (!t) return;
  t.ambientVolume = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0));
  clearTimeout(_volTimer);
  _volTimer = setTimeout(async () => {
    await save();
    await realtimePublishCompanion('dnd-hub', 'tavern:volume', { type: 'tavern:volume', tavernId: t.id,
      volume: t.ambientVolume, campaignId: _state.dmCampaignId, fromUserId: _state.userId });
  }, 150);
}

async function onChange(e) {
  const { f, t: tid, a } = e.target.dataset;
  if (f === 'game') return setNpcGame(a, e.target.value); // the game lives on the NPC (the Actors tab shows it too)
  const t = _state.dmCampaign.taverns?.[tid];
  if (!t) return;
  if (f === 'map') { t.mapId = e.target.value || null; renderTavernsTab(); return save(); }
  const file = e.target.files?.[0];
  if (f !== 'sound' || !file) return;
  const id = await uploadCampaignFile(file);
  if (!id) return;
  t.soundFileId = id;
  renderTavernsTab();
  await save();
}
