// dnd-player-sheet.js — character sheet rendering + HP/action functions
import { esc, realtimePublish, localPublish } from '../plugin-sdk.js';
import { guide } from './lk-guide-ui.js';
import { EV } from './dnd-hub-event-types.js';
import { publishTo } from './lk-bus.js';
import { allowedLevel } from './lk-levelling.js';
import { featureDesc } from './lk-features.js';
import { rule } from './lk-table-rules.js';
import { applyDamage, applyHealing, markDeathSave, rollDeathSave, shortRestSpend, longRest, hitDieFor, profBonus as profBonusFor,
  armorClass, weaponProfile } from './lk-rules5e.js';

const ABILITIES = ['str','dex','con','int','wis','cha'];
const ABILITY_NAMES = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };
const CONDITIONS = ['Blinded','Charmed','Deafened','Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone','Restrained','Stunned','Unconscious'];
const SKILLS = [
  {name:'Acrobatics',ability:'dex'},{name:'Animal Handling',ability:'wis'},{name:'Arcana',ability:'int'},{name:'Athletics',ability:'str'},
  {name:'Deception',ability:'cha'},{name:'History',ability:'int'},{name:'Insight',ability:'wis'},{name:'Intimidation',ability:'cha'},
  {name:'Investigation',ability:'int'},{name:'Medicine',ability:'wis'},{name:'Nature',ability:'int'},{name:'Perception',ability:'wis'},
  {name:'Performance',ability:'cha'},{name:'Persuasion',ability:'cha'},{name:'Religion',ability:'int'},{name:'Sleight of Hand',ability:'dex'},
  {name:'Stealth',ability:'dex'},{name:'Survival',ability:'wis'},
];

function abilityMod(score) { return Math.floor((score - 10) / 2); }
function fmtMod(m) { return m >= 0 ? `+${m}` : `${m}`; }

const XP_THRESHOLDS_SHEET = [0,0,300,900,2700,6500,14000,23000,34000,48000,
  64000,85000,100000,120000,140000,165000,195000,225000,265000,305000,355000];

// What each feature does: lk-features.js (shared with the Hub). Feats' text comes from the SRD feats, read once.
let _feats = [];
fetch(new URL('./dnd-srd/feats.json', document.baseURI).href).then(r => r.ok ? r.json() : [])
  .then(f => { _feats = Array.isArray(f) ? f : []; renderFeatures(); }).catch(() => {});

let _char = null;
let _saveChar = null;
let _userId = null;
let _campaignId = null;
let _setDiceLabel = null;
let _rollDice = null;
let _pendingDamageIdx = null; // equipment index waiting for damage roll
let _effectiveStats = { ac: 10, hpMax: 0, abilities: {}, extraConditions: [] };
let _inventoryImageUrls = {};
const _expandedInvItems = new Set();

/**
 * Tell the Hub (the token) and the DM sidebar the hero's HP. One place, with the token id the Hub matches on;
 * players cannot publish to the DM sidebar (no consent → 403), so the DM's Hub hands it on.
 * the old broadcasts had no campaign or token id and reached only other copies of this sidebar (audit N1).
 */
export async function announceHp(source) {
  if (!_char || !_userId) return;
  await publishTo(['hub'], EV.HP_CHANGE, {
    campaignId: _campaignId, tokenId: 'player_' + _userId, userId: _userId, fromUserId: _userId,
    hp: _char.hp, hpMax: _effectiveStats.hpMax || _char.hpMax, hpTemp: _char.hpTemp || 0,
    dead: !!_char.dead, source, name: _char.name || 'Player',
  }).catch(() => {});
}

let _getCampaign = () => null;
/** Where the sheet reads the campaign record (levels, xp, settings): set once by dnd-player-main.js. */
export function setCampaignGetter(fn) { _getCampaign = fn; }

export function setSheetState(char, saveCharFn, userId, setDiceLabel, rollDice, campaignId) {
  _char = char; _saveChar = saveCharFn; _userId = userId;
  _campaignId = campaignId ?? null;
  _setDiceLabel = setDiceLabel; _rollDice = rollDice;
}

export function setInventoryImageUrls(urls) { _inventoryImageUrls = urls || {}; }

export function setPendingDamageIdx(idx) {
  _pendingDamageIdx = idx;
  renderInventory();
}

export function clearPendingDamageIdx() {
  _pendingDamageIdx = null;
}

export function computeEffectiveStats(char) {
  const equipped = (char.equipment || []).filter(i => i.equipped);
  const allEffects = equipped.flatMap(i => i.effects || []);

  const dexMod = Math.floor(((char.dex || 10) - 10) / 2);
  const armorEffect = allEffects.find(e => e.type === 'armor');
  let baseAC;
  if (armorEffect) {
    const dexBonus = armorEffect.addDex
      ? Math.min(dexMod, armorEffect.maxDex !== undefined ? armorEffect.maxDex : Infinity)
      : 0;
    baseAC = armorEffect.ac + dexBonus;
    if (equipped.some(i => i.id === 'shield')) baseAC += 2;
  } else {
    // SRD armour and shields by id, and Unarmored Defense (audit A5): worn chain mail used to count for nothing.
    baseAC = armorClass(char, equipped);
  }
  if (allEffects.some(e => e.type === 'shield') && !equipped.some(i => i.id === 'shield')) baseAC += 2;
  const acBonuses = allEffects
    .filter(e => e.type === 'ac_bonus')
    .reduce((sum, e) => sum + e.value, 0);
  const ac = baseAC + acBonuses;

  const hpMaxBonuses = allEffects
    .filter(e => e.type === 'hp_max_bonus')
    .reduce((sum, e) => sum + e.value, 0);
  const hpMax = (char.hpMax || 0) + hpMaxBonuses;

  const abilities = {};
  for (const a of ABILITIES) {
    const bonus = allEffects
      .filter(e => e.type === 'ability_bonus' && e.ability === a)
      .reduce((sum, e) => sum + e.value, 0);
    abilities[a] = (char[a] || 10) + bonus;
  }

  const extraConditions = allEffects
    .filter(e => e.type === 'condition_self')
    .map(e => e.condition);

  return { ac, hpMax, abilities, extraConditions };
}

/** The character with item bonuses applied to the ability scores — what attacks are rolled with. */
export function effectiveChar() {
  return _char ? { ..._char, ...(_effectiveStats.abilities || {}) } : null;
}

let _shownConds = null; // my conditions as last drawn: a new one plays its effect on my map (dnd-hub-condition-fx.js)
export function renderAll() {
  if (!_char) return;
  const conds = [...(_char.conditions || [])];
  if (_shownConds) {
    const fresh = conds.filter(c => !_shownConds.includes(c));
    if (fresh.length) localPublish('dnd-hub', 'conditions:fx', { type: 'conditions:fx', conditions: fresh });
  }
  _shownConds = conds;
  _effectiveStats = computeEffectiveStats(_char);
  renderHeader(); renderMain(); renderAbilities(); renderInventory(); renderFeatures(); renderNotes();
}

export function renderHeader() {
  document.getElementById('char-name').textContent = _char.name || 'Unknown';
  document.getElementById('char-subtitle').textContent = `${_char.race || '?'} ${_char.class || '?'} · Level ${_char.level || 1}`;
}

export function renderMain() {
  const effHpMax = _effectiveStats.hpMax || _char.hpMax || 0;
  const pct = effHpMax > 0 ? Math.max(0, Math.min(100, (_char.hp / effHpMax) * 100)) : 0;
  document.getElementById('hp-cur').textContent = _char.hp ?? '—';
  document.getElementById('hp-max').textContent = effHpMax || '—';
  const bar = document.getElementById('hp-bar');
  bar.style.width = pct + '%';
  bar.style.background = pct > 50 ? '#22c55e' : pct > 25 ? '#f59e0b' : '#ef4444';
  document.getElementById('temp-hp').value = _char.hpTemp || 0;
  document.getElementById('stat-ac').textContent = _effectiveStats.ac ?? _char.ac ?? '—';
  document.getElementById('stat-init').textContent = fmtMod(abilityMod((_effectiveStats.abilities['dex'] ?? _char.dex) ?? 10));
  document.getElementById('stat-speed').textContent = (_char.speed || 30) + 'ft';
  document.getElementById('stat-insp').textContent = _char.inspiration ? '★' : '☆';
  const extraConds = _effectiveStats.extraConditions || [];
  document.getElementById('conditions-grid').innerHTML =
    CONDITIONS.map(c =>
      `<div class="condition-chip ${(_char.conditions||[]).includes(c)?'active':''}" onclick="toggleCondition('${c}')">${c}</div>`
    ).join('') +
    extraConds.map(c =>
      `<div class="condition-chip active" style="color:#f0c040;border-color:#f0c040" title="From equipped item">${esc(c)}</div>`
    ).join('');
  document.getElementById('exhaustion-level').textContent = _char.exhaustion || 0;
  const dsSection = document.getElementById('death-saves-section');
  dsSection.style.display = (_char.hp <= 0) ? 'block' : 'none';
  if (_char.hp <= 0 && !_char.dead) guide('sheet:down');
  if (_char.hp <= 0) renderDeathSaves();
  const dsState = document.getElementById('death-save-state');
  if (dsState) {
    dsState.textContent = _char.dead ? '💀 Dead' : _char.stable ? 'Stable — unconscious at 0 HP' : 'Dying — roll at the start of your turn';
    dsState.style.color = _char.dead ? '#ef4444' : _char.stable ? '#22c55e' : 'var(--muted)';
  }
  const dsRoll = document.getElementById('death-save-roll');
  if (dsRoll) dsRoll.style.display = (_char.dead || _char.stable) ? 'none' : '';

  // Level-up banner
  const levelBanner = document.getElementById('levelup-banner');
  if (levelBanner) {
    // The DM's campaign record decides (milestone grants, or the XP the DM gave); players cannot edit their level.
    const camp = _getCampaign();
    const ready = (_char.level || 1) < allowedLevel(camp, _userId, _char, rule(camp?.settings, 'levelByXp'));
    levelBanner.style.display = ready ? 'block' : 'none';
    if (ready) guide('sheet:levelup');
  }

  // XP progress bar
  const xpEl = document.getElementById('xp-bar-section');
  const campXp = _getCampaign();
  if (xpEl && !rule(campXp?.settings, 'levelByXp')) xpEl.innerHTML = '';
  else if (xpEl) {
    const xp  = campXp?.xp?.[_userId] ?? _char.xp ?? 0;
    const lvl = Math.min(_char.level || 1, 20);
    if (lvl >= 20) {
      xpEl.innerHTML = '<div style="font-size:9px;text-align:center;color:var(--dnd-gold);padding:2px 0">⭐ Max Level (' + xp.toLocaleString() + ' XP)</div>';
    } else {
      const prevXP = XP_THRESHOLDS_SHEET[lvl] || 0;
      const nextXP = XP_THRESHOLDS_SHEET[lvl + 1] || prevXP + 1;
      const range  = nextXP - prevXP;
      const pct    = range > 0 ? Math.max(0, Math.min(100, ((xp - prevXP) / range) * 100)) : 0;
      xpEl.innerHTML =
        '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-bottom:2px">' +
          '<span>XP</span><span>' + xp.toLocaleString() + ' / ' + nextXP.toLocaleString() + '</span>' +
        '</div>' +
        '<div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden">' +
          '<div style="width:' + pct + '%;height:100%;background:#a855f7;border-radius:2px"></div>' +
        '</div>';
    }
  }
}

export function renderDeathSaves() {
  const ds = _char.deathSaves || { successes: 0, failures: 0 };
  ['success','failure'].forEach(type => {
    const el = document.getElementById(`death-${type}-pips`);
    el.innerHTML = [0,1,2].map(i =>
      `<div class="save-pip ${type} ${i < ds[type+'es'] ? 'filled' : ''}" onclick="toggleDeathSave('${type}',${i})"></div>`
    ).join('');
  });
}

export function renderAbilities() {
  document.getElementById('ability-grid').innerHTML = ABILITIES.map(a => {
    const score = _effectiveStats.abilities[a] ?? _char[a] ?? 10;
    return `
    <div class="ability-card" onclick="rollAbilityCheck('${a}')">
      <div class="ability-name">${ABILITY_NAMES[a]}</div>
      <div class="ability-score">${score}</div>
      <div class="ability-mod">${fmtMod(abilityMod(score))}</div>
    </div>`;
  }).join('');
  const profBonus = profBonusFor(_char.level);
  const saves = _char.savingThrows || [];
  document.getElementById('saving-throws').innerHTML = ABILITIES.map(a => {
    const isProficient = saves.includes(a);
    const score = _effectiveStats.abilities[a] ?? _char[a] ?? 10;
    const bonus = abilityMod(score) + (isProficient ? profBonus : 0);
    // Clicking rolls it, like a skill (owner, 2026-10-05: saves did nothing).
    return `<div class="skill-row" onclick="rollSkillCheck('${ABILITY_NAMES[a]} Saving Throw',${bonus})">
      <div class="skill-prof-dot ${isProficient?'proficient':''}"></div>
      <span class="skill-name">${ABILITY_NAMES[a]} Saving Throw</span>
      <span class="skill-bonus" style="color:var(--dnd-gold)">${fmtMod(bonus)}</span>
    </div>`;
  }).join('');
  document.getElementById('skills-list').innerHTML = SKILLS.map(sk => {
    const profState = (_char.skills || {})[sk.name] || 'none';
    const score = _effectiveStats.abilities[sk.ability] ?? _char[sk.ability] ?? 10;
    const mod = abilityMod(score);
    const bonus = mod + (profState === 'expertise' ? profBonus * 2 : profState === 'proficient' ? profBonus : 0);
    return `<div class="skill-row" onclick="rollSkillCheck('${sk.name}',${bonus})">
      <div class="skill-prof-dot ${profState !== 'none' ? profState : ''}"></div>
      <span class="skill-name">${sk.name} <span style="color:var(--dim);font-size:9px">(${ABILITY_NAMES[sk.ability]})</span></span>
      <span style="font-size:9px;color:var(--muted);margin-right:4px">P:${10+bonus}</span>
      <span class="skill-bonus" style="color:var(--dnd-gold)">${fmtMod(bonus)}</span>
    </div>`;
  }).join('');
}

export function effectLabel(e) {
  switch (e.type) {
    case 'weapon': return `⚔️ ${e.damageType || ''} weapon: ${e.toHit || 0} to hit, ${e.damage || '—'} damage`;
    case 'armor': {
      let s = `🛡️ Armor: AC ${e.ac}`;
      if (e.addDex) s += ' + DEX';
      if (e.maxDex !== undefined) s += ` (max +${e.maxDex})`;
      return s;
    }
    case 'shield': return '🛡️ Shield: +2 AC';
    case 'ac_bonus': return `✨ +${e.value} AC`;
    case 'hp_max_bonus': return `+${e.value} HP max`;
    case 'ability_bonus': return `+${e.value} ${(e.ability||'').toUpperCase()} (ability)`;
    case 'condition_self': return `⚠️ Condition while worn: ${e.condition}`;
    case 'condition_target': {
      let s = `💀 On hit: ${e.condition}`;
      if (e.saveDC) s += ` (DC ${e.saveDC} ${e.saveAbility || ''} save)`;
      return s;
    }
    case 'heal': return `💊 Heals ${e.dice}`;
    default: return e.type;
  }
}

function _invItemCard(item, idx) {
  const effects = Array.isArray(item.effects) ? item.effects : [];
  // Any weapon can attack: SRD weapons with the hero's own to-hit and damage, DM-forged ones as forged (audit G2).
  const profile = weaponProfile(item, effectiveChar() || {});
  const hasWeapon = !!profile;
  const effectsHtml = (() => {
    if (effects.length) {
      return effects.map(e =>
        `<div style="font-size:9px;color:var(--muted);margin-top:2px">${esc(effectLabel(e))}</div>`
      ).join('');
    }
    if (profile) {
      return `<div style="font-size:9px;color:var(--muted);margin-top:2px">⚔️ ${profile.toHit >= 0 ? '+' : ''}${profile.toHit} to hit · ${esc(profile.damage)} ${esc(profile.damageType)}</div>`;
    }
    if (item.effectsText) {
      return `<div style="font-size:9px;color:var(--muted);margin-top:2px">${esc(item.effectsText)}</div>`;
    }
    return '';
  })();
  const attackBtn = (hasWeapon && item.equipped)
    ? `<button onclick="window.weaponAttack(${idx})" style="margin-top:4px;font-size:10px;padding:3px 8px;background:var(--dnd-red,#b91c1c);border:none;border-radius:4px;color:#fff;cursor:pointer">⚔️ Attack</button>`
    : '';
  const damageBtn = (_pendingDamageIdx === idx)
    ? `<button onclick="window.weaponRollDamage()" style="margin-top:4px;font-size:10px;padding:3px 8px;background:var(--dnd-gold,#b8860b);border:none;border-radius:4px;color:#fff;cursor:pointer">🎲 Roll Damage</button>`
    : '';
  const useBtn = (item.type === 'consumable' || effects.some(e => e.type === 'heal'))
    ? `<button onclick="window.useConsumable(${idx})" style="margin-top:4px;font-size:10px;padding:3px 8px;background:var(--dnd-green,#15803d);border:none;border-radius:4px;color:#fff;cursor:pointer">🧪 Use</button>`
    : '';
  const isConsumable = item.type === 'consumable' || effects.some(e => e.type === 'heal');
  const imgUrl = _inventoryImageUrls[item.id] || _inventoryImageUrls[item.imageFileId];
  const imgHtml = imgUrl
    ? `<img src="${imgUrl}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0">`
    : '';
  const leftBtn = isConsumable
    ? `<button onclick="window.useConsumable(${idx})" style="font-size:10px;padding:3px 8px;background:rgba(21,128,61,.2);border:1px solid rgba(21,128,61,.4);border-radius:4px;color:#4ade80;cursor:pointer;flex-shrink:0;white-space:nowrap">🧪 Use</button>`
    : item.equipped
      ? `<button onclick="toggleEquipped(${idx},false)" style="font-size:10px;padding:3px 8px;background:rgba(212,175,55,.2);border:1px solid rgba(212,175,55,.5);border-radius:4px;color:var(--lk-gold);cursor:pointer;flex-shrink:0;white-space:nowrap">✦ Equipped</button>`
      : `<button onclick="toggleEquipped(${idx},true)" style="font-size:10px;padding:3px 8px;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:4px;color:var(--muted);cursor:pointer;flex-shrink:0;white-space:nowrap">Equip</button>`;
  return `
    <div style="padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px">
      <div style="display:flex;align-items:center;gap:8px">
        ${leftBtn}
        ${imgHtml}
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}</div>
          <div style="font-size:9px;color:var(--muted)">${isConsumable ? `Qty: ${item.qty||1}` : (item.attuned ? '✦ Attuned' : '')}</div>
        </div>
        <button onclick="removeInventoryItem(${idx})" title="Remove" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;flex-shrink:0">✕</button>
      </div>
      ${effectsHtml}
      ${attackBtn}${damageBtn}
    </div>`;
}

export function toggleInventoryItem(key) {
  if (_expandedInvItems.has(key)) _expandedInvItems.delete(key);
  else _expandedInvItems.add(key);
  renderInventory();
}

export function renderInventory() {
  const items = _char.equipment || [];
  document.getElementById('equipment-list').innerHTML = items.length
    // Equipped first (owner, 2026-10-05), otherwise in the order they were gained. Cards keep their real index.
    ? items.map((item, i) => [item, i]).sort((a, b) => !!b[0].equipped - !!a[0].equipped || a[1] - b[1])
      .map(([item, i]) => _invItemCard(item, i)).join('')
    : '<div style="font-size:11px;color:var(--muted)">No items in inventory.</div>';
  const currencies = [
    {key:'platinum',symbol:'pp',color:'var(--lk-text)'},
    {key:'gold',symbol:'gp',color:'var(--dnd-gold)'},
    {key:'electrum',symbol:'ep',color:'#a78bfa'},
    {key:'silver',symbol:'sp',color:'var(--lk-muted)'},
    {key:'copper',symbol:'cp',color:'#c2855c'},
  ];
  document.getElementById('currency-grid').innerHTML = currencies.map(c => `
    <div style="text-align:center;padding:8px 4px;background:var(--surface);border:1px solid var(--border);border-radius:6px">
      <input type="number" min="0" value="${_char[c.key]||0}"
        onchange="CHAR['${c.key}']=Math.max(0,parseInt(this.value)||0);saveChar()"
        style="width:100%;background:transparent;border:none;text-align:center;font-size:14px;font-weight:700;color:${c.color};outline:none">
      <div style="font-size:9px;color:var(--muted)">${c.symbol}</div>
    </div>`).join('');
  document.getElementById('attunement-count').textContent = (_char.equipment || []).filter(i => i.attuned).length;
}

const _expandedFeatures = new Set();

export function toggleFeatureExpand(idx) {
  if (_expandedFeatures.has(idx)) _expandedFeatures.delete(idx);
  else _expandedFeatures.add(idx);
  renderFeatures();
}

export async function saveFeatureDesc(idx, desc) {
  if (!_char?.features?.[idx] == null) return;
  const f = _char.features[idx];
  if (typeof f === 'string') _char.features[idx] = { name: f, desc };
  else if (f) f.desc = desc;
  await _saveChar();
}

export function renderFeatures() {
  const el = document.getElementById('features-list');
  if (!el) return;
  const features = _char?.features || [];
  if (!features.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted)">No features recorded.</div>';
    return;
  }
  // The description shows under the name (it used to sit behind a click, for a third of the features at most);
  // clicking opens the player's own notes.
  el.innerHTML = features.map((f, i) => {
    const name     = typeof f === 'string' ? f : (f.name || '');
    const notes    = typeof f === 'string' ? '' : (f.desc || '');
    const what     = featureDesc(name, { feats: _feats });
    const expanded = _expandedFeatures.has(i);
    return '<div style="background:var(--surface);border:1px solid var(--border);border-left:2px solid var(--dnd-gold);border-radius:6px;overflow:hidden">' +
      '<div style="padding:9px 10px;cursor:pointer" onclick="toggleFeatureExpand(' + i + ')">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<div style="font-size:12px;font-weight:600;flex:1">' + esc(name) + '</div>' +
          '<span style="font-size:10px;color:var(--muted)" title="Your notes">' + (notes ? '📝 ' : '') + (expanded ? '▲' : '▼') + '</span>' +
        '</div>' +
        (what ? '<div style="font-size:11px;color:var(--muted);line-height:1.45;margin-top:4px">' + esc(what) + '</div>' : '') +
      '</div>' +
      (expanded
        ? '<div style="padding:0 10px 10px">' +
            '<textarea placeholder="Your notes…" onblur="saveFeatureDesc(' + i + ',this.value)"' +
              ' style="width:100%;min-height:50px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:4px;' +
              'color:var(--text);font-size:11px;line-height:1.5;padding:6px;outline:none;resize:vertical;font-family:inherit;box-sizing:border-box">' +
              esc(notes) + '</textarea>' +
          '</div>'
        : '') +
    '</div>';
  }).join('');
}

export function renderNotes() {
  const el = document.getElementById('notes-area');
  if (el) el.value = _char.notes || '';
}

let _notesSaveTimeout;
export function debounceSaveNotes() {
  clearTimeout(_notesSaveTimeout);
  _notesSaveTimeout = setTimeout(async () => {
    _char.notes = document.getElementById('notes-area')?.value || '';
    await _saveChar();
  }, 800);
}

export async function changeHP(direction) {
  if (!_char) return;
  const delta = parseInt(document.getElementById('hp-delta').value, 10) || 0;
  if (delta <= 0) return;
  const prev = _char.hp;
  // Temporary HP soak damage first; 0 HP knocks you out, damage at 0 is a failed death save,
  // massive damage kills, and healing from 0 wakes you (lk-rules5e). Used to be bare arithmetic.
  const effMax = _effectiveStats.hpMax || _char.hpMax;
  const next = direction < 0
    ? applyDamage({ ..._char, hpMax: effMax }, delta)
    : applyHealing({ ..._char, hpMax: effMax }, delta);
  Object.assign(_char, next, { hpMax: _char.hpMax });
  document.getElementById('hp-delta').value = '';
  document.getElementById('temp-hp').value = _char.hpTemp || 0;
  await _saveChar();
  renderMain();
  if (_char.hp !== prev) {
    await announceHp(direction < 0 ? `${delta} damage` : `${delta} healing`);
  }
}

export async function updateTempHP(val) {
  _char.hpTemp = Math.max(0, parseInt(val, 10) || 0);
  await _saveChar();
}

export async function toggleCondition(name) {
  const idx = (_char.conditions || []).indexOf(name);
  if (idx >= 0) _char.conditions.splice(idx, 1);
  else _char.conditions = [...(_char.conditions || []), name];
  await _saveChar();
  renderMain();
}

export async function toggleDeathSave(type, index) {
  const key = type + 'es';
  const cur = (_char.deathSaves || {})[key] || 0;
  // Three successes = stable at 0 HP (still unconscious); three failures = dead. These used to set
  // HP to 1 and wake the hero, and "dying" only added Unconscious (audit D2, D3).
  Object.assign(_char, markDeathSave(_char, type, cur === index + 1 ? index : index + 1));
  await _saveChar();
  renderMain();
  // Broadcast updated death save counts to the hub (so DM and other clients see state)
  if (_campaignId && _userId) {
    publishTo(['hub'], EV.TOKEN_DEATH_SAVE, {
      campaignId: _campaignId,
      tokenId: 'player_' + _userId,
      successes: _char.deathSaves.successes,
      failures: _char.deathSaves.failures,
      name: _char.name, fromUserId: _userId,
    }).catch(() => {});
  }
}

/** Roll a death save: d20, 10+ succeeds, 1 counts twice, 20 brings you back with 1 HP. */
export async function rollDeathSaveNow() {
  if (!_char || (_char.hp || 0) > 0 || _char.dead || _char.stable) return;
  const d20 = Math.floor(Math.random() * 20) + 1;
  Object.assign(_char, rollDeathSave(_char, d20));
  await _saveChar();
  renderMain();
  const msg = _char.dead ? 'died' : (_char.hp > 0 ? 'rolled a 20 and is back up!' : _char.stable ? 'is stable' : 'rolled ' + d20);
  publishTo(['hub'], EV.TOKEN_DEATH_SAVE, {
    campaignId: _campaignId, tokenId: 'player_' + _userId,
    successes: _char.deathSaves?.successes || 0, failures: _char.deathSaves?.failures || 0,
    stable: !!_char.stable, dead: !!_char.dead, d20, message: `${_char.name} ${msg}`, name: _char.name, fromUserId: _userId,
  }).catch(() => {});
  if (d20 === 20 || _char.dead) announceHp(d20 === 20 ? 'Natural 20 on a death save' : 'Died');
}

export async function changeExhaustion(delta) {
  _char.exhaustion = Math.max(0, Math.min(6, (_char.exhaustion || 0) + delta));
  await _saveChar();
  document.getElementById('exhaustion-level').textContent = _char.exhaustion;
}

export async function toggleInspiration() {
  _char.inspiration = !_char.inspiration;
  await _saveChar();
  document.getElementById('stat-insp').textContent = _char.inspiration ? '★' : '☆';
}

export async function doShortRest() {
  // Spend as many Hit Dice as you like (or none): each is d<class die> + CON. Used to roll exactly one,
  // with no pool, every time (audit D6).
  const left = _char.hitDiceRemaining ?? _char.level ?? 1;
  const d = hitDieFor(_char.class);
  const answer = prompt(`Short rest. You have ${left} Hit ${left === 1 ? 'Die' : 'Dice'} (d${d}) left.\nHow many do you spend? (0 to just rest)`, left ? '1' : '0');
  if (answer === null) return false;
  const before = _char.hp;
  Object.assign(_char, shortRestSpend(_char, parseInt(answer, 10) || 0, sides => Math.ceil(Math.random() * sides)));
  await _saveChar();
  renderMain();
  await realtimePublish(EV.REST, { type: EV.REST, userId: _userId, restType: 'short' });
  alert(`Short rest: recovered ${_char.hp - before} HP. Hit Dice left: ${_char.hitDiceRemaining}.`);
  return true;
}

export async function doLongRest() {
  if (!confirm('Take a long rest? Full HP and spell slots, half your Hit Dice back, one less level of exhaustion.')) return false;
  Object.assign(_char, longRest(_char));
  await _saveChar();
  renderMain();
  await realtimePublish(EV.REST, { type: EV.REST, userId: _userId, restType: 'long' });
  return true;
}

export async function toggleEquipped(index, val) {
  if (_char.equipment?.[index]) {
    _char.equipment[index].equipped = val;
    renderAll();
    await _saveChar();
  }
}

export function rollAbilityCheck(ability) {
  const score = _effectiveStats.abilities[ability] ?? _char[ability] ?? 10;
  if (_setDiceLabel) _setDiceLabel(`${ABILITY_NAMES[ability]} Check`, abilityMod(score));
  if (_rollDice) _rollDice();
}

export function rollSkillCheck(skillName, bonus) {
  if (_setDiceLabel) _setDiceLabel(skillName, bonus);
  if (_rollDice) _rollDice();
}
