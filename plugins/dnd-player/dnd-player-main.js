// dnd-player-main.js — bootstrap: init, tab switching, event dispatch + dice roller
import { handleSDKMessage, getIdentity, storageGetCompanion, storageSetCompanion, realtimePublish, realtimePublishCompanion, localPublish, request } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js';
import { setSheetState, setInventoryImageUrls, renderAll, renderMain, renderDeathSaves,
  changeHP, updateTempHP, toggleCondition, toggleDeathSave, changeExhaustion,
  toggleInspiration, doShortRest, doLongRest, toggleEquipped,
  rollAbilityCheck, rollSkillCheck, debounceSaveNotes,
  toggleFeatureExpand, saveFeatureDesc,
  computeEffectiveStats, setPendingDamageIdx, clearPendingDamageIdx, toggleInventoryItem } from './dnd-player-sheet.js';
import { setSpellState, loadSRDSpells, renderSpells, toggleSpellExpand, expendSpellSlot,
         castSpell, setConcentration, clearConcentration } from './dnd-player-spells.js';
import { renderCombat, clearActionEconomy, toggleAction, setInitiativeData, setCombatCharData } from './dnd-player-combat.js';
import { setResourceState, renderResources, toggleResourcePip,
         restoreResourcesOnShortRest, restoreResourcesOnLongRest } from './dnd-player-resources.js';
import { startLevelUp as _startLevelUp, levelUpBack, levelUpNext, closeLevelUp,
         levelUpRollHP, levelUpTakeAverage, levelUpToggleSpell,
         levelUpASIMode, levelUpFeat } from './dnd-player-levelup.js';
import { loadHubDmCompanion, saveHubDmCompanion } from '../dnd-hub-shared-storage.js';

let CHAR = null;
let CAMPAIGN_ID = null;
let USER_ID = null;
let SERVER_DATA = null;
let _lastCampaignId = null;
let selectedDie = 'd20';
let rollAdvMode = null;
let _pendingPhysicsRollTs = null;   // ts of in-flight physics roll request
let _pendingPhysicsRollTimer = null; // fallback timeout handle
let _initiativeActive = false;
let _pendingWeaponAttack = null;  // { item, weaponEffect, equipIdx } during to-hit roll
let _pendingWeaponDamage = null;  // { item, weaponEffect, toHitRoll, toHitMod, toHitTotal } during damage roll
let _pendingHealItem = null;      // { item, idx } during healing roll

function _resolveItemFromLibrary(itemId) {
  const camp = SERVER_DATA?.campaigns?.[CAMPAIGN_ID];
  return camp?.items?.[itemId] || null;
}

function _addItemToChar(item, qty, goldCost) {
  const entry = {
    id: item.id, name: item.name, type: item.type,
    description: item.description || '',
    effects: item.effects || [],
    imageFileId: item.imageFileId || null,
    qty: qty || 1, equipped: false, attuned: false,
  };
  if (item.type === 'consumable') {
    if (!CHAR.consumables) CHAR.consumables = [];
    const existing = CHAR.consumables.find(c => c.id === item.id);
    if (existing) existing.qty = (existing.qty || 1) + (qty || 1);
    else CHAR.consumables.push(entry);
  } else {
    if (!CHAR.equipment) CHAR.equipment = [];
    CHAR.equipment.push(entry);
  }
  if (goldCost > 0) CHAR.gold = Math.max(0, (CHAR.gold || 0) - goldCost);
}

async function _resolveInventoryImages() {
  const allItems = [
    ...(CHAR?.equipment || []),
    ...((CHAR?.consumables || [])),
  ];
  const urls = { ..._shopImageUrls };
  await Promise.all(allItems.map(async item => {
    if (item.imageFileId && !urls[item.id] && !urls[item.imageFileId]) {
      try {
        const r = await request('files:getUrl', { fileId: item.imageFileId });
        if (r?.url) { urls[item.id] = r.url; urls[item.imageFileId] = r.url; }
      } catch { /* no image */ }
    }
  }));
  setInventoryImageUrls(urls);
}

function _char_items() {
  return (CHAR?.equipment || []).filter(it => it.type !== 'consumable');
}

// Handout queue — received handouts stack while one is being read
const _handoutQueue = [];
let _handoutOpen = false;
// Active broadcast audio element
let _broadcastAudio = null;
// Phase 7 — Audio zones
let _audioZones = [];
let _myTokenPos  = null;  // { x, y } in world coords (from token:move events)
const _zoneAudioEls = {};  // zoneId → Audio element

// Phase 3 — Shop tab
let _activeShopId    = null;
let _activeShopData  = null;
let _activeShopItems = null;
let _shopImageUrls   = {};
const _expandedShopSlots = new Set();

async function saveChar() {
  CHAR.updatedAt = new Date().toISOString();
  const userData = await storageGetCompanion('dnd-hub', 'characters', 'user') || {};
  userData[CAMPAIGN_ID] = CHAR;
  await storageSetCompanion('dnd-hub', 'characters', 'user', userData);
  // Mirror to server scope so the DM can read and edit this sheet
  if (USER_ID && CAMPAIGN_ID) {
    await storageSetCompanion('dnd-hub', `player_sheet_${CAMPAIGN_ID}_${USER_ID}`, 'server', CHAR);
  }
}

function renderConcentration() {
  const el = document.getElementById('concentration-banner');
  if (!el) return;
  if (CHAR?.concentration) {
    el.style.display = 'flex';
    el.innerHTML =
      `<span style="flex:1">⚡ Concentrating: <strong>${CHAR.concentration.spellName}</strong>` +
      ` <span style="font-size:10px;color:var(--muted)">(${CHAR.concentration.duration})</span></span>` +
      `<button onclick="clearConcentration()" style="padding:2px 8px;background:rgba(248,113,113,.15);` +
      `border:1px solid rgba(248,113,113,.4);border-radius:4px;color:#f87171;font-size:10px;cursor:pointer">Drop</button>`;
  } else {
    el.style.display = 'none';
  }
}
window.renderConcentration = renderConcentration;

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const names = ['main','combat','abilities','spells','inventory','features','notes','resources'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById('tab-' + name);
  if (pane) pane.classList.add('active');
  if (name === 'combat') renderCombat(_initiativeActive);
  if (name === 'spells') loadSRDSpells().then(() => renderSpells());
  if (name === 'resources') renderResources();
  if (name === 'main') renderConcentration();
}

function selectDie(die) {
  selectedDie = die;
  document.querySelectorAll('.die-btn[id^="die-"]').forEach(b => b.classList.toggle('active', b.id === 'die-' + die));
}

function toggleAdv(mode) {
  rollAdvMode = rollAdvMode === mode ? null : mode;
  document.getElementById('adv-btn').classList.toggle('active', rollAdvMode === 'adv');
  document.getElementById('dis-btn').classList.toggle('active', rollAdvMode === 'dis');
}

function setDiceRollLabel(label, forceMod) {
  selectedDie = 'd20'; selectDie('d20');
  document.getElementById('dice-count').value = 1;
  if (forceMod !== undefined) document.getElementById('dice-mod').value = forceMod;
  document.getElementById('roll-label').textContent = label;
}

async function rollDice() {
  const sides  = parseInt(selectedDie.replace('d', ''), 10);
  const count  = Math.max(1, parseInt(document.getElementById('dice-count').value, 10) || 1);
  const mod    = parseInt(document.getElementById('dice-mod').value, 10) || 0;
  const label  = document.getElementById('roll-label').textContent || selectedDie;
  const expression = `${count}${selectedDie}${mod >= 0 ? '+' : ''}${mod}`;
  const ts     = Date.now();
  const advMode = (rollAdvMode && selectedDie === 'd20' && count === 1) ? rollAdvMode : null;

  // Show rolling state while physics runs
  document.getElementById('roll-result').textContent = '…';
  document.getElementById('roll-breakdown').textContent = '';

  // Ask dnd-hub to run a genuine physics roll and broadcast the result
  _pendingPhysicsRollTs = ts;
  localPublish('dnd-hub', EV.DICE_PHYSICS_ROLL, {
    type: EV.DICE_PHYSICS_ROLL, sides, count, mod, label, expression,
    advMode, userId: USER_ID, ts,
  });

  // Fallback: if hub doesn't respond within 8 s (e.g. map not open), compute locally
  clearTimeout(_pendingPhysicsRollTimer);
  _pendingPhysicsRollTimer = setTimeout(() => {
    if (_pendingPhysicsRollTs !== ts) return;
    _pendingPhysicsRollTs = null;
    let rolls;
    if (advMode) {
      const r1 = Math.ceil(Math.random() * sides), r2 = Math.ceil(Math.random() * sides);
      const chosen = advMode === 'adv' ? Math.max(r1, r2) : Math.min(r1, r2);
      rolls = [chosen];
    } else {
      rolls = Array.from({ length: count }, () => Math.ceil(Math.random() * sides));
    }
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    _applyRollResult({ result: total, rolls, advMode, expression, label, ts, userId: USER_ID });
    const payload = { type: EV.DICE_ROLL, userId: USER_ID, expression, result: total, rolls, label, ts };
    realtimePublish(EV.DICE_ROLL, payload);
    localPublish('dnd-hub', EV.DICE_ROLL, payload);
  }, 8000);
}

function _applyRollResult(p) {
  const mod    = parseInt(p.expression?.match(/([+-]\d+)$/)?.[1] || '0', 10);
  const sides  = parseInt(p.expression?.match(/d(\d+)/)?.[1] || '20', 10);
  const rolls  = p.rolls || [p.result - mod];
  const total  = p.result;
  const adv    = p.advMode;

  if (adv) {
    const [r1, r2] = rolls.length >= 2 ? rolls : [rolls[0], rolls[0]];
    document.getElementById('roll-breakdown').textContent =
      `[${r1},${r2}] ${adv === 'adv' ? 'adv' : 'dis'} ${mod >= 0 ? '+' : ''}${mod}`;
  } else {
    document.getElementById('roll-breakdown').textContent =
      `[${rolls.join(',')}]${mod !== 0 ? (mod > 0 ? ' +' + mod : ' ' + mod) : ''}`;
  }
  const usedRoll = adv
    ? (adv === 'adv' ? Math.max(...(rolls.length >= 2 ? rolls : [rolls[0]])) : Math.min(...(rolls.length >= 2 ? rolls : [rolls[0]])))
    : rolls[0];

  document.getElementById('roll-result').textContent = total;
  document.getElementById('roll-result').style.color =
    (total === 20 && sides === 20 && usedRoll === 20) ? '#4ade80' :
    (total <= 1 + (mod < 0 ? -mod : 0) && sides === 20) ? '#f87171' : 'var(--dnd-gold)';
}

function showHandout(data) {
  _handoutQueue.push(data);
  if (!_handoutOpen) _nextHandout();
}

function _nextHandout() {
  if (_handoutQueue.length === 0) { _handoutOpen = false; return; }
  _handoutOpen = true;
  const { title, content } = _handoutQueue.shift();
  document.getElementById('player-handout-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'player-handout-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,sans-serif';
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  overlay.innerHTML =
    '<div style="background:#1a1610;border:1px solid rgba(212,175,55,.4);border-radius:10px;padding:20px;max-width:340px;width:90%;max-height:75vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,.8)">' +
      '<div style="font-size:13px;font-weight:800;color:#d4af37;margin-bottom:10px;border-bottom:1px solid rgba(212,175,55,.25);padding-bottom:8px">\uD83D\uDCDC ' + esc(title) + '</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.85);line-height:1.6;white-space:pre-wrap">' + esc(content) + '</div>' +
      '<button style="margin-top:14px;width:100%;padding:8px;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.3);border-radius:6px;color:#d4af37;font-size:11px;font-weight:700;cursor:pointer" id="handout-dismiss-btn">Dismiss' +
        (_handoutQueue.length > 0 ? ' (' + _handoutQueue.length + ' more)' : '') + '</button>' +
    '</div>';
  document.body.appendChild(overlay);
  document.getElementById('handout-dismiss-btn').onclick = () => {
    overlay.remove();
    _handoutOpen = false;
    _nextHandout();
  };
}

async function handleAudioPlay(p) {
  // Defer until the user has interacted with the page (browser autoplay gate).
  if (!_audioUnlocked) {
    _audioQueue.push(() => handleAudioPlay(p));
    return;
  }
  if (_broadcastAudio) { _broadcastAudio.pause(); _broadcastAudio.src = ''; _broadcastAudio = null; }
  if (!p.fileId) return;
  try {
    const res = await request('files:getUrl', { fileId: p.fileId });
    if (!res?.url) return;
    _broadcastAudio = new Audio(res.url);
    _broadcastAudio.loop    = !!p.loop;
    _broadcastAudio.volume  = Math.min(1, Math.max(0, p.volume ?? 0.7));
    _broadcastAudio.crossOrigin = 'anonymous';
    _broadcastAudio.play().catch(() => {});
  } catch { /* autoplay blocked or fetch failed */ }
}

// Phase 7 — recompute ambient audio zone volumes based on own token position
async function recomputeZoneVolumes() {
  for (const zone of _audioZones) {
    if (!zone.fileId) continue;
    let vol = 0;
    if (_myTokenPos) {
      const dx   = _myTokenPos.x - zone.x;
      const dy   = _myTokenPos.y - zone.y;
      const dist = Math.hypot(dx, dy);
      vol = dist >= zone.radius ? 0 : Math.max(0, (zone.maxVolume || 1) * (1 - dist / zone.radius));
    }
    if (!_zoneAudioEls[zone.id]) {
      try {
        const res = await request('files:getUrl', { fileId: zone.fileId });
        if (!res?.url) continue;
        const audio = new Audio(res.url);
        audio.loop   = zone.loop !== false;
        audio.volume = 0;
        audio.crossOrigin = 'anonymous';
        audio.play().catch(() => {});
        _zoneAudioEls[zone.id] = audio;
      } catch { continue; }
    }
    _zoneAudioEls[zone.id].volume = Math.min(1, Math.max(0, vol));
    if (vol > 0 && _zoneAudioEls[zone.id].paused) {
      _zoneAudioEls[zone.id].play().catch(() => {});
    }
  }
  const activeIds = new Set(_audioZones.map(z => z.id));
  for (const id of Object.keys(_zoneAudioEls)) {
    if (!activeIds.has(id)) {
      _zoneAudioEls[id].pause();
      _zoneAudioEls[id].src = '';
      delete _zoneAudioEls[id];
    }
  }
}

function _showPlayerToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid #6366f1;color:#a5b4fc;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function initDiceBar() {
  document.getElementById('dice-bar').innerHTML = `
    <div class="dice-row">
      <span style="font-size:10px;color:var(--muted);margin-right:2px">Die:</span>
      <div class="die-btn" id="die-d4" onclick="selectDie('d4')">d4</div>
      <div class="die-btn" id="die-d6" onclick="selectDie('d6')">d6</div>
      <div class="die-btn" id="die-d8" onclick="selectDie('d8')">d8</div>
      <div class="die-btn" id="die-d10" onclick="selectDie('d10')">d10</div>
      <div class="die-btn" id="die-d12" onclick="selectDie('d12')">d12</div>
      <div class="die-btn active" id="die-d20" onclick="selectDie('d20')">d20</div>
      <div class="die-btn" id="die-d100" onclick="selectDie('d100')">d100</div>
    </div>
    <div class="dice-row">
      <span style="font-size:10px;color:var(--muted)">×</span>
      <input type="number" id="dice-count" value="1" min="1" max="20"
        style="width:36px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:4px 6px;color:var(--text);font-size:12px;outline:none;text-align:center">
      <span style="font-size:10px;color:var(--muted)">Mod</span>
      <input type="number" id="dice-mod" value="0"
        style="width:44px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:4px 6px;color:var(--text);font-size:12px;outline:none;text-align:center">
      <div style="display:flex;gap:4px;margin-left:4px">
        <div class="die-btn" id="adv-btn" onclick="toggleAdv('adv')" style="font-size:9px;padding:3px 6px">ADV</div>
        <div class="die-btn" id="dis-btn" onclick="toggleAdv('dis')" style="font-size:9px;padding:3px 6px">DIS</div>
      </div>
      <button class="btn btn-gold btn-sm" style="margin-left:auto;min-width:48px" onclick="rollDice()">Roll</button>
    </div>
    <div class="dice-row" style="justify-content:space-between;min-height:22px">
      <span id="roll-label" style="font-size:10px;color:var(--muted)"></span>
      <div style="text-align:right">
        <div class="roll-result" id="roll-result"></div>
        <div class="roll-label" id="roll-breakdown"></div>
      </div>
    </div>`;
}

initDiceBar();

function initTabHTML() {
  document.getElementById('tab-main').innerHTML = `
    <div id="concentration-banner" style="display:none;align-items:center;gap:8px;
      padding:8px 10px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.35);
      border-radius:8px;margin-bottom:12px;font-size:11px;color:var(--dnd-gold)"></div>
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:11px;font-weight:700;color:var(--dnd-gold)">HIT POINTS</span>
        <span style="font-size:11px;color:var(--muted)"><span id="hp-cur">—</span>/<span id="hp-max">—</span></span>
      </div>
      <div class="hp-bar-wrap"><div class="hp-bar" id="hp-bar" style="width:100%;background:#22c55e"></div></div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input type="number" id="hp-delta" placeholder="Amount" min="1"
          style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:13px;outline:none">
        <button class="btn btn-ghost btn-sm" onclick="changeHP(-1)">– Damage</button>
        <button class="btn btn-primary btn-sm" onclick="changeHP(1)">+ Heal</button>
      </div>
      <div style="margin-top:6px;display:flex;gap:6px;align-items:center">
        <span style="font-size:10px;color:var(--muted)">Temp HP:</span>
        <input type="number" id="temp-hp" min="0" value="0" onchange="updateTempHP(this.value)"
          style="width:60px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:12px;outline:none">
      </div>
    </div>
    <div class="stat-row">
      <div class="stat-chip"><div class="stat-chip-value" id="stat-ac">—</div><div class="stat-chip-label">AC</div></div>
      <div class="stat-chip"><div class="stat-chip-value" id="stat-init">—</div><div class="stat-chip-label">Initiative</div></div>
      <div class="stat-chip"><div class="stat-chip-value" id="stat-speed">—</div><div class="stat-chip-label">Speed</div></div>
      <div class="stat-chip" style="cursor:pointer" onclick="toggleInspiration()">
        <div class="stat-chip-value" id="stat-insp">☆</div><div class="stat-chip-label">Inspiration</div>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">CONDITIONS</div>
      <div class="condition-grid" id="conditions-grid"></div>
    </div>
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">EXHAUSTION · Level <span id="exhaustion-level">0</span>/6</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="changeExhaustion(-1)">−</button>
        <button class="btn btn-ghost btn-sm" onclick="changeExhaustion(1)">+</button>
      </div>
    </div>
    <div id="death-saves-section" style="margin-bottom:14px;display:none">
      <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">DEATH SAVING THROWS</div>
      <div style="display:flex;gap:20px">
        <div><div style="font-size:9px;color:#4ade80;margin-bottom:4px">SUCCESSES</div><div class="save-pips" id="death-success-pips"></div></div>
        <div><div style="font-size:9px;color:#f87171;margin-bottom:4px">FAILURES</div><div class="save-pips" id="death-failure-pips"></div></div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" style="flex:1" onclick="doShortRest()">🌙 Short Rest</button>
      <button class="btn btn-ghost" style="flex:1" onclick="doLongRest()">☀️ Long Rest</button>
    </div>
    <div id="xp-bar-section" style="margin-top:8px"></div>
    <div id="levelup-banner" style="display:none;margin-top:8px;padding:10px 14px;
      background:rgba(212,175,55,.15);border:1px solid rgba(212,175,55,.5);border-radius:8px;
      text-align:center;cursor:pointer;font-size:12px;font-weight:700;color:#d4af37"
      onclick="startLevelUp()">⬆ Level Up! Click to begin →</div>`;
  document.getElementById('tab-abilities').innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:10px">ABILITY SCORES</div>
    <div class="ability-grid" id="ability-grid"></div>
    <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">SAVING THROWS</div>
    <div id="saving-throws" style="margin-bottom:14px"></div>
    <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">SKILLS</div>
    <div id="skills-list"></div>`;
  document.getElementById('tab-spells').innerHTML = `
    <div style="margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">SPELL SLOTS</div>
      <div id="spell-slots-grid" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"></div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">CANTRIPS</div>
    <div id="cantrips-list" style="margin-bottom:12px"></div>
    <div id="spells-by-level"></div>`;
  document.getElementById('tab-inventory').innerHTML = `
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--dnd-gold)">EQUIPMENT</span>
        <span style="font-size:10px;color:var(--muted)" id="carry-weight"></span>
      </div>
      <div id="equipment-list" style="display:flex;flex-direction:column;gap:4px"></div>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">CURRENCY</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px" id="currency-grid"></div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">ATTUNEMENT · <span id="attunement-count">0</span>/3 slots</div>`;
  document.getElementById('tab-features').innerHTML = `
    <div id="features-list" style="display:flex;flex-direction:column;gap:6px"></div>`;
  document.getElementById('tab-notes').innerHTML = `
    <textarea id="notes-area" placeholder="Your private notes…" oninput="debounceSaveNotes()"
      style="width:100%;height:100%;min-height:300px;background:transparent;border:none;
      color:var(--text);font-size:12px;line-height:1.6;outline:none;resize:none;font-family:inherit"></textarea>`;
}

async function onInit(data) {
  const identity = await getIdentity();
  USER_ID = identity?.id ?? null;
  SERVER_DATA = await loadHubDmCompanion() || { campaigns: {} };
  const storedCampaignId = await storageGetCompanion('dnd-hub', 'activePlayerCampaignId', 'user');
  const campaigns = Object.values(SERVER_DATA.campaigns || {});
  let myCampaign = storedCampaignId
    ? campaigns.find(c => c.id === storedCampaignId && ((c.members||[]).includes(USER_ID) || c.dmUserId === USER_ID))
    : null;
  if (!myCampaign) myCampaign = campaigns.find(c => (c.members||[]).includes(USER_ID) || c.dmUserId === USER_ID);
  CAMPAIGN_ID = myCampaign?.id ?? null;
  if (!CAMPAIGN_ID) { document.getElementById('loading').innerHTML = '<span>Join a campaign via the D&D Hub to use this sidebar.</span>'; return; }
  // Load the sheet BEFORE deciding whether this is a DM-only session. Having a
  // character in the campaign is what proves you are playing it; membership does not.
  const userData = await storageGetCompanion('dnd-hub', 'characters', 'user') || {};
  CHAR = userData[CAMPAIGN_ID] ?? null;
  if (!CHAR && USER_ID && CAMPAIGN_ID) {
    // Fallback: saveChar always mirrors to server-scoped player_sheet_* — try that if user-scoped
    // characters entry is missing (e.g. after device-storage migration overwrote server data).
    const mirror = await storageGetCompanion('dnd-hub', `player_sheet_${CAMPAIGN_ID}_${USER_ID}`, 'server') ?? null;
    if (mirror) {
      CHAR = mirror;
      // Heal the missing entry so future loads work without hitting this path.
      userData[CAMPAIGN_ID] = CHAR;
      storageSetCompanion('dnd-hub', 'characters', 'user', userData).catch(() => {});
    }
  }

  // Hide the player sheet from a DM who is only running the game — they use the
  // D&D Master sidebar instead.
  //
  // ⚠️ `members` alone is NOT a sufficient test, and testing it alone was a bug:
  // nothing ever adds a DM to `campaign.members`. dnd-hub's requestJoin() is the
  // only writer of that array, and its candidate list excludes campaigns where
  // `dmUserId === userId`, so the "join" path a DM would need does not exist.
  // Character creation writes `characterSummaries[userId]` but never `members`.
  // So a DM who built a character and clicked their own campaign in "My Campaigns"
  // (enterCampaignAsPlayer) hit isDMOnly === true and this sidebar hid itself
  // permanently — PluginRuntime treats a role-mismatch hide as final until remount.
  // The gate the original gesture wanted is "is this person actually playing",
  // and owning a character in the campaign answers that for DM and player alike.
  const isDMOnly = myCampaign.dmUserId === USER_ID
    && !(myCampaign.members || []).includes(USER_ID)
    && !CHAR;
  if (isDMOnly) { parent.postMessage({ type: 'dissent:slot-action', action: 'hide' }, '*'); return; }

  if (!CHAR) {
    document.getElementById('loading').innerHTML =
      '<div style="text-align:center;padding:16px">' +
      '<span>Create your character in the D&D Hub channel first.</span><br><br>' +
      '<button onclick="window._retryPlayerInit()" style="padding:6px 14px;border-radius:6px;border:none;background:var(--primary,#7c3aed);color:#fff;cursor:pointer;font-size:13px">↺ Refresh</button>' +
      '</div>';
    window._retryPlayerInit = () => onInit({});
    return;
  }
  _lastCampaignId = CAMPAIGN_ID;
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Claim any pending rewards (offline delivery fallback)
  const pendingRewards = (SERVER_DATA?.campaigns?.[CAMPAIGN_ID]?.pendingRewards?.[USER_ID] || []);
  if (pendingRewards.length) {
    SERVER_DATA.campaigns[CAMPAIGN_ID].pendingRewards[USER_ID] = [];
    await saveHubDmCompanion(SERVER_DATA);
    for (const reward of pendingRewards) {
      const item = _resolveItemFromLibrary(reward.itemId);
      if (!item) continue;
      _addItemToChar(item, reward.qty || 1, reward.goldCost || 0);
    }
    await saveChar();
    _resolveInventoryImages().then(() => renderAll()).catch(() => {});
  }

  window.CHAR = CHAR; window.saveChar = saveChar;
  setCombatCharData(CHAR);
  initTabHTML();
  setSheetState(CHAR, saveChar, USER_ID, setDiceRollLabel, rollDice, CAMPAIGN_ID);
  setSpellState(CHAR, saveChar);
  setResourceState(CHAR, saveChar);
  // Ensure the DM can always see this player's sheet by syncing to server-scope storage on load.
  saveChar().catch(() => {});
  renderAll();
  renderConcentration();
  loadSRDSpells();
  _resolveInventoryImages().then(() => renderAll()).catch(() => {});

  // Phase 7 — load initial audio zones from DM companion storage
  const hubDm = await loadHubDmCompanion() || {};
  const activeCampaign = (hubDm.campaigns || {})[CAMPAIGN_ID];
  const activeMapId = activeCampaign?.activeMapId;
  if (activeMapId) {
    _audioZones = activeCampaign?.maps?.[activeMapId]?.audioZones || [];
    if (_audioZones.length) recomputeZoneVolumes().catch(() => {});
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !USER_ID) return;
  const storedId = await storageGetCompanion('dnd-hub', 'activePlayerCampaignId', 'user');
  if (storedId && storedId !== _lastCampaignId && storedId !== CAMPAIGN_ID) onInit({});
});

async function _openShopTab(shopId) {
  // Read the DM's authoritative catalog first — the hub can't overwrite this namespace.
  // Fall back to hub-dm for backwards compatibility with sessions before dm-catalog was written.
  const dmCatalog = await storageGetCompanion('dnd-master', 'dm-catalog');
  const dmCamp    = dmCatalog?.campaigns?.[CAMPAIGN_ID];

  SERVER_DATA = await loadHubDmCompanion() || SERVER_DATA || { campaigns: {} };
  const hubCamp = SERVER_DATA?.campaigns?.[CAMPAIGN_ID];

  // Prefer dm-catalog for items and shops; fall back to hub-dm
  const itemLib = dmCamp?.items || hubCamp?.items || {};
  const shopDef = dmCamp?.shops?.[shopId] || hubCamp?.shops?.[shopId];
  if (!shopDef) return;

  const shopItems = (shopDef.items || []).map((si, idx) => {
    const item = itemLib[si.itemId];
    return item ? { ...item, price: si.price, slotId: si.slotId || (si.itemId + '_' + idx) } : null;
  }).filter(Boolean);

  await Promise.all(shopItems.map(async it => {
    if (it.imageFileId && !_shopImageUrls[it.id]) {
      try {
        const r = await request('files:getUrl', { fileId: it.imageFileId });
        if (r?.url) _shopImageUrls[it.id] = r.url;
      } catch { /* no image */ }
    }
  }));

  _activeShopId    = shopId;
  _activeShopData  = { shop: shopDef, shopItems };
  _activeShopItems = shopItems;

  // Insert shop tab button if not already present
  const firstTab = document.querySelector('.tab');
  if (firstTab && !document.getElementById('tab-btn-shop')) {
    const btn = document.createElement('div');
    btn.id = 'tab-btn-shop';
    btn.className = 'tab';
    btn.textContent = '🏪 Shop';
    btn.onclick = () => _switchToShopTab();
    firstTab.parentElement.appendChild(btn);
  }

  if (!document.getElementById('tab-shop')) {
    const div = document.createElement('div');
    div.id = 'tab-shop';
    div.className = 'tab-pane';
    (document.querySelector('.tab-content') || document.getElementById('app')).appendChild(div);
  }

  _renderShopTab(shopItems);
  _switchToShopTab();
}

function _switchToShopTab() {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const panel = document.getElementById('tab-shop');
  const btn   = document.getElementById('tab-btn-shop');
  if (panel) panel.classList.add('active');
  if (btn)   btn.classList.add('active');
}

function _renderShopTab(shopItems) {
  const el = document.getElementById('tab-shop');
  if (!el) return;
  const gold = CHAR?.gold || 0;
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const itemCards = shopItems.length === 0
    ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:16px">This shop has no items.</div>'
    : shopItems.map(it => {
        const slotKey  = it.slotId || it.id;
        const expanded = _expandedShopSlots.has(slotKey);
        const canAfford = gold >= it.price;
        const imgSize = expanded ? '80px' : '48px';
        const imgHtml = _shopImageUrls[it.id]
          ? '<img src="' + _shopImageUrls[it.id] + '" style="width:' + imgSize + ';height:' + imgSize + ';object-fit:cover;border-radius:6px;flex-shrink:0;transition:width .15s,height .15s">'
          : '<div style="width:' + imgSize + ';height:' + imgSize + ';border-radius:6px;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:' + (expanded?'34':'22') + 'px;flex-shrink:0">📦</div>';

        const expandedSection = expanded ? (
          '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' +
            (it.description
              ? '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;line-height:1.4">' + esc(it.description) + '</div>'
              : '') +
            (it.effects
              ? '<div style="font-size:10px;color:var(--dnd-gold);margin-bottom:8px">✦ ' + esc(it.effects) + '</div>'
              : '') +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
              '<span style="font-size:12px;font-weight:700;color:var(--dnd-gold)">' + it.price + ' gp</span>' +
              (!canAfford
                ? '<span style="font-size:9px;color:#f97316">⚠ only ' + gold + ' gp</span>'
                : '') +
              '<button data-itemid="' + esc(it.id) + '" data-itemname="' + esc(it.name) + '" data-price="' + it.price + '" data-slotid="' + esc(slotKey) + '" class="shop-interest-btn" ' +
                'style="padding:4px 12px;border-radius:6px;border:1px solid rgba(212,175,55,.4);background:rgba(212,175,55,.1);color:var(--dnd-gold);cursor:pointer;font-size:10px;font-weight:700">Declare Interest</button>' +
            '</div>' +
          '</div>'
        ) : '';

        return '<div data-slotkey="' + esc(slotKey) + '" class="shop-item-card" ' +
          'style="padding:10px;background:var(--surface);border:1px solid ' + (expanded ? 'rgba(212,175,55,.5)' : 'var(--border)') + ';border-radius:8px;margin-bottom:8px;cursor:pointer">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            imgHtml +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:12px;font-weight:600;color:var(--text)">' + esc(it.name) + '</div>' +
              '<div style="font-size:10px;color:var(--muted)">' + esc(it.type) + '</div>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0">' +
              (!expanded ? '<span style="font-size:12px;font-weight:700;color:var(--dnd-gold)">' + it.price + ' gp</span>' : '') +
              '<span style="font-size:10px;color:var(--muted)">' + (expanded ? '▲' : '▼') + '</span>' +
            '</div>' +
          '</div>' +
          expandedSection +
        '</div>';
      }).join('');

  el.innerHTML =
    '<div style="padding:12px 16px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:12px;letter-spacing:.05em">' +
        '🏪 ' + esc(_activeShopData?.shop?.name || 'Shop') +
      '</div>' +
      itemCards +
    '</div>';

  el.querySelectorAll('.shop-item-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('shop-interest-btn') || e.target.closest('.shop-interest-btn')) return;
      const key = card.dataset.slotkey;
      if (_expandedShopSlots.has(key)) _expandedShopSlots.delete(key);
      else _expandedShopSlots.add(key);
      _renderShopTab(_activeShopItems || shopItems);
    });
  });

  el.querySelectorAll('.shop-interest-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const itemId   = btn.dataset.itemid;
      const itemName = btn.dataset.itemname;
      const slotId   = btn.dataset.slotid || itemId;
      const price    = parseInt(btn.dataset.price) || 0;
      btn.textContent = '✓ Interested';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      const contestKey = 'shop_' + _activeShopId + '_' + slotId;
      const payload = {
        type: 'loot:interest',
        contestKey,
        tokenId: null, shopId: _activeShopId,
        itemId, itemName,
        price, source: 'shop',
        userId: USER_ID,
        displayName: CHAR?.name || USER_ID,
        campaignId: CAMPAIGN_ID, fromUserId: USER_ID,
      };
      realtimePublish('loot:interest', payload);
      realtimePublishCompanion('dnd-master', 'loot:interest', payload);
    });
  });
}

function _closeShopTab() {
  _activeShopId    = null;
  _activeShopData  = null;
  _activeShopItems = null;
  _shopImageUrls   = {};
  _expandedShopSlots.clear();
  const btn   = document.getElementById('tab-btn-shop');
  const panel = document.getElementById('tab-shop');
  if (btn)   btn.remove();
  if (panel) panel.remove();
  // Switch back to main tab
  switchTab('main');
}

function parseDiceExpr(expr) {
  if (!expr) return null;
  const m = expr.trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  return {
    count: m[1] ? parseInt(m[1]) : 1,
    sides: parseInt(m[2]),
    mod: m[3] ? parseInt(m[3]) : 0,
  };
}

function parseToHitMod(toHit) {
  if (!toHit) return 0;
  return parseInt(toHit) || 0;
}

function weaponAttack(equipIdx) {
  const item = (CHAR?.equipment || [])[equipIdx];
  if (!item) return;
  const weaponEffect = (item.effects || []).find(e => e.type === 'weapon');
  if (!weaponEffect) return;

  const toHitMod = parseToHitMod(weaponEffect.toHit);
  _pendingWeaponAttack = { item, weaponEffect, equipIdx };

  setDiceRollLabel(`${item.name} — Attack`, toHitMod);
  rollDice();
}

function weaponRollDamage() {
  if (!_pendingWeaponDamage) return;
  const { item, weaponEffect } = _pendingWeaponDamage;
  const parsed = parseDiceExpr(weaponEffect.damage);
  if (!parsed) return;

  selectedDie = 'd' + parsed.sides;
  selectDie('d' + parsed.sides);
  document.getElementById('dice-count').value = parsed.count;
  document.getElementById('dice-mod').value = parsed.mod;
  document.getElementById('roll-label').textContent = `${item.name} — Damage (${weaponEffect.damageType})`;
  rollDice();
}

function removeInventoryItem(idx) {
  if (!CHAR?.equipment) return;
  CHAR.equipment.splice(idx, 1);
  saveChar().catch(() => {});
  renderAll();
}

function useConsumable(idx) {
  const item = (CHAR?.equipment || [])[idx];
  if (!item) return;

  const prevQty = item.qty ?? 1;
  if (prevQty > 1) {
    item.qty = prevQty - 1;
  } else {
    CHAR.equipment.splice(idx, 1);
  }

  const healEffect = (item.effects || []).find(e => e.type === 'heal');
  if (healEffect) {
    const parsed = parseDiceExpr(healEffect.dice);
    if (parsed) {
      _pendingHealItem = { item };
      selectedDie = 'd' + parsed.sides;
      selectDie('d' + parsed.sides);
      document.getElementById('dice-count').value = parsed.count;
      document.getElementById('dice-mod').value = parsed.mod;
      document.getElementById('roll-label').textContent = `${item.name} — Healing`;
      rollDice();
      saveChar();
      renderAll();
      return;
    }
  }

  saveChar();
  renderAll();
}

async function onEvent(ev) {
  const p = ev.data;
  if (!p) return;

  // DM edited this player's sheet — reload from server storage and re-render
  if (p.type === 'sheet:dm-update' && p.userId === USER_ID) {
    storageGetCompanion('dnd-hub', `player_sheet_${CAMPAIGN_ID}_${USER_ID}`, 'server').then(updated => {
      if (!updated) return;
      CHAR = updated;
      window.CHAR = CHAR;
      setCombatCharData(CHAR);
      setSheetState(CHAR, saveChar, USER_ID, setDiceRollLabel, rollDice, CAMPAIGN_ID);
      setSpellState(CHAR, saveChar);
      setResourceState(CHAR, saveChar);
      renderAll();
      renderConcentration();
      renderCombat(_initiativeActive);
      renderResources();
    }).catch(() => {});
    return;
  }

  // Physics roll result returned from dnd-hub (or bounced back via realtime)
  if (p.type === EV.DICE_ROLL && p.userId === USER_ID && _pendingPhysicsRollTs !== null) {
    clearTimeout(_pendingPhysicsRollTimer);
    _pendingPhysicsRollTimer = null;
    _pendingPhysicsRollTs = null;
    _applyRollResult(p);

    // Weapon to-hit phase
    if (_pendingWeaponAttack) {
      const { item, weaponEffect, equipIdx } = _pendingWeaponAttack;
      const toHitRoll = (p.rolls && p.rolls.length > 0) ? p.rolls[0] : p.result;
      const toHitTotal = p.result;
      _pendingWeaponAttack = null;

      // Store context for damage phase
      _pendingWeaponDamage = { item, weaponEffect, toHitRoll, toHitMod: parseToHitMod(weaponEffect.toHit), toHitTotal, equipIdx };
      setPendingDamageIdx(equipIdx);

      // Broadcast to-hit to DM
      const attackPayload = {
        type: EV.WEAPON_ATTACK,
        userId: USER_ID,
        campaignId: CAMPAIGN_ID,
        fromUserId: USER_ID,
        weaponName: item.name,
        toHitRoll,
        toHitMod: parseToHitMod(weaponEffect.toHit),
        toHitTotal,
        label: `${item.name} — Attack`,
      };
      realtimePublish(EV.WEAPON_ATTACK, attackPayload);
      realtimePublishCompanion('dnd-master', EV.WEAPON_ATTACK, attackPayload);
      return;
    }

    // Weapon damage phase
    if (_pendingWeaponDamage) {
      const { item, weaponEffect, toHitRoll, toHitMod, toHitTotal, equipIdx } = _pendingWeaponDamage;
      _pendingWeaponDamage = null;
      clearPendingDamageIdx();

      const conditionEffect = (item.effects || []).find(e => e.type === 'condition_target');
      const damagePayload = {
        type: EV.WEAPON_ATTACK,
        userId: USER_ID,
        campaignId: CAMPAIGN_ID,
        fromUserId: USER_ID,
        weaponName: item.name,
        toHitRoll,
        toHitMod,
        toHitTotal,
        damageRoll: p.result,
        damageExpr: weaponEffect.damage,
        damageType: weaponEffect.damageType,
        label: `${item.name} — Damage`,
        ...(conditionEffect ? {
          conditionTarget: {
            condition: conditionEffect.condition,
            ...(conditionEffect.saveDC !== undefined ? { saveDC: conditionEffect.saveDC } : {}),
            ...(conditionEffect.saveAbility ? { saveAbility: conditionEffect.saveAbility } : {}),
          }
        } : {}),
      };
      realtimePublish(EV.WEAPON_ATTACK, damagePayload);
      realtimePublishCompanion('dnd-master', EV.WEAPON_ATTACK, damagePayload);
      return;
    }

    // Healing consumable phase
    if (_pendingHealItem) {
      const { item } = _pendingHealItem;
      _pendingHealItem = null;

      const healAmount = p.result;
      const effectiveStats = computeEffectiveStats(CHAR);
      const newHp = Math.min((CHAR.hp || 0) + healAmount, effectiveStats.hpMax);
      CHAR.hp = newHp;
      window.CHAR = CHAR;
      saveChar();
      renderAll();

      _showPlayerToast(`🧪 ${item.name}: healed ${healAmount} HP`);

      const hpPayload = {
        type: EV.HP_CHANGE,
        userId: USER_ID,
        campaignId: CAMPAIGN_ID,
        hp: newHp,
        hpMax: CHAR.hpMax,
        source: `${item.name} (healing)`,
        name: CHAR.name || 'Player',
      };
      realtimePublish(EV.HP_CHANGE, hpPayload);
      realtimePublishCompanion('dnd-master', EV.HP_CHANGE, hpPayload);
      return;
    }

    return;
  }

  // Own token's HP changed by DM — sync CHAR and re-render
  if (p.type === 'hp:change' && USER_ID &&
      (p.tokenId === 'player_' + USER_ID || p.userId === USER_ID)) {
    if (CHAR && p.hp !== undefined) {
      CHAR.hp = p.hp;
      if (p.hpMax !== undefined) CHAR.hpMax = p.hpMax;
      saveChar().catch(() => {});
      renderMain();
    }
    // Concentration check on taking damage (async IIFE — fire and forget)
    if (CHAR?.concentration) {
      (async () => {
        const srcStr = p.source || '';
        const dmgMatch = srcStr.match(/(\d+)\s*damage/i);
        const dmg = dmgMatch ? parseInt(dmgMatch[1], 10) : 0;
        const dc  = Math.max(10, Math.floor(dmg / 2));
        const hubDm = await loadHubDmCompanion().catch(() => null);
        const autoRoll = hubDm?.campaigns?.[CAMPAIGN_ID]?.settings?.concentrationAutoRoll ?? false;
        if (autoRoll && dmg > 0) {
          document.getElementById('dice-mod').value = Math.floor(((CHAR.con ?? 10) - 10) / 2);
          document.getElementById('roll-label').textContent = `Concentration DC ${dc} CON Save`;
          await rollDice();
        } else if (dmg > 0) {
          _showPlayerToast(`Concentration check! DC ${dc} CON save (${CHAR.concentration.spellName})`);
        }
      })();
    }
    renderConcentration();
    return;
  }

  // DM triggered death saves (HP reached 0)
  if (p.type === 'token:death-save' && USER_ID && p.tokenId === 'player_' + USER_ID) {
    if (CHAR) {
      CHAR.deathSaves = { successes: p.successes ?? 0, failures: p.failures ?? 0 };
      saveChar().catch(() => {});
      const dsSection = document.getElementById('death-saves-section');
      if (dsSection) {
        dsSection.style.display = 'block';
        renderDeathSaves();
      }
    }
    return;
  }

  // Active combatant changed — clear action economy if it's our turn
  if (p.type === 'token:turn-start' && USER_ID && p.tokenId === 'player_' + USER_ID) {
    clearActionEconomy();
    return;
  }

  // Initiative state changed — show/hide action economy
  if (p.type === 'initiative:update') {
    _initiativeActive = !!p.initiative?.active;
    setInitiativeData(p.initiative);
    renderCombat(_initiativeActive);
    return;
  }

  // Character created flow (existing)
  if (p.type === 'character:created' && p.userId === USER_ID) {
    storageGetCompanion('dnd-hub', 'characters', 'user').then(userData => {
      if (!userData) return;
      CAMPAIGN_ID = CAMPAIGN_ID || p.campaignId;
      CHAR = userData[CAMPAIGN_ID] ?? null;
      if (!CHAR) return;
      document.getElementById('loading').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      window.CHAR = CHAR; window.saveChar = saveChar;
      initTabHTML();
      setSheetState(CHAR, saveChar, USER_ID, setDiceRollLabel, rollDice, CAMPAIGN_ID);
      setSpellState(CHAR, saveChar);
      setResourceState(CHAR, saveChar);
      renderAll(); loadSRDSpells();
    }).catch(() => {});
    return;
  }

  if (p.type === 'join:approved' && p.userId === USER_ID && !CAMPAIGN_ID) { onInit({}); return; }

  if (p.type === EV.HANDOUT_PUSH && p.campaignId === CAMPAIGN_ID) {
    showHandout({ title: p.title, content: p.content });
    return;
  }

  if (p.type === EV.AUDIO_PLAY && p.campaignId === CAMPAIGN_ID) {
    handleAudioPlay(p);
    return;
  }

  if (p.type === EV.AUDIO_ZONE_UPDATE && p.campaignId === CAMPAIGN_ID) {
    _audioZones = p.audioZones || [];
    recomputeZoneVolumes().catch(() => {});
    return;
  }

  if (p.type === EV.TOKEN_MOVE && p.campaignId === CAMPAIGN_ID && USER_ID &&
      p.tokenId === 'player_' + USER_ID) {
    _myTokenPos = { x: p.x, y: p.y };
    recomputeZoneVolumes().catch(() => {});
    return;
  }

  if (p.type === EV.TRIGGER_FIRED && p.campaignId === CAMPAIGN_ID) {
    if (p.message) _showPlayerToast(p.message);
    return;
  }

  if (p.type === EV.SHOP_OPEN && p.campaignId === CAMPAIGN_ID) {
    _openShopTab(p.shopId).catch(() => {});
    return;
  }

  if (p.type === EV.SCENE_LOAD && p.campaignId === CAMPAIGN_ID) {
    if (p.shopId) {
      _openShopTab(p.shopId).catch(() => {});
    } else if (_activeShopId) {
      _closeShopTab();
    }
    return;
  }

  if (p.type === 'loot:resolved' && p.campaignId === CAMPAIGN_ID) {
    if (p.winner === USER_ID && CHAR) {
      SERVER_DATA = await loadHubDmCompanion() || SERVER_DATA || { campaigns: {} };
      const item = _resolveItemFromLibrary(p.itemId);
      if (item) {
        _addItemToChar(item, 1, p.goldCost || 0);
        // Clear the pending reward so onInit doesn't add it again as a duplicate
        const pr = SERVER_DATA?.campaigns?.[CAMPAIGN_ID]?.pendingRewards?.[USER_ID];
        if (pr?.length) {
          const i = pr.findIndex(r => r.itemId === p.itemId);
          if (i !== -1) pr.splice(i, 1);
          saveHubDmCompanion(SERVER_DATA).catch(() => {});
        }
        await saveChar();
        _resolveInventoryImages().then(() => renderAll()).catch(() => {});
      }
    }
    return;
  }
}

async function startLevelUp() {
  // Load SRD data first, then start wizard (so spell/feat pickers are populated)
  let srdData = { classes: [], feats: [], spells: [] };
  try {
    const base = new URL('../../dnd-hub/dnd-srd/', document.baseURI).href;
    const [classes, feats, spells] = await Promise.all([
      fetch(base + 'classes.json').then(r => r.json()),
      fetch(base + 'feats.json').then(r => r.json()),
      fetch(base + 'spells.json').then(r => r.json()),
    ]);
    srdData = { classes, feats, spells };
  } catch { /* SRD load failure — wizard starts with empty pickers */ }
  await _startLevelUp(CHAR, saveChar, CAMPAIGN_ID, USER_ID, srdData);
}

function openCharEdit() {
  if (!CHAR) return;
  document.getElementById('char-edit-overlay')?.remove();
  const _e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const ABILITY_KEYS = ['str','dex','con','int','wis','cha'];
  const AB_LABELS    = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };
  const inp = (id, val, type='text', extra='') =>
    `<input id="${id}" type="${type}" value="${_e(val)}" ${extra}` +
    ' style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:5px;padding:5px 7px;color:#fff;font-size:12px;margin-top:2px;outline:none">';

  const o = document.createElement('div');
  o.id = 'char-edit-overlay';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9500;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  o.innerHTML =
    '<div style="background:#1a1a2e;border:1px solid rgba(212,175,55,.4);border-radius:12px;padding:18px;width:100%;max-width:380px;color:#e2e8f0">' +
      '<div style="font-size:13px;font-weight:800;color:#d4af37;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">' +
        '✏️ Edit Character' +
        '<button onclick="document.getElementById(\'char-edit-overlay\').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;padding:0">&times;</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;align-items:center;margin-bottom:12px">' +
        '<div id="ce-portrait-preview" style="width:72px;height:72px;border-radius:50%;background:#2a2a40;border:2px solid rgba(212,175,55,.4);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:6px">' +
          (CHAR.portraitFileId ? '<img id="ce-portrait-img" style="width:100%;height:100%;object-fit:cover">' : '🧙') +
        '</div>' +
        '<button onclick="document.getElementById(\'ce-portrait-input\').click()" style="font-size:10px;padding:4px 10px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.3);border-radius:5px;color:#d4af37;cursor:pointer">📷 ' + (CHAR.portraitFileId ? 'Change Portrait' : 'Upload Portrait') + '</button>' +
        '<input type="file" id="ce-portrait-input" accept="image/*" style="display:none">' +
      '</div>' +
      '<label style="font-size:10px;color:var(--muted);display:block;margin-bottom:8px">Name<br>' + inp('ce-name', CHAR.name||'') + '</label>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">' +
        '<label style="font-size:10px;color:var(--muted)">Race<br>' + inp('ce-race', CHAR.race||'') + '</label>' +
        '<label style="font-size:10px;color:var(--muted)">Class<br>' + inp('ce-class', CHAR.class||'') + '</label>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--muted);margin-bottom:5px">Ability Scores</div>' +
      '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-bottom:10px">' +
        ABILITY_KEYS.map(a =>
          '<label style="font-size:9px;color:var(--muted);text-align:center">' + AB_LABELS[a] + '<br>' +
          inp('ce-'+a, CHAR[a]||10, 'number', 'min="1" max="30"') + '</label>'
        ).join('') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">' +
        '<label style="font-size:10px;color:var(--muted)">AC<br>'     + inp('ce-ac',    CHAR.ac||10,    'number','min="0"') + '</label>' +
        '<label style="font-size:10px;color:var(--muted)">Speed<br>'  + inp('ce-speed', CHAR.speed||30, 'number','min="0"') + '</label>' +
        '<label style="font-size:10px;color:var(--muted)">HP Max<br>' + inp('ce-hpmax', CHAR.hpMax||1,  'number','min="1"') + '</label>' +
      '</div>' +
      '<label style="font-size:10px;color:var(--muted);display:block;margin-bottom:12px">Total XP<br>' +
        inp('ce-xp', CHAR.xp||0, 'number', 'min="0"') + '</label>' +
      '<div style="display:flex;gap:8px">' +
        '<button onclick="document.getElementById(\'char-edit-overlay\').remove()" style="flex:1;padding:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#94a3b8;cursor:pointer;font-size:12px">Cancel</button>' +
        '<button id="ce-save-btn" style="flex:2;padding:8px;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.4);border-radius:6px;color:#d4af37;cursor:pointer;font-size:12px;font-weight:700">Save Changes</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(o);

  // Load existing portrait into preview
  if (CHAR.portraitFileId) {
    request('files:getUrl', { fileId: CHAR.portraitFileId }).then(r => {
      const img = document.getElementById('ce-portrait-img');
      if (img && r?.url) img.src = r.url;
    }).catch(() => {});
  }
  // Live preview when a new file is selected
  document.getElementById('ce-portrait-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById('ce-portrait-preview');
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img style="width:100%;height:100%;object-fit:cover" src="${url}">`;
  });

  const _int = (id, fb) => Math.max(0, parseInt(document.getElementById(id)?.value, 10) || fb);
  document.getElementById('ce-save-btn').onclick = async () => {
    const saveBtn = document.getElementById('ce-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }
    CHAR.name  = document.getElementById('ce-name')?.value.trim()  || CHAR.name;
    CHAR.race  = document.getElementById('ce-race')?.value.trim()  || CHAR.race;
    CHAR.class = document.getElementById('ce-class')?.value.trim() || CHAR.class;
    for (const a of ABILITY_KEYS) CHAR[a] = Math.max(1, _int('ce-'+a, CHAR[a]||10));
    CHAR.ac    = _int('ce-ac',    CHAR.ac||10);
    CHAR.speed = _int('ce-speed', CHAR.speed||30);
    CHAR.hpMax = Math.max(1, _int('ce-hpmax', CHAR.hpMax||1));
    CHAR.xp    = _int('ce-xp',   CHAR.xp||0);
    // Portrait upload
    const fileInput = document.getElementById('ce-portrait-input');
    if (fileInput?.files[0]) {
      try {
        const file = fileInput.files[0];
        const buf  = await file.arrayBuffer();
        const res  = await request('files:upload', { data: buf, name: file.name, mime: file.type });
        if (res?.id) { CHAR.portraitUrl = res.url || ''; CHAR.portraitFileId = res.id; }
      } catch (e) { console.error('Portrait upload failed', e); }
    }
    await saveChar();
    // Update characterSummary + mirror portrait to hub token
    try {
      const sd = await loadHubDmCompanion();
      if (sd?.campaigns?.[CAMPAIGN_ID]?.characterSummaries?.[USER_ID]) {
        sd.campaigns[CAMPAIGN_ID].characterSummaries[USER_ID].portraitUrl    = CHAR.portraitUrl || '';
        sd.campaigns[CAMPAIGN_ID].characterSummaries[USER_ID].portraitFileId = CHAR.portraitFileId || '';
        await saveHubDmCompanion(sd);
      }
      if (CHAR.portraitFileId) {
        await realtimePublishCompanion('dnd-hub', 'tokens:spawn', {
          type: 'tokens:spawn', campaignId: CAMPAIGN_ID, mapId: '_any',
          tokens: [{ id: 'player_' + USER_ID, type: 'player', portraitUrl: CHAR.portraitUrl, portraitFileId: CHAR.portraitFileId }],
          fromUserId: USER_ID,
        });
      }
    } catch { /* non-fatal */ }
    setSheetState(CHAR, saveChar, USER_ID, setDiceRollLabel, rollDice, CAMPAIGN_ID);
    renderAll();
    renderConcentration();
    o.remove();
  };
}

window.switchTab = switchTab; window.selectDie = selectDie; window.toggleAdv = toggleAdv;
window.rollDice = rollDice; window.changeHP = changeHP; window.updateTempHP = updateTempHP;
window.toggleCondition = toggleCondition; window.toggleInspiration = toggleInspiration;
window.toggleDeathSave = toggleDeathSave; window.changeExhaustion = changeExhaustion;
window.rollAbilityCheck = rollAbilityCheck; window.rollSkillCheck = rollSkillCheck;
window.debounceSaveNotes = debounceSaveNotes; window.toggleEquipped = toggleEquipped;
window.toggleSpellExpand = toggleSpellExpand; window.expendSpellSlot = expendSpellSlot;
window.castSpell          = castSpell;
window.clearConcentration = clearConcentration;
window.toggleAction = toggleAction;
window.clearActionEconomy = clearActionEconomy;
window.toggleResourcePip = toggleResourcePip;
window.startLevelUp        = startLevelUp;
window.levelUpBack         = levelUpBack;
window.levelUpNext         = levelUpNext;
window.closeLevelUp        = closeLevelUp;
window.levelUpRollHP       = levelUpRollHP;
window.levelUpTakeAverage  = levelUpTakeAverage;
window.levelUpToggleSpell  = levelUpToggleSpell;
window.levelUpASIMode      = levelUpASIMode;
window.levelUpFeat         = levelUpFeat;
window.renderAll           = renderAll;
window.toggleFeatureExpand  = toggleFeatureExpand;
window.saveFeatureDesc      = saveFeatureDesc;
window.toggleInventoryItem  = toggleInventoryItem;
window.useConsumable        = useConsumable;
window.removeInventoryItem  = removeInventoryItem;
window.openCharEdit        = openCharEdit;
window.weaponAttack        = weaponAttack;
window.weaponRollDamage    = weaponRollDamage;
window.useConsumable       = useConsumable;

// Wrap doShortRest / doLongRest to also restore class resources
const _origShortRest = doShortRest;
const _origLongRest  = doLongRest;
window.doShortRest = async () => { await _origShortRest(); restoreResourcesOnShortRest(CHAR); await saveChar(); renderResources(); };
window.doLongRest  = async () => { await _origLongRest();  restoreResourcesOnLongRest(CHAR);  await saveChar(); renderResources(); };

// ── Audio context unlock gate (browser autoplay policy) ──────────────────────
let _audioUnlocked = false;
const _audioQueue = [];

function _unlockAudio() {
  if (_audioUnlocked) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume().then(() => {
    _audioUnlocked = true;
    document.getElementById('audio-gate-banner')?.remove();
    _audioQueue.forEach(fn => fn(ctx));
    _audioQueue.length = 0;
  });
}

document.addEventListener('click', _unlockAudio, { once: true });
document.addEventListener('keydown', _unlockAudio, { once: true });

setTimeout(() => {
  if (_audioUnlocked) return;
  const banner = document.createElement('div');
  banner.id = 'audio-gate-banner';
  banner.style.cssText = 'position:fixed;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);border:1px solid var(--border);border-radius:6px;padding:6px 14px;font-size:11px;color:var(--muted);pointer-events:none;z-index:9999';
  banner.textContent = '🔊 Audio paused — click anywhere to enable';
  document.body.appendChild(banner);
}, 2000);

// ── Message bridge ────────────────────────────────────────────────────────────
window.addEventListener('message', e => handleSDKMessage(e, onInit, onEvent));

// Replay anything the host sent while this module was still loading (see the
// buffering note in plugin.html) — dissent:init in particular.
window.__dndPlayerReady = true;
for (const buffered of (window.__dndPlayerQueue || [])) {
  handleSDKMessage(buffered, onInit, onEvent);
}
window.__dndPlayerQueue = [];
