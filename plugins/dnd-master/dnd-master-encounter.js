// dnd-master-encounter.js — encounter builder: monster list, roster, XP budget, launch
import { storageGet, storageSet, storageGetCompanion, storageSetCompanion, realtimePublish, realtimePublishCompanion, localPublish, esc, genId } from '../plugin-sdk.js';
import { publicPayload } from './lk-secrets.js';
import { EV } from './dnd-hub-event-types.js?v=20261014w';
import { XP_THRESHOLDS, CR_XP } from './dnd-master-monsters.js';
import { setInitiativeState } from './dnd-master-initiative.js';
import { adjustedEncounterXp } from './lk-rules5e.js';
import { preparedToDraft, spawnPositions } from './dnd-master-prepared.js';
import { loadHubDmCompanion, saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { rule } from './lk-table-rules.js';
import { startInitiative } from './dnd-master-init-order.js';
import { publishTo } from './lk-bus.js';
import { applyFilter, filterBarHtml, getFilter, onFilterChange, typesIn, moreLine } from './dnd-master-monster-filter.js';

let encounterCreatures = [];
let _preparedSpawn = null; // cells for the loaded prepared encounter (content packs)
let _targetDifficulty = null;
let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, srdMonsters: [], switchDMTab: null, userId: null };
let _onLaunch = null;
let _encMonsterListH = 180; // draggable divider height (px)

export function setLaunchCallback(cb) { _onLaunch = cb; }

function _draftKey() { return 'encounter-draft-' + (_state.dmCampaignId || 'x'); }
async function _saveDraft() {
  await storageSet(_draftKey(), {
    items: encounterCreatures.map(e => ({ id: e.monster.id, count: e.count, lootItems: e.lootItems || [] })),
    targetDifficulty: _targetDifficulty,
  });
}
export async function loadEncounterDraft() {
  const draft = await storageGet(_draftKey());
  if (!draft?.items?.length) return;
  encounterCreatures = draft.items.map(item => {
    let monster = _state.srdMonsters.find(m => m.id === item.id);
    if (!monster && item.id.startsWith('custom_')) {
      const actor = (_state.dmCampaign?.customActors || {})[item.id.slice(7)];
      if (actor) monster = { id: item.id, name: actor.name, type: actor.type, cr: actor.cr,
        hp: actor.hp, ac: actor.ac, dex: actor.dex || 10, hp_dice: String(actor.hp) };
    }
    return monster ? { monster, count: item.count || 1, lootItems: item.lootItems || [] } : null;
  }).filter(Boolean);
  _targetDifficulty = draft.targetDifficulty ?? null;
}

export function setEncounterTargetDifficulty(t) {
  _targetDifficulty = _targetDifficulty === t ? null : t;
  _saveDraft();
  renderXPBudget();
}

export function setEncounterState({ dmCampaign, dmCampaignId, serverData, srdMonsters, switchDMTab, userId }) {
  _state = { dmCampaign, dmCampaignId, serverData, srdMonsters, switchDMTab, userId };
}

// --- Private helpers ---
function abilityMod(s) { return Math.floor((s - 10) / 2); }
function rollDice(n, d, mod) { mod = mod || 0; let t = 0; for (let i = 0; i < n; i++) t += Math.ceil(Math.random() * d); return t + mod; }
function parseHPDice(expr) {
  const m = String(expr).match(/^(\d+)d(\d+)([+-]\d+)?/);
  if (!m) return [1, 8, 0];
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3] || '0')];
}

function _parseAttacks(srdMonster) {
  if (!srdMonster?.actions) return [];
  return srdMonster.actions
    .filter(a => a.attack_bonus != null && a.attack_bonus !== 0)
    .map(a => {
      const dmgMatch  = a.desc.match(/Hit:\s*\d+\s*\(([^)]+)\)/i);
      const reachMatch = a.desc.match(/reach\s+(\d+)\s*ft/i);
      const rangeMatch = a.desc.match(/range\s+(\d+)\/\d+\s*ft/i);
      const withinMatch = a.desc.match(/within\s+(\d+)\s*ft/i);
      const rangeFt = reachMatch  ? parseInt(reachMatch[1])
                    : rangeMatch  ? parseInt(rangeMatch[1])
                    : withinMatch ? parseInt(withinMatch[1])
                    : 5;
      return {
        name: a.name,
        toHit: a.attack_bonus,
        damageDice: dmgMatch ? dmgMatch[1].replace(/\s/g, '') : '1d6',
        rangeFt,
      };
    });
}

export function renderEncounterBuilder() {
  const el = document.getElementById('tab-encounter');
  el.innerHTML =
    (Object.values(_state.dmCampaign?.encounters || {}).length
      ? '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px">PREPARED</div>' +
        Object.values(_state.dmCampaign.encounters).map(e =>
          '<div class="setting-row"><div style="flex:1;font-size:11px">' + esc(e.name) +
          ' <span style="color:var(--muted)">' + esc(e.difficulty || '') + '</span></div>' +
          '<button class="btn btn-ghost btn-sm" onclick="loadPreparedEncounter(\'' + esc(e.id) + '\')">Load</button></div>').join('') +
        '<div style="height:10px"></div>'
      : '') +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">ENCOUNTER BUILDER</div>' +
    '<input class="search-input" id="enc-search" placeholder="Search monsters\u2026" oninput="filterMonsters(this.value)" value="' + esc(getFilter('enc').q) + '">' +
    '<div id="enc-filters"></div>' +
    '<div id="enc-monster-list" style="height:' + _encMonsterListH + 'px;overflow-y:auto;margin-bottom:0"></div>' +
    '<div id="enc-divider" style="height:10px;cursor:row-resize;display:flex;align-items:center;justify-content:center;margin:2px 0" title="Drag to resize">' +
      '<div style="width:36px;height:3px;background:rgba(255,255,255,.18);border-radius:2px"></div>' +
    '</div>' +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px;letter-spacing:.05em">ENCOUNTER ROSTER</div>' +
    '<div id="enc-creature-list" style="min-height:40px;margin-bottom:8px">' +
      '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">Add monsters above to build encounter</div>' +
    '</div>' +
    '<div id="enc-xp-budget"></div>' +
    '<div style="margin-top:10px;display:flex;gap:6px">' +
      '<button class="btn btn-ghost" onclick="clearEncounter()" style="flex:1">Clear</button>' +
      '<button class="btn btn-gold" onclick="launchEncounter()" style="flex:2" id="btn-launch">&#x2694;&#xFE0F; Launch Encounter</button>' +
    '</div>';
  onFilterChange('enc', () => { _renderEncFilters(); filterMonsters(); });
  _renderEncFilters();
  filterMonsters();
  _wireEncDivider();
}

function _wireEncDivider() {
  const divider = document.getElementById('enc-divider');
  if (!divider) return;
  let startY = 0, startH = 0;
  divider.addEventListener('mousedown', e => {
    startY = e.clientY;
    startH = _encMonsterListH;
    e.preventDefault();
    const onMove = ev => {
      _encMonsterListH = Math.max(60, Math.min(400, startH + (ev.clientY - startY)));
      const listEl = document.getElementById('enc-monster-list');
      if (listEl) listEl.style.height = _encMonsterListH + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// The SRD and book monsters plus the DM's own NPCs and creatures.
function _encPool() {
  const customAsMonsters = Object.values(_state.dmCampaign?.customActors || {}).map(a => ({
    id: 'custom_' + a.id,
    name: a.name, type: a.type, cr: a.cr, hp: a.hp, ac: a.ac,
    dex: a.dex || 10, hp_dice: String(a.hp),
    _isCustom: true,
  }));
  return [..._state.srdMonsters, ...customAsMonsters];
}

function _renderEncFilters() {
  const el = document.getElementById('enc-filters');
  if (!el) return;
  const pool = _encPool();
  el.innerHTML = filterBarHtml('enc', getFilter('enc'), typesIn(pool),
    { hasCustom: pool.some(m => m._isCustom), hasBook: pool.some(m => m.source?.title) });
}

/** The monsters changed (a book's arrived): the filter bar and the list, never the search box. */
export function refreshEncounterMonsters() { _renderEncFilters(); filterMonsters(); }

/** Draws the list again; `q` is what was typed (omitted: keep the current search). Never redraws the search box. */
export function filterMonsters(q) {
  const list = document.getElementById('enc-monster-list');
  if (!list) return;
  if (q !== undefined) getFilter('enc').q = q || '';
  const found   = applyFilter(_encPool(), getFilter('enc'));
  const matches = found.slice(0, 40);
  if (!matches.length) { list.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px">No monsters found</div>'; return; }
  list.innerHTML = matches.map(m =>
    '<div class="monster-row" onclick="addMonsterToEncounter(\'' + m.id + '\')">' +
      '<span class="cr-badge">CR ' + m.cr + '</span>' +
      '<span style="font-size:11px;font-weight:600;flex:1">' + esc(m.name) + '</span>' +
      (m._isCustom
        ? '<span style="font-size:9px;color:var(--gold)">custom</span>'
        : m.source?.title ? '<span style="font-size:9px;color:var(--gold)" title="' + esc(m.source.title) + '">book</span>'
        : '<span style="font-size:9px;color:var(--muted)">' + esc(m.type) + '</span>'
      ) +
      '<span style="font-size:9px;color:var(--muted)">' + m.hp + 'hp</span>' +
    '</div>'
  ).join('') + moreLine(matches.length, found.length);
}

export function addMonsterToEncounter(monsterId) {
  let m;
  if (monsterId.startsWith('custom_')) {
    const customId = monsterId.slice(7);
    const actor    = (_state.dmCampaign?.customActors || {})[customId];
    if (!actor) return;
    m = { id: monsterId, name: actor.name, type: actor.type, cr: actor.cr,
          hp: actor.hp, ac: actor.ac, dex: actor.dex || 10, hp_dice: String(actor.hp) };
  } else {
    m = _state.srdMonsters.find(x => x.id === monsterId);
  }
  if (!m) return;
  const existing = encounterCreatures.find(e => e.monster.id === monsterId);
  if (existing) { existing.count++; } else { encounterCreatures.push({ monster: m, count: 1, lootItems: [] }); }
  _saveDraft();
  renderCreatureList();
  renderXPBudget();
}

function _renderLootPanel(idx) {
  const items = Object.values(_state.dmCampaign?.items || {});
  if (!items.length) {
    return '<div style="font-size:10px;color:var(--muted);padding:4px 0">No items in library — create items in the Items tab first.</div>';
  }
  const selected = new Map((encounterCreatures[idx].lootItems || []).map(li => [li.itemId, li.qty]));
  return items.map(it => {
    const qty     = selected.get(it.id) || 1;
    const checked = selected.has(it.id);
    return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0">' +
      '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="setLootItem(' + idx + ',\'' + it.id + '\',this.checked,parseInt(this.nextElementSibling.nextElementSibling.value)||1)">' +
      '<span style="flex:1;font-size:11px;color:var(--text)">' + esc(it.name) + '</span>' +
      '<input type="number" min="1" value="' + qty + '" style="width:36px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);text-align:center;font-size:10px;padding:1px" ' +
        'onchange="setLootItem(' + idx + ',\'' + it.id + '\',' + (checked ? 'true' : 'false') + ',parseInt(this.value)||1)">' +
    '</div>';
  }).join('');
}

export function toggleLootPanel(idx) {
  const el = document.getElementById('loot-panel-' + idx);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (!open) el.innerHTML = _renderLootPanel(idx);
}

export function setLootItem(idx, itemId, checked, qty) {
  const entry = encounterCreatures[idx];
  if (!entry) return;
  entry.lootItems = entry.lootItems || [];
  const existingIdx = entry.lootItems.findIndex(li => li.itemId === itemId);
  if (checked) {
    if (existingIdx >= 0) entry.lootItems[existingIdx].qty = qty;
    else entry.lootItems.push({ itemId, qty });
  } else {
    if (existingIdx >= 0) entry.lootItems.splice(existingIdx, 1);
  }
  _saveDraft();
}

function renderCreatureList() {
  const el = document.getElementById('enc-creature-list');
  if (!el) return;
  if (!encounterCreatures.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">Add monsters above to build encounter</div>';
    return;
  }
  el.innerHTML = encounterCreatures.map((e, i) =>
    '<div class="creature-entry">' +
      '<button class="qty-btn" onclick="changeCount(' + i + ',-1)">&#x2212;</button>' +
      '<span style="font-size:13px;font-weight:800;color:var(--gold);min-width:18px;text-align:center">' + e.count + '</span>' +
      '<button class="qty-btn" onclick="changeCount(' + i + ',1)">+</button>' +
      '<span style="font-size:11px;font-weight:600;flex:1">' + esc(e.monster.name) + '</span>' +
      '<span class="cr-badge">CR ' + e.monster.cr + '</span>' +
      '<button onclick="toggleLootPanel(' + i + ')" title="Assign loot" style="background:none;border:none;cursor:pointer;font-size:13px;padding:0 2px;color:' + (e.lootItems?.length ? 'var(--gold)' : 'var(--muted)') + '">&#x1F4B0;</button>' +
      '<button onclick="removeCreature(' + i + ')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0 2px">&#x2715;</button>' +
    '</div>' +
    '<div id="loot-panel-' + i + '" style="display:none;padding:6px 12px 10px;background:rgba(212,175,55,.05);border:1px solid rgba(212,175,55,.15);border-top:none;border-radius:0 0 6px 6px;margin-bottom:2px"></div>'
  ).join('');
}

function renderXPBudget() {
  const el = document.getElementById('enc-xp-budget');
  if (!el || !encounterCreatures.length) { if (el) el.innerHTML = ''; return; }
  const members = (_state.dmCampaign && _state.dmCampaign.members) || [];
  const chars = (_state.dmCampaign && _state.dmCampaign.characterSummaries) || {};
  const partyLevels = members.map(uid => chars[uid] && chars[uid].level ? chars[uid].level : 1);
  if (!partyLevels.length) { el.innerHTML = ''; return; }

  const thresholds = [0, 1, 2, 3].map(tier =>
    partyLevels.reduce((s, lv) => { const row = XP_THRESHOLDS[Math.min(lv, 20)]; return s + (row ? row[tier] || 0 : 0); }, 0)
  );
  // Difficulty is judged on XP adjusted for how many monsters there are: four goblins are a much harder
  // fight than one creature worth 200 XP (audit G4). The XP the party earns stays the plain total.
  const awardXP = encounterCreatures.reduce((s, e) => s + (CR_XP[e.monster.cr] || 0) * e.count, 0);
  const totalXP = adjustedEncounterXp(encounterCreatures.map(e => ({ xp: CR_XP[e.monster.cr] || 0, count: e.count })), partyLevels.length);
  const tier = totalXP >= thresholds[3] ? 3 : totalXP >= thresholds[2] ? 2 : totalXP >= thresholds[1] ? 1 : 0;
  const labels = ['Easy','Medium','Hard','Deadly'];
  const colors = ['#22c55e','#f59e0b','#f97316','#ef4444'];

  const zeroXPWarning = awardXP === 0
    ? '<div style="font-size:10px;color:var(--muted);margin-top:4px">⚠ No XP calculated — check that all monsters have a valid CR</div>'
    : '';

  let guidanceHtml = '';
  if (_targetDifficulty !== null && tier < _targetDifficulty) {
    const needed = thresholds[_targetDifficulty] - totalXP;
    guidanceHtml = '<div style="font-size:10px;color:' + colors[_targetDifficulty] + ';margin-top:4px">Need ' + needed.toLocaleString() + ' more XP to reach ' + labels[_targetDifficulty] + '</div>';
  } else if (_targetDifficulty !== null && tier > _targetDifficulty) {
    const excess = totalXP - thresholds[_targetDifficulty + 1] + 1;
    guidanceHtml = '<div style="font-size:10px;color:' + colors[_targetDifficulty] + ';margin-top:4px">Remove ' + excess.toLocaleString() + ' XP to reach ' + labels[_targetDifficulty] + '</div>';
  }

  el.innerHTML =
    '<div style="font-size:10px;color:var(--muted);margin-bottom:4px">' +
      'XP: <strong style="color:' + colors[tier] + '">' + awardXP.toLocaleString() + '</strong>' +
      (totalXP !== awardXP ? ' (counts as ' + totalXP.toLocaleString() + ' for ' + encounterCreatures.reduce((s, e) => s + e.count, 0) + ' foes)' : '') +
      ' \xb7 <strong style="color:' + colors[tier] + '">' + labels[tier] + '</strong>' +
      ' \xb7 ' + partyLevels.length + ' ' + (partyLevels.length === 1 ? 'player' : 'players') +
    '</div>' +
    '<div class="xp-bar">' +
      labels.map((l, i) => {
        const isCurrent = i === tier;
        const isTarget  = _targetDifficulty === i;
        let tileStyle = 'cursor:pointer;';
        if (isCurrent) tileStyle += 'border-color:' + colors[i] + ';';
        if (isTarget && !isCurrent) tileStyle += 'border-color:' + colors[i] + ';border-style:dashed;';
        return '<div class="xp-tier ' + (isCurrent ? 'current' : '') + '" style="' + tileStyle + '" onclick="setEncounterTargetDifficulty(' + i + ')">' +
          '<div style="font-size:8px;font-weight:700;color:' + colors[i] + '">' + l + '</div>' +
          '<div style="font-size:8px;color:var(--muted)">' + thresholds[i].toLocaleString() + '</div>' +
          (isTarget ? '<div style="font-size:7px;color:' + colors[i] + ';letter-spacing:.04em;margin-top:1px">★ target</div>' : '') +
        '</div>';
      }).join('') +
    '</div>' +
    zeroXPWarning +
    guidanceHtml;
}

export function changeCount(idx, delta) {
  encounterCreatures[idx].count = Math.max(1, encounterCreatures[idx].count + delta);
  _saveDraft();
  renderCreatureList(); renderXPBudget();
}
export function removeCreature(idx) { encounterCreatures.splice(idx, 1); _saveDraft(); renderCreatureList(); renderXPBudget(); }
export function clearEncounter() { encounterCreatures = []; _targetDifficulty = null; _preparedSpawn = null; _saveDraft(); renderCreatureList(); renderXPBudget(); }

/** Load a content pack's prepared encounter into the builder; its monsters will spawn on the pack's cells. */
export function loadPreparedEncounter(id) {
  const enc = _state.dmCampaign?.encounters?.[id];
  if (!enc) return;
  encounterCreatures = preparedToDraft(enc, _state.srdMonsters);
  _preparedSpawn = enc.spawn || null;
  _saveDraft(); renderCreatureList(); renderXPBudget();
}

export async function launchEncounter() {
  if (!encounterCreatures.length) { alert('Add monsters to the encounter first.'); return; }
  const btn = document.getElementById('btn-launch');
  if (btn) { btn.disabled = true; btn.textContent = '\u23f3 Launching\u2026'; }

  try {
    const order = [];
    const members = (_state.dmCampaign && _state.dmCampaign.members) || [];
    const chars = (_state.dmCampaign && _state.dmCampaign.characterSummaries) || {};

    const playersRoll = rule(_state.dmCampaign?.settings, 'playersRollInitiative');
    members.forEach(uid => {
      const c = chars[uid];
      if (!c) return;
      const initMod = abilityMod(c.dex || 10);
      order.push({ id: 'player_' + uid, name: c.name, roll: playersRoll ? null : rollDice(1, 20, initMod), initMod, type: 'player', userId: uid, hp: c.hp || 10, hpMax: c.hpMax || 10, ac: c.ac || 10, conditions: [] });
    });

    encounterCreatures.forEach(entry => {
      const m = entry.monster;
      const initMod = abilityMod(m.dex || 10);
      const srdM = _state.srdMonsters.find(x => x.id === m.id);
      const attacks = _parseAttacks(srdM);
      for (let i = 1; i <= entry.count; i++) {
        const parts = parseHPDice(m.hp_dice || String(m.hp));
        const hp = rollDice(parts[0], parts[1], parts[2]) || m.hp;
        order.push({
          id: genId(), name: m.name + (entry.count > 1 ? ' ' + i : ''),
          roll: rollDice(1, 20, initMod), initMod, type: 'monster', monsterId: m.id,
          xp: CR_XP[m.cr] || 0, // shared out when the fight ends (experience mode)
          hp, hpMax: hp, ac: m.ac || 10, conditions: [], attacks,
          speed: parseInt(String(m.speed?.walk ?? m.speed ?? '30')) || 30,
        });
      }
    });

    const initiative = startInitiative(order);
    _state.dmCampaign.initiative = initiative;
    _state.serverData.campaigns[_state.dmCampaignId].initiative = initiative;
    await saveHubDmCompanion(_state.serverData);
    setInitiativeState(initiative);
    const initPayload = { type: EV.INITIATIVE_UPDATE, campaignId: _state.dmCampaignId, initiative, fromUserId: _state.userId };
    // The Hub never heard the old plain realtimePublish (it reaches only dnd-master).
    await publishTo(['hub', 'player'], EV.INITIATIVE_UPDATE, initPayload);
    if (_onLaunch) _onLaunch();
    const lootByMonsterId = {};
    encounterCreatures.forEach(e => { lootByMonsterId[e.monster.id] = e.lootItems || []; });
    const spawnCells = _preparedSpawn;
    encounterCreatures = []; _targetDifficulty = null; _preparedSpawn = null; _saveDraft();
    if (_state.switchDMTab) _state.switchDMTab('initiative');

    // Auto-spawn monster tokens on the active map
    await _spawnMonsterTokens(order, _state.dmCampaignId, _state.userId, lootByMonsterId, spawnCells);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '\u2694\ufe0f Launch Encounter'; }
  }
}

// A read that fails (the node allows each user so many a minute) used to drop the fight's monsters without a word:
// the tracker had them, the map never did (rules playtest, 2026-10-04). Try again, then the sidebar's own copy.
async function _campaignWithMap(dmCampaignId) {
  for (let i = 0; i < 3; i++) {
    const d = await loadHubDmCompanion().catch(() => null);
    const c = d?.campaigns?.[dmCampaignId];
    if (c?.activeMapId && c.maps?.[c.activeMapId]) return d;
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  const own = _state.serverData;
  const c = own?.campaigns?.[dmCampaignId];
  return c?.activeMapId && c.maps?.[c.activeMapId] ? own : null;
}

async function _spawnMonsterTokens(order, dmCampaignId, userId, lootByMonsterId = {}, spawnCells = null) {
  try {
    const freshData = await _campaignWithMap(dmCampaignId);
    if (!freshData) {
      if (order.some(c => c.type === 'monster')) alert('The monsters could not be placed on the map (no map is open, or the server was busy). Open a map, then press the 🗺️ button in the tracker (Spawn monster tokens).');
      return;
    }
    const campaign = freshData.campaigns?.[dmCampaignId];
    const activeMapId = campaign?.activeMapId;

    const mapData = campaign.maps[activeMapId];
    const bgOffX = mapData.bgOffsetX ?? 0;
    const bgOffY = mapData.bgOffsetY ?? 0;
    const bgW    = mapData.bgScaledW ?? 0;
    const gs = (mapData.mapCellW && bgW > 0) ? bgW / mapData.mapCellW : (mapData.gridSize || 40);
    const oy = bgOffY + (mapData.gridOffsetY || 0);
    const spawnX = bgOffX + (bgW > 0 ? bgW + gs : gs * 15);
    mapData.tokens = mapData.tokens || {};

    // A prepared encounter's monsters stand on their cells in the room; others in the old column off the map.
    const pos = spawnPositions(order, spawnCells, mapData.gridSize || gs, null);
    const newTokens = [];
    let row = 0;
    for (const c of order) {
      if (c.type !== 'monster') continue;
      if (mapData.tokens[c.id]) continue;
      mapData.tokens[c.id] = {
        id: c.id, type: 'monster', name: c.name,
        x: pos[order.indexOf(c)]?.x ?? spawnX, y: pos[order.indexOf(c)]?.y ?? (oy + row * gs + gs / 2),
        hp: c.hp, hpMax: c.hpMax, ac: c.ac || 10,
        conditions: [], visible: true,
        monsterId: c.monsterId || null,
        attacks: c.attacks || [],
        speed: c.speed || 30,
        lootItems: (lootByMonsterId[c.monsterId] || []).map(li => ({ ...li, claimed: false })),
      };
      newTokens.push(mapData.tokens[c.id]);
      row++;
    }
    if (!newTokens.length) return;

    // The maps first (the DM's Hub keeps the map and saves it too), then the stored copy: a refused save no longer
    // keeps the monsters off every screen.
    const spawnPayload = { type: EV.TOKENS_SPAWN, campaignId: dmCampaignId, mapId: activeMapId, tokens: newTokens, fromUserId: userId };
    localPublish('dnd-hub', EV.TOKENS_SPAWN, spawnPayload);
    realtimePublishCompanion('dnd-hub', EV.TOKENS_SPAWN, publicPayload(EV.TOKENS_SPAWN, spawnPayload)); // hidden ones travel as stubs (lk-secrets.js)
    await saveHubDmCompanion(freshData);
  } catch (e) { console.warn('[dnd-master] placing the monsters', e); }
}

export async function removeMonsterTokensFromMap(monsterIds, dmCampaignId, userId) {
  try {
    const freshData = await loadHubDmCompanion();
    if (!freshData) return;
    const campaign = freshData.campaigns?.[dmCampaignId];
    const activeMapId = campaign?.activeMapId;
    if (!activeMapId || !campaign?.maps?.[activeMapId]) return;

    const mapData = campaign.maps[activeMapId];
    if (!mapData.tokens) return;
    const deleted = monsterIds.filter(id => mapData.tokens[id]);
    if (!deleted.length) return;
    deleted.forEach(id => { delete mapData.tokens[id]; });

    await saveHubDmCompanion(freshData);
    const payload = { type: EV.TOKENS_SPAWN, campaignId: dmCampaignId, mapId: activeMapId, tokens: [], deleted, fromUserId: userId };
    localPublish('dnd-hub', EV.TOKENS_SPAWN, payload);
    realtimePublishCompanion('dnd-hub', EV.TOKENS_SPAWN, payload);
  } catch { /* ignore */ }
}
