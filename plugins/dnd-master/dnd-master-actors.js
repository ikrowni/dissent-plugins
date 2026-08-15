// dnd-master-actors.js — Actors tab: custom NPC/monster builder
import { storageSetCompanion, esc, genId } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _pendingAttacks = [];

export function setActorsState(state) { _state = state; }

export function getCustomActors() {
  return Object.values(_state.dmCampaign?.customActors || {});
}

export function renderActorsTab() {
  const el = document.getElementById('tab-actors');
  if (!el) return;
  const actors = getCustomActors();
  el.innerHTML =
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">CUSTOM ACTORS</div>' +
    _actorForm() +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px;margin-top:8px;letter-spacing:.05em">ACTOR LIBRARY</div>' +
    (actors.length === 0
      ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">No custom actors yet</div>'
      : actors.map(a => _actorRow(a)).join('')
    );
}

const CR_OPTIONS = ['0','1/8','1/4','1/2','1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30'];
const SIZES = ['tiny','small','medium','large','huge','gargantuan'];

function _actorForm() {
  const atkRows = _pendingAttacks.map((a, i) =>
    '<div class="atk-row">' +
      '<span style="flex:1">' + esc(a.name) + '</span>' +
      '<span style="color:var(--gold);font-size:10px">+' + a.bonus + '</span>' +
      '<span style="color:var(--muted);font-size:10px;margin-left:4px">' + esc(a.damage) + '</span>' +
      '<button onclick="removePendingAttack(' + i + ')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;margin-left:4px">&#x2715;</button>' +
    '</div>'
  ).join('');

  return '<div class="actor-form">' +
    '<label>Name</label><input id="actor-name" placeholder="Goblin Shaman">' +
    '<label>CR</label>' +
    '<select id="actor-cr">' + CR_OPTIONS.map(c => '<option>' + c + '</option>').join('') + '</select>' +
    '<label>Type</label>' +
    '<select id="actor-type"><option value="npc">NPC</option><option value="monster">Monster</option></select>' +
    '<label>Size</label>' +
    '<select id="actor-size">' + SIZES.map(s => '<option value="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</option>').join('') + '</select>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px">' +
      _iField('actor-ac',    'AC',         '13') +
      _iField('actor-hp',    'HP',         '20') +
      _iField('actor-speed', 'Speed (ft)', '30') +
    '</div>' +
    '<label>Ability Scores (STR DEX CON INT WIS CHA)</label>' +
    '<div class="ability-grid">' +
    ['actor-str','actor-dex','actor-con','actor-int','actor-wis','actor-cha']
      .map(id => '<input class="num-input" id="' + id + '" type="number" value="10" min="1" max="30">').join('') +
    '</div>' +
    '<label>Attacks</label>' +
    '<div id="actor-atk-list">' + (atkRows || '<div style="font-size:10px;color:var(--muted);padding:4px 0">No attacks added</div>') + '</div>' +
    '<div style="display:grid;grid-template-columns:2fr 1fr 2fr;gap:4px;margin-top:4px">' +
      '<input id="atk-name"   class="search-input" style="margin:0" placeholder="Slam">' +
      '<input id="atk-bonus"  class="num-input"    type="number" value="3" style="width:100%" title="+attack bonus">' +
      '<input id="atk-damage" class="search-input" style="margin:0" placeholder="1d6+2">' +
    '</div>' +
    '<button class="btn btn-ghost" onclick="addPendingAttack()" style="width:100%;margin-top:4px;font-size:10px">+ Add Attack</button>' +
    '<button class="btn btn-gold"  onclick="saveNewActor()"    style="width:100%;margin-top:8px">&#x2795; Create Actor</button>' +
  '</div>';
}

function _iField(id, label, placeholder) {
  return '<div><label>' + label + '</label><input id="' + id + '" type="number" value="' + placeholder + '" min="0"></div>';
}

function _actorRow(a) {
  return '<div class="actor-row">' +
    '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:10px;background:rgba(212,175,55,.15);color:var(--gold);border:1px solid rgba(212,175,55,.25)">CR ' + esc(a.cr) + '</span>' +
    '<span style="flex:1;font-size:11px;font-weight:600">' + esc(a.name) + '</span>' +
    '<span style="font-size:9px;color:var(--muted)">' + esc(a.type) + ' \xb7 ' + a.hp + 'hp</span>' +
    '<button onclick="deleteActor(\'' + a.id + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0 2px" title="Delete">&#x2715;</button>' +
  '</div>';
}

export function addPendingAttack() {
  const name   = document.getElementById('atk-name')?.value.trim();
  const bonus  = parseInt(document.getElementById('atk-bonus')?.value)  || 0;
  const damage = document.getElementById('atk-damage')?.value.trim();
  if (!name || !damage) { alert('Attack name and damage are required.'); return; }
  _pendingAttacks.push({ name, bonus, damage });
  // Re-render just the attacks section without full tab re-render
  const list = document.getElementById('actor-atk-list');
  if (list) list.innerHTML = _pendingAttacks.map((a, i) =>
    '<div class="atk-row">' +
      '<span style="flex:1">' + esc(a.name) + '</span>' +
      '<span style="color:var(--gold);font-size:10px">+' + a.bonus + '</span>' +
      '<span style="color:var(--muted);font-size:10px;margin-left:4px">' + esc(a.damage) + '</span>' +
      '<button onclick="removePendingAttack(' + i + ')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;margin-left:4px">&#x2715;</button>' +
    '</div>'
  ).join('');
  document.getElementById('atk-name').value   = '';
  document.getElementById('atk-damage').value = '';
}

export function removePendingAttack(i) {
  _pendingAttacks.splice(i, 1);
  renderActorsTab(); // full re-render to rebuild attack list with corrected indices
}

export async function saveNewActor() {
  const name = document.getElementById('actor-name')?.value.trim();
  if (!name) { alert('Actor name is required.'); return; }
  const actor = {
    id:      genId(), name,
    cr:      document.getElementById('actor-cr')?.value    || '1',
    type:    document.getElementById('actor-type')?.value  || 'npc',
    size:    document.getElementById('actor-size')?.value  || 'medium',
    ac:      parseInt(document.getElementById('actor-ac')?.value)    || 13,
    hp:      parseInt(document.getElementById('actor-hp')?.value)    || 20,
    speed:   parseInt(document.getElementById('actor-speed')?.value) || 30,
    str:     parseInt(document.getElementById('actor-str')?.value)   || 10,
    dex:     parseInt(document.getElementById('actor-dex')?.value)   || 10,
    con:     parseInt(document.getElementById('actor-con')?.value)   || 10,
    int:     parseInt(document.getElementById('actor-int')?.value)   || 10,
    wis:     parseInt(document.getElementById('actor-wis')?.value)   || 10,
    cha:     parseInt(document.getElementById('actor-cha')?.value)   || 10,
    attacks: [..._pendingAttacks],
  };
  _pendingAttacks = [];
  if (!_state.dmCampaign.customActors) _state.dmCampaign.customActors = {};
  _state.dmCampaign.customActors[actor.id] = actor;
  _state.serverData.campaigns[_state.dmCampaignId].customActors = _state.dmCampaign.customActors;
  await saveHubDmCompanion(_state.serverData);
  renderActorsTab();
}

export async function deleteActor(id) {
  if (!_state.dmCampaign.customActors?.[id]) return;
  delete _state.dmCampaign.customActors[id];
  _state.serverData.campaigns[_state.dmCampaignId].customActors = _state.dmCampaign.customActors;
  await saveHubDmCompanion(_state.serverData);
  renderActorsTab();
}
