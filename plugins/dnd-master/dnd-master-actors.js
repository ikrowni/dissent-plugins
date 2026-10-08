// dnd-master-actors.js — Actors tab: the DM's own NPCs and monsters.
//
// An NPC can run a tavern game (owner, 2026-10-07): it carries `setupId` (a game setup from the Games tab), `greeting`
// and `portraitFileId`, and "Place on map" stands its token on the active map, where heroes right-click it to talk.
import { esc, genId } from '../plugin-sdk.js';
import { uploadCampaignFile } from './dnd-master-shops.js?v=20261015s';
import { saveActors, placeNpcs } from './dnd-master-actor-talk.js?v=20261015s';
import { gameType } from './lk-tavern.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _pendingAttacks = [];
let _editingId = null;

export function setActorsState(state) { _state = state; }

export function getCustomActors() {
  return Object.values(_state.dmCampaign?.customActors || {});
}

const BLANK = { name: '', cr: '1', type: 'npc', size: 'medium', ac: 13, hp: 20, speed: 30,
  str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, setupId: '', greeting: '', portraitFileId: null };

export function renderActorsTab() {
  const el = document.getElementById('tab-actors');
  if (!el) return;
  const actors = getCustomActors();
  const editing = _editingId ? _state.dmCampaign.customActors?.[_editingId] : null;
  el.innerHTML =
    '<div class="lk-sec">' + (editing ? 'EDIT ' + esc(editing.name).toUpperCase() : 'CUSTOM ACTORS') + '</div>' +
    _actorForm(editing || BLANK) +
    '<div class="lk-sec" style="margin-top:8px">ACTOR LIBRARY</div>' +
    (actors.length ? actors.map(_actorRow).join('') : '<div class="lk-empty">No custom actors yet</div>');
}

const CR_OPTIONS = ['0','1/8','1/4','1/2','1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30'];
const SIZES = ['tiny','small','medium','large','huge','gargantuan'];
const ABILITIES = ['str','dex','con','int','wis','cha'];

function _attackRows() {
  return _pendingAttacks.map((a, i) =>
    '<div class="atk-row"><span style="flex:1">' + esc(a.name) + '</span>' +
      '<span style="color:var(--gold);font-size:10px">+' + a.bonus + '</span>' +
      '<span style="color:var(--muted);font-size:10px;margin-left:4px">' + esc(a.damage) + '</span>' +
      '<button onclick="removePendingAttack(' + i + ')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;margin-left:4px">&#x2715;</button></div>'
  ).join('') || '<div style="font-size:10px;color:var(--muted);padding:4px 0">No attacks added</div>';
}

function _actorForm(a) {
  const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(label) + '</option>';
  const setups = Object.values(_state.dmCampaign?.gameSetups || {});
  return '<div class="actor-form">' +
    '<label>Name</label><input id="actor-name" placeholder="Goblin Shaman" value="' + esc(a.name) + '">' +
    '<label>CR</label><select id="actor-cr">' + CR_OPTIONS.map(c => opt(c, c, a.cr)).join('') + '</select>' +
    '<label>Type</label><select id="actor-type" onchange="renderActorsTabKeep()">' + opt('npc', 'NPC', a.type) + opt('monster', 'Monster', a.type) + '</select>' +
    '<label>Size</label><select id="actor-size">' + SIZES.map(s => opt(s, s[0].toUpperCase() + s.slice(1), a.size)).join('') + '</select>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px">' +
      _iField('actor-ac', 'AC', a.ac) + _iField('actor-hp', 'HP', a.hp) + _iField('actor-speed', 'Speed (ft)', a.speed) + '</div>' +
    '<label>Ability Scores (STR DEX CON INT WIS CHA)</label><div class="ability-grid">' +
      ABILITIES.map(k => '<input class="num-input" id="actor-' + k + '" type="number" value="' + (a[k] ?? 10) + '" min="1" max="30">').join('') + '</div>' +
    (a.type === 'npc'
      ? '<div class="actor-talk"><label>Runs a game</label><select id="actor-game">' +
          opt('', setups.length ? 'No game — just talks' : 'No game (set one up in the Games tab)', a.setupId || '') +
          setups.map(s => opt(s.id, s.name + ' (' + (gameType(s.type)?.name || '') + ')', a.setupId || '')).join('') + '</select>' +
        '<label>What they say</label><textarea id="actor-greeting" rows="2" maxlength="300" placeholder="Fancy a game of bones, stranger?">' + esc(a.greeting || '') + '</textarea>' +
        '<label>Portrait' + (a.portraitFileId ? ' (has one — pick a file to change it)' : '') + '</label><input id="actor-portrait" type="file" accept="image/*" style="font-size:10px"></div>'
      : '') +
    '<label>Attacks</label><div id="actor-atk-list">' + _attackRows() + '</div>' +
    '<div style="display:grid;grid-template-columns:2fr 1fr 2fr;gap:4px;margin-top:4px">' +
      '<input id="atk-name" class="search-input" style="margin:0" placeholder="Slam">' +
      '<input id="atk-bonus" class="num-input" type="number" value="3" style="width:100%" title="+attack bonus">' +
      '<input id="atk-damage" class="search-input" style="margin:0" placeholder="1d6+2"></div>' +
    '<button class="btn btn-ghost" onclick="addPendingAttack()" style="width:100%;margin-top:4px;font-size:10px">+ Add Attack</button>' +
    '<button id="actor-save" class="btn btn-gold" onclick="saveNewActor()" style="width:100%;margin-top:8px">' + (_editingId ? 'Save changes' : '&#x2795; Create Actor') + '</button>' +
    (_editingId ? '<button class="btn btn-ghost" onclick="cancelEditActor()" style="width:100%;margin-top:4px;font-size:10px">Cancel</button>' : '') +
  '</div>';
}

function _iField(id, label, value) {
  return '<div><label>' + label + '</label><input id="' + id + '" type="number" value="' + esc(String(value ?? '')) + '" min="0"></div>';
}

function _actorRow(a) {
  const game = a.type === 'npc' && a.setupId ? _state.dmCampaign.gameSetups?.[a.setupId] : null;
  return '<div class="actor-row" data-actor="' + a.id + '">' +
    '<span class="lk-badge gold">CR ' + esc(a.cr) + '</span>' +
    '<span style="flex:1;font-size:11px;font-weight:600">' + esc(a.name) +
      (game ? ' <span style="font-weight:400;color:var(--muted)">· 🎲 ' + esc(game.name) + '</span>' : '') + '</span>' +
    '<span style="font-size:9px;color:var(--muted)">' + esc(a.type) + ' · ' + a.hp + 'hp</span>' +
    (a.type === 'npc' ? '<button class="icon-x" onclick="placeActorOnMap(\'' + a.id + '\')" title="Stand ' + esc(a.name) + ' on the map that is open now">📍</button>' : '') +
    '<button class="icon-x" onclick="editActor(\'' + a.id + '\')" title="Edit">✎</button>' +
    '<button class="icon-x" onclick="deleteActor(\'' + a.id + '\')" title="Delete">&#x2715;</button>' +
  '</div>';
}

/** Re-draw the form keeping what the DM has typed (switching NPC ↔ Monster shows or hides the NPC fields). */
export function renderActorsTabKeep() {
  const draft = _readForm(); // the stored actor only changes on Save
  const editing = _editingId ? _state.dmCampaign.customActors?.[_editingId] : null;
  const form = document.querySelector('#tab-actors .actor-form');
  if (form) form.outerHTML = _actorForm({ ...BLANK, ...(editing || {}), ...draft });
}

function _readForm() {
  const v = id => document.getElementById(id)?.value;
  const n = (id, d) => parseInt(v(id)) || d;
  return {
    name: (v('actor-name') || '').trim(), cr: v('actor-cr') || '1', type: v('actor-type') || 'npc', size: v('actor-size') || 'medium',
    ac: n('actor-ac', 13), hp: n('actor-hp', 20), speed: n('actor-speed', 30),
    ...Object.fromEntries(ABILITIES.map(k => [k, n('actor-' + k, 10)])),
    ...(document.getElementById('actor-game') ? {
      setupId: v('actor-game') || '', greeting: (v('actor-greeting') || '').trim().slice(0, 300) } : {}),
  };
}

export function addPendingAttack() {
  const name   = document.getElementById('atk-name')?.value.trim();
  const bonus  = parseInt(document.getElementById('atk-bonus')?.value) || 0;
  const damage = document.getElementById('atk-damage')?.value.trim();
  if (!name || !damage) { alert('Attack name and damage are required.'); return; }
  _pendingAttacks.push({ name, bonus, damage });
  document.getElementById('actor-atk-list').innerHTML = _attackRows();
  document.getElementById('atk-name').value = '';
  document.getElementById('atk-damage').value = '';
}

export function removePendingAttack(i) {
  _pendingAttacks.splice(i, 1);
  document.getElementById('actor-atk-list').innerHTML = _attackRows();
}

export async function saveNewActor() {
  const form = _readForm();
  if (!form.name) { alert('Actor name is required.'); return; }
  const btn = document.getElementById('actor-save');
  const file = document.getElementById('actor-portrait')?.files?.[0];
  let portraitFileId;
  if (file) {
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    portraitFileId = await uploadCampaignFile(file, { maxSide: 1024 });
    if (!portraitFileId) { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } return; }
  }
  const old = _editingId ? _state.dmCampaign.customActors?.[_editingId] : null;
  const actor = { ...(old || {}), ...form, id: old?.id || genId(), attacks: [..._pendingAttacks],
    ...(portraitFileId ? { portraitFileId } : {}) };
  if (actor.type !== 'npc') { delete actor.setupId; delete actor.greeting; }
  _pendingAttacks = [];
  _editingId = null;
  (_state.dmCampaign.customActors ||= {})[actor.id] = actor;
  renderActorsTab(); // drawn first, saved after (see dnd-master-taverns.js)
  await saveActors();
}

export function editActor(id) {
  const a = _state.dmCampaign.customActors?.[id];
  if (!a) return;
  _editingId = id;
  _pendingAttacks = [...(a.attacks || [])];
  renderActorsTab();
  document.getElementById('actor-name')?.scrollIntoView({ block: 'center' });
}

export function cancelEditActor() {
  _editingId = null;
  _pendingAttacks = [];
  renderActorsTab();
}

export async function placeActorOnMap(id) {
  const a = _state.dmCampaign.customActors?.[id];
  if (!a) return;
  const placed = await placeNpcs([id]);
  if (placed === false) alert('Open a map first (Maps tab), then place ' + a.name + '.');
  else if (!placed.length) alert(a.name + ' is already on this map.');
}

export async function deleteActor(id) {
  if (!_state.dmCampaign.customActors?.[id]) return;
  delete _state.dmCampaign.customActors[id];
  for (const t of Object.values(_state.dmCampaign.taverns || {})) t.npcIds = (t.npcIds || []).filter(x => x !== id);
  if (_editingId === id) _editingId = null;
  renderActorsTab();
  await saveActors();
}
