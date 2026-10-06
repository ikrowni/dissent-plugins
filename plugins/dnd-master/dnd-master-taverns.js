// dnd-master-taverns.js — the Taverns tab: a tavern is a place the DM opens for everyone, like a shop, with tables.
//
// Each table has a HOST — an NPC the heroes talk to — running one of the DM's game setups (dnd-master-games.js).
// Opening a tavern sends `tavern:open` to the Hub, which draws the tavern and its hosts on every screen
// (dnd-hub-tavern.js). The Hub reads the tavern itself from the campaign, so the save goes first.
import { esc, genId, request, realtimePublishCompanion } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { persistDmCatalog, uploadCampaignFile } from './dnd-master-shops.js?v=20261014m';
import { cleanTavern, cleanHost, gameType } from './lk-tavern.js';

let _state = null;
let _volTimer = 0;

export function setTavernsState(s) { _state = s; }

/** The taverns as this tab holds them (read only, for the playtests). */
export const currentTaverns = () => Object.values(_state?.dmCampaign?.taverns || {});

const setups = () => _state.dmCampaign.gameSetups || {};

export function renderTavernsTab() {
  const el = document.getElementById('tab-taverns');
  if (!el || !_state?.dmCampaign) return;
  const taverns = currentTaverns();
  el.innerHTML =
    '<div class="lk-sec">CREATE TAVERN</div>' +
    '<div class="lk-row"><input id="tavern-name-input" class="search-input" placeholder="Tavern name…" style="margin:0;flex:1"></div>' +
    '<div class="lk-row"><span class="lk-lbl">Sound</span><input id="tavern-sound-input" type="file" accept="audio/*" style="font-size:10px;flex:1;min-width:0"></div>' +
    '<div class="lk-row"><span class="lk-lbl">Volume</span><input type="range" id="tavern-new-volume" min="0" max="1" step="0.05" value="0.5" style="flex:1"></div>' +
    '<div class="lk-row"><span class="lk-lbl" title="Optional: your own picture or video instead of the drawn tavern">Picture/video</span>' +
      '<input id="tavern-media-input" type="file" accept="image/*,video/*" style="font-size:10px;flex:1;min-width:0"></div>' +
    '<button id="btn-save-tavern" class="btn btn-gold" data-act="create" style="width:100%;margin-bottom:12px">+ Tavern</button>' +
    '<div class="lk-sec">TAVERNS</div>' +
    (taverns.length ? taverns.map(tavernCard).join('') : '<div class="lk-empty">No taverns yet</div>');
  el.onclick = onClick;
  el.oninput = onInput;
  el.onchange = onChange;
}

function tavernCard(raw) {
  const t = cleanTavern(raw);
  const setupList = Object.values(setups());
  const actors = Object.values(_state.dmCampaign.customActors || {});
  const hosts = t.hosts.map(h => {
    const s = setups()[h.setupId];
    return '<div class="host-row"><span class="who">🍺 <b>' + esc(h.name) + '</b> · ' +
      (s ? esc(s.name) : '<span style="color:#f97316">no game</span>') + '</span>' +
      '<button class="icon-x" data-act="del-host" data-t="' + t.id + '" data-h="' + h.id + '" title="Remove this table">&#x2715;</button></div>';
  }).join('');
  const addHost = setupList.length
    ? '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">' +
        '<div class="lk-row"><span class="lk-lbl">Host</span><select data-f="actor" data-t="' + t.id + '"><option value="">A new face…</option>' +
          actors.map(a => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('') + '</select></div>' +
        '<div class="lk-row"><span class="lk-lbl">Name</span><input type="text" data-f="name" data-t="' + t.id + '" placeholder="One-Eyed Marta"></div>' +
        '<div class="lk-row"><span class="lk-lbl">Game</span><select data-f="setup" data-t="' + t.id + '">' +
          setupList.map(s => '<option value="' + s.id + '">' + esc(s.name) + ' (' + esc(gameType(s.type)?.name || '') + ')</option>').join('') + '</select></div>' +
        '<div class="lk-row"><span class="lk-lbl">Says</span><textarea rows="2" data-f="greeting" data-t="' + t.id + '" placeholder="Fancy a throw, stranger?"></textarea></div>' +
        '<div class="lk-row"><span class="lk-lbl">Portrait</span><input type="file" accept="image/*" data-f="portrait" data-t="' + t.id + '" style="font-size:10px;flex:1;min-width:0"></div>' +
        '<button class="btn btn-ghost" data-act="add-host" data-t="' + t.id + '" style="width:100%;font-size:10px">+ Table</button></div>'
    : '<div style="font-size:10px;color:var(--muted);margin-top:6px">Set up a game in the Games tab to seat a host here.</div>';
  const hasSound = !!t.soundFileId;
  return '<div class="tavern-card" data-tavern="' + t.id + '">' +
    '<div class="lk-row" style="margin-bottom:6px"><span style="font-size:11px;font-weight:700;flex:1">🏮 ' + esc(t.name) + '</span>' +
      '<button class="btn btn-gold" data-act="open" data-t="' + t.id + '" style="font-size:10px;padding:2px 8px">&#x25B6; Open</button>' +
      '<button class="icon-x" data-act="del" data-t="' + t.id + '" title="Delete tavern">&#x1F5D1;</button></div>' +
    (hosts || '<div style="font-size:10px;color:var(--muted)">No tables yet</div>') + addHost +
    '<div class="lk-row" style="margin-top:6px"><span class="lk-lbl">' + (hasSound ? '🔊 Sound' : 'No sound') + '</span>' +
      (hasSound ? '<input type="range" min="0" max="1" step="0.05" value="' + t.ambientVolume + '" data-f="volume" data-t="' + t.id + '" style="flex:1">' : '<span style="flex:1"></span>') +
      '<label class="btn btn-ghost" style="font-size:10px;cursor:pointer">' + (hasSound ? 'Change' : 'Add sound') +
        '<input type="file" accept="audio/*" style="display:none" data-f="sound" data-t="' + t.id + '"></label></div>' +
    '<div class="lk-row"><span style="font-size:10px;color:var(--muted);flex:1">' + (t.videoFileId ? '🖼 Your picture/video' : '🏮 The drawn tavern') + '</span>' +
      '<label class="btn btn-ghost" style="font-size:10px;cursor:pointer">' + (t.videoFileId ? 'Change' : 'Use a picture/video') +
        '<input type="file" accept="image/*,video/*" style="display:none" data-f="media" data-t="' + t.id + '"></label>' +
      (t.videoFileId ? '<button class="btn btn-ghost" style="font-size:10px" data-act="no-media" data-t="' + t.id + '">Remove</button>' : '') + '</div>' +
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
  if (!b) return;
  const taverns = (_state.dmCampaign.taverns ||= {});
  const t = taverns[b.dataset.t];
  switch (b.dataset.act) {
    case 'create': return createTavern(b);
    case 'del':
      if (!t || !confirm(`Delete ${t.name}?`)) return;
      delete taverns[t.id]; break;
    case 'del-host':
      if (!t) return;
      t.hosts = (t.hosts || []).filter(h => h.id !== b.dataset.h); break;
    case 'add-host': {
      if (!t) return;
      const actorId = field(t.id, 'actor')?.value || null;
      const actor = actorId ? _state.dmCampaign.customActors?.[actorId] : null;
      const name = field(t.id, 'name')?.value.trim() || actor?.name || '';
      if (!name) { alert('Give the host a name, or pick one of your NPCs.'); return; }
      let portraitFileId = null;
      const file = field(t.id, 'portrait')?.files?.[0];
      if (file) { portraitFileId = await uploadCampaignFile(file, { maxSide: 1024 }); if (portraitFileId === false) return; }
      t.hosts = [...(t.hosts || []), cleanHost({ id: genId(), name, actorId, portraitFileId,
        setupId: field(t.id, 'setup')?.value, greeting: field(t.id, 'greeting')?.value })];
      break;
    }
    case 'no-media':
      if (!t) return;
      t.videoFileId = null; t.videoMime = ''; break;
    case 'open': return openTavern(t);
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
  const up = async id => { const f = document.getElementById(id)?.files?.[0]; return f ? [await uploadCampaignFile(f), f.type] : [null, '']; };
  const [soundFileId] = await up('tavern-sound-input');
  if (soundFileId === false) return done();
  const [videoFileId, videoMime] = await up('tavern-media-input');
  if (videoFileId === false) return done();
  const t = cleanTavern({ id: genId(), name, soundFileId, videoFileId, videoMime,
    ambientVolume: parseFloat(document.getElementById('tavern-new-volume')?.value || '0.5') });
  (_state.dmCampaign.taverns ||= {})[t.id] = t;
  done();
  renderTavernsTab();
  await save();
}

/**
 * Open the tavern on every screen. The event carries the tavern and its tables' game setups, so every Hub draws what
 * this tab shows without reading storage: under HTTP 429 the read came back stale (no hosts) or not at all. Sent with
 * `request` (the SDK's helper swallows a failure), retried once, and the DM is told if it still did not go.
 */
export async function openTavern(t) {
  if (!t) return;
  const tavern = cleanTavern(t);
  const setups = Object.fromEntries(tavern.hosts.map(h => [h.setupId, setups_()[h.setupId]]).filter(([, s]) => s));
  const payload = { type: 'tavern:open', tavernId: t.id, tavern, setups, campaignId: _state.dmCampaignId, fromUserId: _state.userId };
  saveHubDmCompanion(_state.serverData).catch(() => {}); // kept for later visits; the open itself does not wait on it
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await request('realtime:publish-companion', { registryId: 'dnd-hub', event: 'tavern:open', data: payload });
      return;
    } catch { await new Promise(r => setTimeout(r, 2000)); }
  }
  alert(`${tavern.name} did not open: the server is busy. Try again in a moment.`);
}
const setups_ = () => _state.dmCampaign.gameSetups || {};

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
  const { f, t: tid } = e.target.dataset;
  const t = _state.dmCampaign.taverns?.[tid];
  const file = e.target.files?.[0];
  if (!t || !file || (f !== 'sound' && f !== 'media')) return;
  const id = await uploadCampaignFile(file);
  if (!id) return;
  if (f === 'sound') t.soundFileId = id;
  else { t.videoFileId = id; t.videoMime = file.type || ''; }
  renderTavernsTab();
  await save();
}
