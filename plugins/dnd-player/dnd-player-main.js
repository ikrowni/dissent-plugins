// dnd-player-main.js — bootstrap: init, tab switching, event dispatch + dice roller
import { handleSDKMessage, getIdentity, storageGetCompanion, storageSetCompanion, realtimePublish, realtimePublishCompanion, localPublish, request, esc } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js';
import { setCampaignGetter, setSheetState, setInventoryImageUrls, renderAll, renderMain, renderDeathSaves,
  changeHP, updateTempHP, toggleCondition, toggleDeathSave, rollDeathSaveNow, changeExhaustion, effectLabel,
  toggleInspiration, doShortRest, doLongRest, toggleEquipped,
  rollAbilityCheck, rollSkillCheck, debounceSaveNotes,
  toggleFeatureExpand, saveFeatureDesc,
  computeEffectiveStats, effectiveChar, announceHp, setPendingDamageIdx, clearPendingDamageIdx, toggleInventoryItem,
  heroMasteries, masteryOn, toggleMastery } from './dnd-player-sheet.js';
import { masteryFor } from './lk-mastery.js';
import { setSpellState, setBookParts, loadSRDSpells, renderSpells, toggleSpellExpand, expendSpellSlot,
         castSpell, setConcentration, clearConcentration } from './dnd-player-spells.js';
import { renderCombat, clearActionEconomy, toggleAction, setInitiativeData, setCombatCharData, setNeedsInitiativeRoll } from './dnd-player-combat.js';
import { rule } from './lk-table-rules.js';
import { saveBonus, trapPrompt, trapResult, needsMyRoll, deathSaveTurn } from './dnd-player-table.js';
import { playerStrip, playerStripHtml } from './lk-party.js';
import { setResourceState, renderResources, toggleResourcePip,
         restoreResourcesOnShortRest, restoreResourcesOnLongRest } from './dnd-player-resources.js';
import { loadHubDmCompanion, saveHubDmCompanion, cachedIndexIds, setSecretsUser } from './dnd-hub-shared-storage.js';
import { sealedHtml } from './lk-sealed.js';
import { initGuides, guide, guidesOn, setGuidesOn } from './lk-guide-ui.js';
import { GUIDES_KEY } from './lk-guides.js';
import { loadPlayerParts } from './lk-book.js';
import { pruneDeadHeroes } from './dnd-campaign-merge.js';
import { pickCampaign } from './dnd-campaign-pick.js';
import { normalizeSlots, characterSummary, weaponProfile, weaponReach, attacksPerAction, critDamageExpr, applyDamage, applyHealing, abilityMod, setHp } from './lk-rules5e.js';
import { zoneVolume } from './dnd-player-zones.js';
import { isRepeat, publishTo } from './lk-bus.js';

import { guarded } from './lk-upload.js';
import { handleTavern } from './dnd-player-tavern.js?v=20261015j';
let CHAR = null;
let CAMPAIGN_ID = null;
let USER_ID = null;
let SERVER_DATA = null;
setCampaignGetter(() => SERVER_DATA?.campaigns?.[CAMPAIGN_ID] || null);
let _deathPromptKey = null;
let _initiative = null;
const tableRule = k => rule(SERVER_DATA?.campaigns?.[CAMPAIGN_ID]?.settings, k);
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

/** Adds an item; with a cost, only if the hero can pay it. Returns false when they cannot. */
function _addItemToChar(item, qty, goldCost) {
  if (goldCost > 0 && (CHAR.gold || 0) < goldCost) {
    _showPlayerToast(`Not enough gold for ${item.name} (${goldCost} gp, you have ${CHAR.gold || 0}).`);
    return false;
  }
  const entry = {
    id: item.id, name: item.name, type: item.type,
    description: item.description || '',
    effects: item.effects || [],
    imageFileId: item.imageFileId || null,
    qty: qty || 1, equipped: false, attuned: false,
  };
  // Consumables live in `equipment` like everything else: the inventory shows only that list, and
  // useConsumable reads it. They used to go to a separate `consumables` list nobody displayed.
  if (!CHAR.equipment) CHAR.equipment = [];
  const existing = item.type === 'consumable' && CHAR.equipment.find(c => c.id === item.id && c.type === 'consumable');
  if (existing) existing.qty = (existing.qty || 1) + (qty || 1);
  else CHAR.equipment.push(entry);
  if (goldCost > 0) CHAR.gold = (CHAR.gold || 0) - goldCost;
  return true;
}

async function _resolveInventoryImages() {
  const allItems = [
    ...(CHAR?.equipment || []),
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
let _myTokenPos  = null;  // { x, y } my token's place in SQUARES, as zones are stored (my Hub sends it: dnd-hub-zone-pos.js)
const _zoneAudioEls = {};  // zoneId → Audio element

// Phase 3 — Shop tab
let _activeShopId    = null;
let _activeShopData  = null;
let _activeShopItems = null;
let _shopImageUrls   = {};
const _expandedShopSlots = new Set();

/**
 * Bring a saved sheet up to today's shape (audit 2026-10-02). Old saves carry one of three spell-slot
 * shapes (creator, old level-up, DM editor) and may keep shop/loot consumables in a separate list the
 * inventory never showed. Idempotent: safe on every load.
 */
function migrateChar(c) {
  if (!c) return c;
  c.spellSlots = normalizeSlots(c.spellSlots, c.spellSlotsMax);
  delete c.spellSlotsMax;
  if (Array.isArray(c.consumables) && c.consumables.length) {
    c.equipment = [...(c.equipment || []), ...c.consumables.map(x => ({ ...x, type: 'consumable' }))];
  }
  delete c.consumables;
  if (c.hitDiceRemaining == null) c.hitDiceRemaining = c.level || 1;
  // Old creator saves kept bare ids ({ id: 'chain-mail' }); give them a readable name.
  (c.equipment || []).forEach(e => {
    if (!e.name && e.id) e.name = e.id.replace(/-/g, ' ').replace(/^./, ch => ch.toUpperCase());
  });
  return c;
}

/** The newer of two copies of a sheet: the player's own and the server mirror the DM edits. */
function newerSheet(a, b) {
  if (!a) return b; if (!b) return a;
  return Date.parse(b.updatedAt || 0) > Date.parse(a.updatedAt || 0) ? b : a;
}

// The campaign's summary of this hero (party view, initiative AC/DEX, encounter levels). Written only
// when it changes, at most every 2 s: companion writes share the 60/min plugin-data limit.
let _summaryTimer = null;
function scheduleSummarySync() {
  clearTimeout(_summaryTimer);
  _summaryTimer = setTimeout(async () => {
    if (!CHAR || !CAMPAIGN_ID || !USER_ID) return;
    const eff = computeEffectiveStats(CHAR);
    const next = characterSummary(CHAR, { ac: eff.ac, hpMax: eff.hpMax, dex: eff.abilities.dex, wis: eff.abilities.wis });
    const sd = await loadHubDmCompanion().catch(() => null);
    const camp = sd?.campaigns?.[CAMPAIGN_ID];
    if (!camp) return;
    const prev = camp.characterSummaries?.[USER_ID];
    if (prev && JSON.stringify({ ...prev, ...next }) === JSON.stringify(prev)) return;
    const summary = { ...(prev || {}), ...next };
    camp.characterSummaries = { ...(camp.characterSummaries || {}), [USER_ID]: summary };
    await saveHubDmCompanion(sd).catch(() => {});
    SERVER_DATA = sd;
    // Party at a glance: other sheets and the Hub hear it; the DM's Hub hands it to the DM sidebar (players
    // cannot publish to dnd-master).
    await publishTo(['hub'], EV.PARTY_UPDATE, { campaignId: CAMPAIGN_ID, userId: USER_ID, summary, fromUserId: USER_ID })
      .catch(e => console.error('[dnd-player] party update', e));
  }, 2000);
}

let _shopGold = null; // the gold the open shop was last drawn with
async function saveChar() {
  CHAR.updatedAt = new Date().toISOString();
  // The open shop says what the hero can afford: when the gold changes (a purchase, the DM's gift, a sheet edit) it
  // is drawn again. It used to keep "Not enough gold" from when the shop opened (rules playtest, 2026-10-04).
  if (_activeShopId && (CHAR.gold || 0) !== _shopGold) _renderShopTab(_activeShopItems || []);
  const userData = await storageGetCompanion('dnd-hub', 'characters', 'user') || {};
  userData[CAMPAIGN_ID] = CHAR;
  // Heroes of deleted campaigns filled this value to the 64 KB cap, and every save then failed (413).
  await pruneDeadHeroes(userData, CAMPAIGN_ID, cachedIndexIds(), () => storageGetCompanion('dnd-hub', 'hub-index', 'server'));
  await storageSetCompanion('dnd-hub', 'characters', 'user', userData);
  // Mirror to server scope so the DM can read and edit this sheet
  if (USER_ID && CAMPAIGN_ID) {
    await storageSetCompanion('dnd-hub', `player_sheet_${CAMPAIGN_ID}_${USER_ID}`, 'server', CHAR);
  }
  scheduleSummarySync();
}

/** My companions at the top of Main: names, a band of health, conditions, "Down". No numbers (lk-party). */
function renderPartyStrip() {
  const el = document.getElementById('party-strip');
  if (!el) return;
  const camp = SERVER_DATA?.campaigns?.[CAMPAIGN_ID];
  el.innerHTML = playerStripHtml(playerStrip(camp?.characterSummaries, USER_ID, camp?.members));
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
  if (name === 'spells') { loadSRDSpells().then(() => renderSpells()); guide('sheet:spells'); }
  if (name === 'resources') renderResources();
  if (name === 'main') renderConcentration();
  if (name === 'notes') renderPartyJournal().catch(() => {});
}

/**
 * The journals the DM marked "Player visible", to reread at any time. Players used to see one only when the
 * DM pushed it as a handout (gone once dismissed) or through a map pin (audit K1).
 */
async function renderPartyJournal() {
  const el = document.getElementById('party-journal');
  if (!el || !CAMPAIGN_ID) return;
  SERVER_DATA = await loadHubDmCompanion().catch(() => null) || SERVER_DATA;
  const list = Object.values(SERVER_DATA?.campaigns?.[CAMPAIGN_ID]?.journals || {})
    .filter(j => j.visibility === 'player')
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  el.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">PARTY JOURNAL</div>' +
    (list.length ? list.map(j =>
      '<details style="margin-bottom:6px;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px">' +
        '<summary style="cursor:pointer;font-size:12px;font-weight:600">' + esc(j.title || 'Untitled') + '</summary>' +
        (j.imageFileId ? '<img data-jimg="' + esc(j.imageFileId) + '" alt="' + esc(j.title || '') + '" style="display:block;width:100%;margin-top:6px;border-radius:4px;min-height:40px;background:rgba(255,255,255,.04)">' : '') +
        (j.content ? '<div style="font-size:11px;color:var(--muted);margin-top:6px;white-space:pre-wrap;line-height:1.5">' + esc(j.content) + '</div>' : '') +
      '</details>').join('')
      : '<div style="font-size:11px;color:var(--muted)">Nothing shared yet. Pages the DM shares appear here.</div>');
  fillJournalPictures(el);
}

// A shared picture (a box the DM cut from a book page, book-cut-actions.js) is a campaign file: loaded once a session.
const _journalPics = new Map(); // file id → Promise<object URL>
function fillJournalPictures(root) {
  for (const img of root.querySelectorAll('img[data-jimg]')) {
    const id = img.dataset.jimg;
    if (!_journalPics.has(id)) {
      const p = request('files:loadArrayBuffer', { fileId: id }, 60000).then(r => URL.createObjectURL(new Blob([r.buffer], { type: 'image/webp' })));
      _journalPics.set(id, p);
      p.catch(() => _journalPics.delete(id));
    }
    _journalPics.get(id).then(url => { if (img.isConnected) img.src = url; }, () => { img.replaceWith(Object.assign(document.createElement('div'), { textContent: 'The picture could not be loaded.', style: 'font-size:11px;color:var(--muted)' })); });
  }
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

async function rollDice(rollType = null, weapon = null) {
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
    advMode, userId: USER_ID, ts, rollType, weapon,
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
    _afterMyRoll({ result: total, rolls, advMode, expression, label, ts, userId: USER_ID }).catch(() => {});
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
  const { title, content, imageFileId } = _handoutQueue.shift();
  document.getElementById('player-handout-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'player-handout-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,sans-serif';
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  overlay.innerHTML =
    '<div style="background:var(--lk-raise);border:1px solid rgba(212,175,55,.4);border-radius:10px;padding:20px;max-width:340px;width:90%;max-height:75vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,.8)">' +
      '<div style="font-size:13px;font-weight:800;color:var(--lk-gold);margin-bottom:10px;border-bottom:1px solid rgba(212,175,55,.25);padding-bottom:8px">\uD83D\uDCDC ' + esc(title) + '</div>' +
      (imageFileId ? '<img data-jimg="' + esc(imageFileId) + '" alt="' + esc(title) + '" style="display:block;width:100%;border-radius:6px;min-height:60px;background:rgba(255,255,255,.04)">' : '') +
      (content ? '<div style="font-size:12px;color:rgba(255,255,255,.85);line-height:1.6;white-space:pre-wrap">' + esc(content) + '</div>' : '') +
      '<button style="margin-top:14px;width:100%;padding:8px;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.3);border-radius:6px;color:var(--lk-gold);font-size:11px;font-weight:700;cursor:pointer" id="handout-dismiss-btn">Dismiss' +
        (_handoutQueue.length > 0 ? ' (' + _handoutQueue.length + ' more)' : '') + '</button>' +
    '</div>';
  document.body.appendChild(overlay);
  fillJournalPictures(overlay);
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
    const vol = zoneVolume(zone, _myTokenPos);
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

/** Taking damage while concentrating: a CON save, DC 10 or half the damage, whichever is higher (SRD). */
function _concentrationCheck(dmg) {
  if (!(dmg > 0)) return;
  const dc = Math.max(10, Math.floor(dmg / 2));
  if (tableRule('concentrationAutoRoll')) {
    document.getElementById('dice-mod').value = Math.floor(((CHAR.con ?? 10) - 10) / 2);
    document.getElementById('roll-label').textContent = `Concentration DC ${dc} CON Save`;
    rollDice().catch?.(() => {});
  } else {
    _showPlayerToast(`Concentration check! ${tableRule('hints') ? `DC ${dc} ` : ''}CON save (${CHAR.concentration.spellName})`);
  }
  renderConcentration();
}

async function _takeTrap(p, d20) {
  const bonus = p.saveAbility ? saveBonus(CHAR, effectiveChar() || CHAR, p.saveAbility) : 0;
  const { damage, note } = trapResult(p, d20, bonus, tableRule('hints'));
  const eff = computeEffectiveStats(CHAR);
  Object.assign(CHAR, applyDamage({ ...CHAR, hpMax: eff.hpMax }, damage), { hpMax: CHAR.hpMax });
  await saveChar();
  renderAll();
  _showPlayerToast(`🪤 Trap! ${damage} damage.${note}`);
  if (CHAR.concentration && !CHAR.dead) _concentrationCheck(damage);
  announceHp('Trap');
}

/** Classic and Raw tables: the player rolls the trap's save themselves. */
function _showTrapPrompt(p) {
  document.getElementById('trap-prompt')?.remove();
  const box = document.createElement('div');
  box.id = 'trap-prompt';
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:9999;padding:12px;border-radius:8px;background:var(--surface);border:1px solid var(--dnd-red,#b91c1c);text-align:center';
  box.innerHTML = `<div style="font-size:12px;font-weight:700;margin-bottom:8px">🪤 A trap! ${esc(trapPrompt(p, tableRule('hints')))}</div>` +
    '<button class="btn btn-gold btn-sm">Roll</button>';
  box.querySelector('button').addEventListener('click', () => {
    box.remove();
    _takeTrap(p, Math.floor(Math.random() * 20) + 1).catch(e => console.error('[dnd-player] trap', e));
  });
  document.body.appendChild(box);
}

function _showPlayerToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--lk-panel);border:1px solid #6366f1;color:#a5b4fc;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
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
    <div id="party-strip" style="margin-bottom:10px"></div>
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
          style="flex:1;min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:13px;outline:none">
        <button class="btn btn-ghost btn-sm" style="padding:6px 9px;white-space:nowrap" onclick="changeHP(-1)">– Damage</button>
        <button class="btn btn-primary btn-sm" style="padding:6px 9px;white-space:nowrap" onclick="changeHP(1)">+ Heal</button>
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
        <button id="death-save-roll" class="btn btn-gold btn-sm" style="margin-left:auto;align-self:center" onclick="rollDeathSaveNow()">Roll death save</button>
      </div>
      <div id="death-save-state" style="font-size:10px;margin-top:6px"></div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" style="flex:1" onclick="doShortRest()">🌙 Short Rest</button>
      <button class="btn btn-ghost" style="flex:1" onclick="doLongRest()">☀️ Long Rest</button>
    </div>
    <div id="xp-bar-section" style="margin-top:8px"></div>
    <div id="levelup-banner" style="display:none;margin-top:8px;padding:10px 14px;
      background:rgba(212,175,55,.15);border:1px solid rgba(212,175,55,.5);border-radius:8px;
      text-align:center;cursor:pointer;font-size:12px;font-weight:700;color:var(--lk-gold)"
      onclick="startLevelUp()">⬆ Level up! Open it when you’re ready →</div>`;
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
    <div id="party-journal" style="margin-bottom:12px"></div>
    <textarea id="notes-area" placeholder="Your private notes…" oninput="debounceSaveNotes()"
      style="width:100%;height:100%;min-height:300px;background:transparent;border:none;
      color:var(--text);font-size:12px;line-height:1.6;outline:none;resize:none;font-family:inherit"></textarea>`;
  renderPartyStrip();
}

// Set by the Hub's CAMPAIGN_ACTIVE announcement; see onEvent.
let _announcedCampaignId = null;
// What the Hub said is open: 'unknown' (not heard yet), 'none' (lobby, Hero Forge: stay sealed), 'open', or 'fallback'
// (no answer: a Hub too old to answer; pick a campaign the old way).
let _hubState = 'unknown', _hubAsked = false;
let _announcedRole = null, _loadRetries = 0, _loadRetryTimer = 0, _initGen = 0;

/** The sheet is closed: nothing to use until there is a hero in an open campaign (lk-sealed.js). */
function seal(title, text, action) {
  const app = document.getElementById('app');
  if (app) app.style.display = 'none';
  const el = document.getElementById('loading');
  el.style.display = '';
  el.innerHTML = sealedHtml({ title, text, action });
}
const sealTable = () => seal('Your sheet', 'Your character sheet opens here once your hero is ready and you sit down at a table.');

async function onInit(data) {
  const identity = await getIdentity();
  USER_ID = identity?.id ?? null;
  setSecretsUser(USER_ID);
  initGuides({ get: () => storageGetCompanion('dnd-hub', GUIDES_KEY, 'user'), set: v => storageSetCompanion('dnd-hub', GUIDES_KEY, 'user', v) });
  // Ask the Hub what it shows (it may have loaded first, and its announcement gone before this frame listened).
  if (!_hubAsked) {
    _hubAsked = true;
    localPublish('dnd-hub', EV.CAMPAIGN_QUERY, { type: EV.CAMPAIGN_QUERY });
    setTimeout(() => { if (_hubState === 'unknown') { _hubState = 'fallback'; onInit({}); } }, 6000);
  }
  if (_hubState === 'unknown') return; // the answer calls onInit again
  // Only the newest load counts: an older one finishing late would open the campaign it read then.
  const gen = ++_initGen;
  if (_hubState === 'none') { CAMPAIGN_ID = null; CHAR = null; sealTable(); return; }
  const loaded = await loadHubDmCompanion() || { campaigns: {} };
  const storedCampaignId = await storageGetCompanion('dnd-hub', 'activePlayerCampaignId', 'user');
  if (gen !== _initGen) return;
  SERVER_DATA = loaded;
  // The Hub's announcement (CAMPAIGN_ACTIVE) wins over the stored id: it is what the
  // user is looking at right now.
  const myCampaign = pickCampaign(SERVER_DATA.campaigns, _announcedCampaignId || storedCampaignId, USER_ID);
  // 🔴 The Hub's campaign did not load (a failed or rate-limited read reads as nothing): never open ANOTHER campaign's
  // hero in its place — pickCampaign falls back to any campaign the user is in (dnd-master's twin, 2026-10-05). Wait, and read again.
  if (_announcedRole === 'player' && _announcedCampaignId && myCampaign?.id !== _announcedCampaignId) {
    seal('Opening your campaign…', 'The table is busy for a moment. Your sheet opens here as soon as it answers.');
    CAMPAIGN_ID = null; CHAR = null;
    clearTimeout(_loadRetryTimer);
    _loadRetryTimer = setTimeout(() => onInit({}), Math.min(30000, 3000 * 2 ** _loadRetries++));
    return;
  }
  // Loaded: a retry still waiting would reload later and replace the sheet the player is using.
  clearTimeout(_loadRetryTimer); _loadRetries = 0;
  CAMPAIGN_ID = myCampaign?.id ?? null;
  if (!CAMPAIGN_ID) { sealTable(); return; }
  // Load the sheet BEFORE deciding whether this is a DM-only session. Having a
  // character in the campaign is what proves you are playing it; membership does not.
  // Two copies exist: the player's own (user scope) and the server mirror the DM reads and edits.
  // 🔴 The newer one wins. The own copy used to win always, and the save below then overwrote the
  // mirror — so anything the DM changed while the player was away was silently undone.
  const userData = await storageGetCompanion('dnd-hub', 'characters', 'user') || {};
  const mirror = (USER_ID && CAMPAIGN_ID)
    ? await storageGetCompanion('dnd-hub', `player_sheet_${CAMPAIGN_ID}_${USER_ID}`, 'server').catch(() => null) ?? null
    : null;
  if (gen !== _initGen) return;
  CHAR = migrateChar(newerSheet(userData[CAMPAIGN_ID] ?? null, mirror));

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
  // Not 'hide': PluginRuntime treats a hide as permanent until remount, so a DM who
  // later builds a character would never get the sheet back. Point at the right panel.
  if (isDMOnly) {
    seal('You\'re the DM', 'Your tools are in the LanternKeep DM panel. Switch with ⇅ above.');
    return;
  }

  if (!CHAR) {
    window._retryPlayerInit = () => onInit({});
    seal('No hero yet', 'Make your hero at the LanternKeep table. Your sheet opens here when they are ready.',
      { label: '↺ Check again', onclick: 'window._retryPlayerInit()' });
    return;
  }
  _lastCampaignId = CAMPAIGN_ID;
  setTimeout(() => { guide('sheet:open'); syncSheetGuides(); }, 1500);
  // The campaign's books add spells (their player part; the DM's monsters and story never come here).
  loadPlayerParts(SERVER_DATA?.campaigns?.[CAMPAIGN_ID], request).then(parts => { setBookParts(parts); if (parts.length) loadSRDSpells(); });
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

let _activeItemLib = {};
/** A shop's lines as cards: the item, its price, how many are left. */
function _shopLines(lines, itemLib) {
  return (lines || []).map((si, idx) => {
    const item = itemLib[si.itemId];
    return item ? { ...item, price: si.price, qty: si.qty ?? 1, slotId: si.slotId || (si.itemId + '_' + idx) } : null;
  }).filter(Boolean);
}

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

  _activeItemLib = itemLib;
  const shopItems = _shopLines(shopDef.items, itemLib);

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
  _shopGold = gold;
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
            ((it.effects || []).length
              ? '<div style="font-size:10px;color:var(--dnd-gold);margin-bottom:8px">✦ ' + it.effects.map(e => esc(effectLabel(e))).join(' · ') + '</div>'
              : '') +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
              '<span style="font-size:12px;font-weight:700;color:var(--dnd-gold)">' + it.price + ' gp</span>' +
              (!canAfford
                ? '<span style="font-size:9px;color:#f97316">⚠ only ' + gold + ' gp</span>'
                : '') +
              // No gold, no purchase: the cost used to be taken with a floor of 0, so 0 gp bought anything.
              (canAfford
                ? '<button data-itemid="' + esc(it.id) + '" data-itemname="' + esc(it.name) + '" data-price="' + it.price + '" data-slotid="' + esc(slotKey) + '" class="shop-interest-btn" ' +
                  'style="padding:4px 12px;border-radius:6px;border:1px solid rgba(212,175,55,.4);background:rgba(212,175,55,.1);color:var(--dnd-gold);cursor:pointer;font-size:10px;font-weight:700">Declare Interest</button>'
                : '<button disabled style="padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:10px;font-weight:700;cursor:not-allowed">Not enough gold</button>') +
            '</div>' +
          '</div>'
        ) : '';

        return '<div data-slotkey="' + esc(slotKey) + '" class="shop-item-card" ' +
          'style="padding:10px;background:var(--surface);border:1px solid ' + (expanded ? 'rgba(212,175,55,.5)' : 'var(--border)') + ';border-radius:8px;margin-bottom:8px;cursor:pointer">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            imgHtml +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:12px;font-weight:600;color:var(--text)">' + esc(it.name) + '</div>' +
              '<div style="font-size:10px;color:var(--muted)">' + esc(it.type) + (it.qty > 1 ? ' · ' + it.qty + ' left' : '') + '</div>' +
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
        type: EV.LOOT_INTEREST,
        contestKey, slotId,
        tokenId: null, shopId: _activeShopId,
        itemId, itemName,
        price, source: 'shop',
        userId: USER_ID,
        displayName: CHAR?.name || USER_ID,
        campaignId: CAMPAIGN_ID, fromUserId: USER_ID,
      };
      // Players cannot publish to the DM's sidebar (no consent → 403); the DM's Hub hands it on.
      publishTo(['hub'], EV.LOOT_INTEREST, payload).catch(() => {});
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
  // The weapon in the hero's hands: forged effect, or the SRD weapon with their own modifiers.
  const prof = weaponProfile(item, effectiveChar() || CHAR);
  if (!prof) return;
  const weaponEffect = { type: 'weapon', toHit: (prof.toHit >= 0 ? '+' : '') + prof.toHit, damage: prof.damage, damageType: prof.damageType };

  const toHitMod = parseToHitMod(weaponEffect.toHit);
  _pendingWeaponAttack = { item, weaponEffect, equipIdx };

  setDiceRollLabel(`${item.name} — Attack`, toHitMod);
  // The Hub checks reach, the turn and attacks left before it throws (dnd-hub-combat.js preAttack).
  // Weapon mastery (2024 Table rule): the Hub applies Graze and Vex and tells the table the rest (lk-mastery.js).
  const hero = { ...(effectiveChar() || CHAR), masteries: heroMasteries(CHAR) };
  rollDice('attack', { reach: weaponReach(item), perAction: attacksPerAction(CHAR.features), mastery: masteryFor(hero, item, masteryOn()) });
}

/**
 * What a roll of mine was for: a weapon's to-hit, then its damage; a healing item; my initiative. Runs for the Hub's
 * dice and for the sheet's own fallback roll alike — the fallback used to show the number and drop the rest.
 */
async function _afterMyRoll(p) {
  // My initiative (Table rules: playersRollInitiative), thrown with the table's dice.
  if (_pendingInitiative) {
    _pendingInitiative = false;
    _showPlayerToast(`Initiative: ${p.result}`);
    await publishTo(['hub'], EV.INITIATIVE_ROLL, { campaignId: CAMPAIGN_ID, userId: USER_ID, roll: p.result, fromUserId: USER_ID });
    return;
  }

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
    // Players cannot publish to the DM's sidebar (no consent → 403); the DM's Hub hands it on.
    await publishTo(['hub'], EV.WEAPON_ATTACK, attackPayload);
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
    await publishTo(['hub'], EV.WEAPON_ATTACK, damagePayload);
    return;
  }

  // Healing consumable phase
  if (_pendingHealItem) {
    const { item } = _pendingHealItem;
    _pendingHealItem = null;

    const healAmount = p.result;
    const effectiveStats = computeEffectiveStats(CHAR);
    // Healing from 0 wakes the hero and clears death saves (lk-rules5e).
    Object.assign(CHAR, applyHealing({ ...CHAR, hpMax: effectiveStats.hpMax }, healAmount), { hpMax: CHAR.hpMax });
    window.CHAR = CHAR;
    saveChar();
    renderAll();

    _showPlayerToast(`🧪 ${item.name}: healed ${healAmount} HP`);
    announceHp(`${item.name} (healing)`);
    return;
  }

}

/** My initiative: d20 + DEX modifier, sent to the DM's tracker (Table rules: playersRollInitiative). */
let _pendingInitiative = false;
async function rollInitiativeNow() {
  if (!CHAR || !needsMyRoll(_initiative, USER_ID) || _pendingInitiative) return;
  setNeedsInitiativeRoll(false);
  renderCombat(_initiativeActive);
  // The real dice, on the table like every other roll (it was a hidden random number). _afterMyRoll sends it to the
  // DM's tracker — via the Hub: players cannot publish to the DM's sidebar (403).
  _pendingInitiative = true;
  setDiceRollLabel('Initiative', abilityMod((effectiveChar() || CHAR).dex));
  await rollDice('initiative');
}

function weaponRollDamage() {
  if (!_pendingWeaponDamage) return;
  const { item, weaponEffect, toHitRoll } = _pendingWeaponDamage;
  // A natural 20 doubles the damage dice (not the modifier) — audit G3.
  const crit = toHitRoll === 20;
  const parsed = parseDiceExpr(crit ? critDamageExpr(weaponEffect.damage) : weaponEffect.damage);
  if (!parsed) return;

  selectedDie = 'd' + parsed.sides;
  selectDie('d' + parsed.sides);
  document.getElementById('dice-count').value = parsed.count;
  document.getElementById('dice-mod').value = parsed.mod;
  document.getElementById('roll-label').textContent = `${item.name} — ${crit ? 'CRITICAL ' : ''}Damage (${weaponEffect.damageType})`;
  rollDice('damage');
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

  // The tavern: my Hub asks for my purse and takes my bet; the DM's Hub pays my winnings (dnd-player-tavern.js).
  if (await handleTavern(ev, {
    char: CHAR, eff: CHAR ? effectiveChar() : null, campaignId: CAMPAIGN_ID, userId: USER_ID,
    dmUserId: SERVER_DATA?.campaigns?.[CAMPAIGN_ID]?.dmUserId,
    save: async () => { await saveChar(); renderAll(); },
    addItem: id => { const item = _resolveItemFromLibrary(id); return item && _addItemToChar(item, 1, 0) ? item.name : null; },
    toast: _showPlayerToast,
  })) return;

  // The Hub switched campaign, or the player just joined or finished a character:
  // re-pick instead of waiting for a reload.
  if (p.type === EV.CAMPAIGN_ACTIVE) {
    // No campaign open at the Hub (lobby, the Hero Forge): close the sheet.
    if (!p.campaignId) { _hubState = 'none'; _announcedCampaignId = null; _announcedRole = null; _initGen++; clearTimeout(_loadRetryTimer); CAMPAIGN_ID = null; CHAR = null; sealTable(); return; }
    const wasSealed = _hubState !== 'open' && _hubState !== 'fallback';
    _hubState = 'open';
    const changed = p.campaignId !== CAMPAIGN_ID || wasSealed;
    _announcedCampaignId = p.campaignId || null;
    _announcedRole = p.role || null;
    // A player opened a campaign: ask the host to show this panel (sidebar focus). The
    // host ignores it once the user has picked a panel themselves; older hosts ignore it.
    if (p.role === 'player') parent.postMessage({ type: 'dissent:slot-action', action: 'focus' }, '*');
    if (changed || !CHAR) onInit({});
    return;
  }

  // The DM levelled heroes up or gave XP: the campaign record changed; the Level up button may appear.
  if (p.type === EV.LEVEL_GRANT && p.campaignId === CAMPAIGN_ID) {
    const camp = SERVER_DATA?.campaigns?.[CAMPAIGN_ID];
    if (camp) {
      if (p.levels) camp.levels = { ...(camp.levels || {}), ...p.levels };
      if (p.xp) camp.xp = { ...(camp.xp || {}), ...p.xp };
    }
    renderAll();
    return;
  }

  // The Hub saved my hero (a level-up, or a new hero): reload it.
  if (p.type === EV.HERO_UPDATED && p.userId === USER_ID && p.campaignId === CAMPAIGN_ID) {
    onInit({});
    return;
  }

  // DM edited this player's sheet — reload from server storage and re-render
  if (p.type === 'sheet:dm-update' && p.userId === USER_ID) {
    storageGetCompanion('dnd-hub', `player_sheet_${CAMPAIGN_ID}_${USER_ID}`, 'server').then(updated => {
      if (!updated) return;
      CHAR = migrateChar(updated);
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

  // My Hub refused a weapon attack before throwing (out of reach, not my turn, no attacks left, no target).
  if (p.type === 'attack:refused' && p.ts === _pendingPhysicsRollTs) {
    clearTimeout(_pendingPhysicsRollTimer);
    _pendingPhysicsRollTimer = null;
    _pendingPhysicsRollTs = null;
    _pendingWeaponAttack = null;
    document.getElementById('roll-result').textContent = '—';
    document.getElementById('roll-breakdown').textContent = '';
    _showPlayerToast(p.reason || 'That attack is not possible now.');
    return;
  }

  // Physics roll result returned from dnd-hub (or bounced back via realtime)
  if (p.type === EV.DICE_ROLL && p.userId === USER_ID && _pendingPhysicsRollTs !== null) {
    clearTimeout(_pendingPhysicsRollTimer);
    _pendingPhysicsRollTimer = null;
    _pendingPhysicsRollTs = null;
    _applyRollResult(p);
    await _afterMyRoll(p);

    return;
  }

  // My own HP announcements coming back (announceHp): the sheet already holds them. The DM's changes to my HP are
  // handled further down, through the rules (temporary HP, 0 HP, death saves, massive damage). This block used to
  // catch every HP change first and copy the bare number, so those rules never ran (rules playtest, 2026-10-04).
  if (p.type === 'hp:change' && USER_ID && p.fromUserId === USER_ID) return;

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

  // The DM started the evening: the recap is now a page in the party journal.
  if (p.type === EV.SESSION_START && p.campaignId === CAMPAIGN_ID) {
    if (isRepeat(p)) return;
    renderPartyJournal().catch(() => {});
    _showPlayerToast('The session begins.');
    return;
  }

  // A companion's summary changed (their HP, conditions, death saves): redraw my strip.
  if (p.type === EV.PARTY_UPDATE && p.campaignId === CAMPAIGN_ID) {
    if (isRepeat(p) || p.fromUserId !== p.userId || p.userId === USER_ID || !p.summary) return;
    SERVER_DATA = SERVER_DATA || { campaigns: {} };
    const camp = SERVER_DATA.campaigns[CAMPAIGN_ID] = SERVER_DATA.campaigns[CAMPAIGN_ID] || {};
    camp.characterSummaries = { ...(camp.characterSummaries || {}), [p.userId]: p.summary };
    renderPartyStrip();
    return;
  }

  // The DM changed the Table rules: they apply here at once.
  if (p.type === EV.COMBAT_SETTINGS && p.campaignId === CAMPAIGN_ID) {
    if (isRepeat(p)) return;
    SERVER_DATA = SERVER_DATA || { campaigns: {} };
    SERVER_DATA.campaigns[CAMPAIGN_ID] = { ...(SERVER_DATA.campaigns[CAMPAIGN_ID] || {}), settings: p.settings };
    return;
  }

  // Initiative state changed — show/hide action economy; ask for my roll; remind me of death saves
  if (p.type === 'initiative:update') {
    if (isRepeat(p)) return;
    _initiative = p.initiative;
    _initiativeActive = !!p.initiative?.active;
    setInitiativeData(p.initiative);
    const mustRoll = needsMyRoll(p.initiative, USER_ID);
    setNeedsInitiativeRoll(mustRoll);
    renderCombat(_initiativeActive);
    if (mustRoll) { switchTab('combat'); _showPlayerToast('Combat! Roll initiative.'); }
    const turn = deathSaveTurn(p.initiative, USER_ID, CHAR, _deathPromptKey);
    if (turn && tableRule('deathSaves')) {
      _deathPromptKey = turn;
      switchTab('main');
      document.getElementById('death-saves-section')?.scrollIntoView({ block: 'center' });
      _showPlayerToast('Your turn at 0 HP: roll a death save.');
    }
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
    showHandout({ title: p.title, content: p.content, imageFileId: p.imageFileId });
    if (p.journalId) renderPartyJournal().catch(() => {});
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
    // Only a place in squares counts: an older Hub sent pixels, which no zone can be compared with.
    if (!p.cell) return;
    _myTokenPos = { x: p.cell.x, y: p.cell.y };
    recomputeZoneVolumes().catch(() => {});
    return;
  }

  if (p.type === EV.TRIGGER_FIRED && p.campaignId === CAMPAIGN_ID) {
    if (isRepeat(p)) return;
    if (p.action === 'trap' && p.tokenId === 'player_' + USER_ID && CHAR) {
      // The trap hit me. The table either rolls my save (trapSavesAuto) or asks me to; half damage on a success,
      // then temporary HP, 0 HP and death saves as usual (audit H1, N1).
      if (p.saveAbility && p.saveDC && !tableRule('trapSavesAuto')) { _showTrapPrompt(p); return; }
      await _takeTrap(p, Math.floor(Math.random() * 20) + 1);
      return;
    }
    if (p.message) _showPlayerToast(p.message);
    return;
  }

  // HP changed by the DM (initiative tracker, map) for MY token: apply it to the sheet, which is where a
  // hero's HP lives. Damage and healing amounts go through the rules (a critical hit at 0 HP is two failures); a plain
  // value is the DM's word, with what reaching 0 or leaving it means (setHp).
  if (p.type === EV.HP_CHANGE && p.tokenId === 'player_' + USER_ID && p.fromUserId !== USER_ID && CHAR) {
    if (isRepeat(p)) return;
    const eff = computeEffectiveStats(CHAR);
    const base = { ...CHAR, hpMax: eff.hpMax };
    const next = p.damage ? applyDamage(base, p.damage, { crit: !!p.crit }) : p.heal ? applyHealing(base, p.heal)
      : setHp(base, p.hp ?? CHAR.hp);
    const lost = (CHAR.hp || 0) + (CHAR.hpTemp || 0) - ((next.hp || 0) + (next.hpTemp || 0));
    Object.assign(CHAR, next, { hpMax: CHAR.hpMax });
    await saveChar();
    renderAll();
    if (CHAR.concentration && !CHAR.dead) _concentrationCheck(p.damage || Math.max(0, lost));
    // The DM's map guessed the HP (it does not know temporary HP or death): when the rules came out differently,
    // the map is told the hero's real HP, or the token would show one number and the sheet another.
    if (p.hp != null && (CHAR.hp !== p.hp || CHAR.dead)) announceHp('rules');
    return;
  }

  if (p.type === EV.SHOP_OPEN && p.campaignId === CAMPAIGN_ID) {
    _openShopTab(p.shopId).catch(() => {});
    return;
  }

  // The DM closed the shop for everyone (the Hub's "Close shop" button).
  if (p.type === 'shop:close' && p.campaignId === CAMPAIGN_ID) { if (_activeShopId) _closeShopTab(); return; }

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
        // Gold spent since the interest was declared: the hero cannot pay, so nothing changes hands, and the DM is
        // told (players cannot publish to the DM sidebar: my Hub → the DM's Hub → their sidebar, as for interest).
        // The winner is told either way (owner, 2026-10-05: nothing said who won or where the item went).
        if (!_addItemToChar(item, 1, p.goldCost || 0)) {
          publishTo(['hub'], 'loot:declined', { campaignId: CAMPAIGN_ID, itemId: p.itemId, itemName: item.name,
            goldCost: p.goldCost || 0, userId: USER_ID, name: CHAR.name || '', shopId: p.shopId || null, slotId: p.slotId || null }).catch(() => {});
          _showPlayerToast(`You won ${item.name}, but no longer have the ${p.goldCost || 0} gp to pay for it.`);
        } else {
          _showPlayerToast(`🎉 You got ${item.name}${p.goldCost ? ` for ${p.goldCost} gp` : ''}! It is in your inventory.`);
        }
        // Clear the pending reward so onInit doesn't add it again as a duplicate (or try a sale that failed again)
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
    // The sale is settled for everyone who wanted it: the shop shows its buttons again (and the gold left), so a
    // second one can be bought. They stayed on "✓ Interested" until the shop was reopened (rules playtest).
    if (p.shopId && p.shopId === _activeShopId) {
      // The DM sends what is left on the shelf: the item sold is gone (or one fewer) on every screen.
      if (Array.isArray(p.shopItems)) {
        _activeShopItems = _shopLines(p.shopItems, _activeItemLib);
        if (_activeShopData) _activeShopData.shop = { ..._activeShopData.shop, items: p.shopItems };
      }
      _renderShopTab(_activeShopItems || []);
    }
    return;
  }
}

// The Level up button opens the level-up scene in the map area (dnd-hub-levelup.js): the Hub runs it and saves.
function startLevelUp() {
  localPublish('dnd-hub', EV.LEVELUP_OPEN, { type: EV.LEVELUP_OPEN, campaignId: CAMPAIGN_ID, userId: USER_ID });
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
    '<div style="background:#1a1a2e;border:1px solid rgba(212,175,55,.4);border-radius:12px;padding:18px;width:100%;max-width:380px;color:var(--lk-text)">' +
      '<div style="font-size:13px;font-weight:800;color:var(--lk-gold);margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">' +
        '✏️ Edit Character' +
        '<button onclick="document.getElementById(\'char-edit-overlay\').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;padding:0">&times;</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;align-items:center;margin-bottom:12px">' +
        '<div id="ce-portrait-preview" style="width:72px;height:72px;border-radius:50%;background:#2a2a40;border:2px solid rgba(212,175,55,.4);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:6px">' +
          (CHAR.portraitFileId ? '<img id="ce-portrait-img" style="width:100%;height:100%;object-fit:cover">' : '🧙') +
        '</div>' +
        '<button onclick="document.getElementById(\'ce-portrait-input\').click()" style="font-size:10px;padding:4px 10px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.3);border-radius:5px;color:var(--lk-gold);cursor:pointer">📷 ' + (CHAR.portraitFileId ? 'Change Portrait' : 'Upload Portrait') + '</button>' +
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
      '<div style="display:flex;gap:8px">' +
        '<button onclick="document.getElementById(\'char-edit-overlay\').remove()" style="flex:1;padding:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:var(--lk-muted);cursor:pointer;font-size:12px">Cancel</button>' +
        '<button id="ce-save-btn" style="flex:2;padding:8px;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.4);border-radius:6px;color:var(--lk-gold);cursor:pointer;font-size:12px;font-weight:700">Save Changes</button>' +
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
    // Portrait upload
    const fileInput = document.getElementById('ce-portrait-input');
    if (fileInput?.files[0]) {
      try {
        const file = fileInput.files[0];
        const buf  = await file.arrayBuffer();
        const res  = await guarded(request)('files:upload', { data: buf, name: file.name, mime: file.type, maxSide: 1024 }); // a portrait: shrunk in lk-upload.js
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
window.toggleDeathSave = toggleDeathSave; window.rollDeathSaveNow = rollDeathSaveNow; window.changeExhaustion = changeExhaustion;
window.rollAbilityCheck = rollAbilityCheck; window.rollSkillCheck = rollSkillCheck;
window.debounceSaveNotes = debounceSaveNotes; window.toggleEquipped = toggleEquipped;
window.toggleSpellExpand = toggleSpellExpand; window.expendSpellSlot = expendSpellSlot;
window.castSpell          = castSpell;
window.clearConcentration = clearConcentration;
window.toggleAction = toggleAction;
window.clearActionEconomy = clearActionEconomy;
window.toggleResourcePip = toggleResourcePip;
window.startLevelUp        = startLevelUp;
window.renderAll           = renderAll;
window.toggleFeatureExpand  = toggleFeatureExpand;
window.saveFeatureDesc      = saveFeatureDesc;
window.toggleInventoryItem  = toggleInventoryItem;
window.useConsumable        = useConsumable;
window.removeInventoryItem  = removeInventoryItem;
window.openCharEdit        = openCharEdit;
window.weaponAttack        = weaponAttack;
window.toggleMastery       = toggleMastery;
window.weaponRollDamage    = weaponRollDamage;
window.rollInitiativeNow   = rollInitiativeNow;
window.useConsumable       = useConsumable;
window.__announceHp        = announceHp;
// What each sound zone is doing on this screen, for the playtests (read only).
window.__zoneVolumes = () => Object.fromEntries(Object.entries(_zoneAudioEls).map(([id, a]) => [id, Math.round(a.volume * 1000) / 1000]));
window.__zonePlaying = () => Object.fromEntries(Object.entries(_zoneAudioEls).map(([id, a]) => [id, !a.paused]));

// Wrap doShortRest / doLongRest to also restore class resources
const _origShortRest = doShortRest;
const _origLongRest  = doLongRest;
// Only when the rest was actually taken — cancelling the dialog used to restore resources anyway.
window.doShortRest = async () => { if (await _origShortRest()) { restoreResourcesOnShortRest(CHAR); await saveChar(); renderResources(); renderSpells(); announceHp('Short rest'); } };
window.doLongRest  = async () => { if (await _origLongRest())  { restoreResourcesOnLongRest(CHAR);  await saveChar(); renderResources(); renderSpells(); renderConcentration(); announceHp('Long rest'); } };

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
  // A small chip at the top, clear of the dice bar it used to cover.
  banner.style.cssText = 'position:fixed;top:6px;right:6px;background:var(--lk-panel);border:1px solid var(--lk-line);border-radius:999px;padding:3px 10px;font-size:10px;color:var(--lk-muted);pointer-events:none;z-index:9999';
  banner.textContent = 'Sound off · click to enable';
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

// The sheet's lantern button: guides on (every tip starts over) or off (lk-guides.js; shared with the Hub).
async function syncSheetGuides() { document.getElementById('sheet-guides')?.setAttribute('aria-pressed', String(await guidesOn())); }
window.toggleSheetGuides = async () => {
  const on = !(await guidesOn());
  await setGuidesOn(on);
  syncSheetGuides();
  if (on) guide('sheet:open');
};
