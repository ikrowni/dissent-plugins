// dnd-player-sheet.js — character sheet rendering + HP/action functions
import { esc, realtimePublish } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js';

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

// Compact SRD feature descriptions — keyed by lowercase feature name (partial match supported)
const SRD_FEATURES = {
  'rage': 'Bonus action: enter a rage. Adv. on STR checks/saves, +2–4 dmg with STR melee, resistance to bludgeoning/piercing/slashing. Lasts 1 minute. Limited uses/long rest.',
  'unarmored defense': 'When not wearing armor, AC = 10 + DEX mod + CON mod (Barbarian) or 10 + DEX mod + WIS mod (Monk).',
  'reckless attack': 'When you attack, gain advantage on STR-based melee attacks this turn. Attackers also gain advantage against you until next turn.',
  'danger sense': 'Advantage on DEX saving throws against effects you can see (e.g., traps, spells) if not blinded, deafened, or incapacitated.',
  'bardic inspiration': 'Bonus action: grant a creature within 60 ft a Bardic Inspiration die (d6–d12). They can roll it once within 10 min on an ability check, attack, or save.',
  'jack of all trades': 'Add half proficiency bonus (rounded down) to any ability check that doesn\'t already include your proficiency bonus.',
  'song of rest': 'After a short rest, you and allies who hear you perform regain extra HP: d6 at level 2 (increasing at higher levels).',
  'spellcasting': 'You can cast spells from your class spell list. You have spell slots that recharge on a long rest.',
  'channel divinity': 'Use a supernatural effect from your Divine Domain. Recharges on a short or long rest. Number of uses increases at higher levels.',
  'wild shape': 'Action: transform into a beast you\'ve seen. Limited CR based on level. Retains your mental stats but uses beast\'s physical stats.',
  'action surge': 'Once per short/long rest, take one additional action on your turn. At level 17 you can use this twice between rests.',
  'second wind': 'Bonus action: regain 1d10 + Fighter level HP. Recharges on a short or long rest.',
  'extra attack': 'When you take the Attack action, you can attack twice. Increases to 3 attacks at level 11 and 4 at level 20 (Fighter).',
  'fighting style': 'You adopt a fighting style specialty: Archery, Defense, Dueling, Great Weapon Fighting, Protection, or Two-Weapon Fighting.',
  'indomitable': 'Reroll a failed saving throw. You must use the new roll. Uses: 1 at level 9, 2 at level 13, 3 at level 17.',
  'ki': 'Fuel special martial arts abilities (Flurry of Blows, Patient Defense, Step of the Wind) using ki points that recharge on a short rest.',
  'flurry of blows': 'After taking the Attack action, spend 1 ki point to make 2 unarmed strikes as a bonus action.',
  'stunning strike': 'Spend 1 ki point when you hit with a melee attack. Target must succeed on a CON save or be stunned until end of your next turn.',
  'lay on hands': 'A pool of healing power (5 × paladin level). Use an action to restore HP, or spend 5 points to cure one disease or poison.',
  'divine smite': 'When you hit with a melee attack, expend a spell slot to deal extra radiant damage (2d8 per slot level, up to 5d8). +1d8 vs undead/fiends.',
  'aura of protection': 'Friendly creatures within 10 ft (including you) add your CHA modifier to saving throws (minimum +1) while you\'re conscious.',
  'sneak attack': 'Once per turn, deal extra damage when you attack with advantage, or when an ally is adjacent to the target. Scales: 1d6 at level 1 up to 10d6 at level 19.',
  'cunning action': 'Bonus action: Dash, Disengage, or Hide.',
  'evasion': 'When you succeed on a DEX save for half damage, you take no damage. When you fail, you take half damage.',
  'uncanny dodge': 'When you can see the attacker, use your reaction to halve the damage from one attack.',
  'reliable talent': 'Treat any d20 roll below 10 as a 10 for skill checks where you\'re proficient.',
  'eldritch invocations': 'Supernatural boons that enhance your warlock abilities. Choose 2 at level 2; gain more at higher levels.',
  'pact magic': 'You have spell slots that recharge on a short rest. All your warlock spell slots are the same level (1st–5th depending on your level).',
  'pact of the blade': 'Create a pact weapon in your hand (action). You\'re proficient with it and it counts as magical.',
  'pact of the chain': 'Gain a familiar more powerful than the find familiar spell (imp, pseudodragon, quasit, or sprite).',
  'pact of the tome': 'Gain a Book of Shadows with 3 cantrips from any class spell list.',
  'sorcery points': 'Pool of sorcery points equal to your level. Spend to create spell slots (Flexible Casting) or fuel Metamagic options.',
  'metamagic': 'Twist your spells using sorcery points: Careful, Distant, Empowered, Extended, Heightened, Quickened, Subtle, or Twinned Spell.',
  'arcane recovery': 'Once per long rest, during a short rest, recover expended spell slots totalling up to half your wizard level (rounded up, max 5th level).',
  'sneak attack': 'Once per turn, deal extra damage (1d6 per 2 levels) when attacking with advantage or when an ally is adjacent to your target.',
  'hunter\'s mark': 'Bonus action: mark a creature. Deal an extra 1d6 damage each time you hit it. Move the mark to another target if it drops.',
  'favored enemy': 'Advantage on Survival checks to track and Intelligence checks to recall information about your chosen enemy type.',
  'natural explorer': 'Gain benefits (no difficult terrain penalty, no chance of getting lost, extra food, etc.) in your favored terrain.',
  'divine health': 'Your devotion prevents disease. You are immune to disease.',
  'aura of courage': 'Friendly creatures within 10 ft can\'t be frightened while you\'re conscious.',
  'improved divine smite': 'Whenever you hit a creature with a melee attack, deal an extra 1d8 radiant damage.',
  'deflect missiles': 'Reaction: reduce ranged weapon damage by 1d10 + DEX mod + Monk level. If damage is reduced to 0, catch and throw the missile (1d10+DEX+level, range 20/60).',
  'slow fall': 'Reaction: reduce falling damage by 5 × Monk level.',
  'timeless body': 'You age slowly (1 year per 10) and can\'t be magically aged.',
  'feral instinct': 'Advantage on initiative. Can enter rage before acting even if surprised (not surprised after).',
  'brutal critical': 'Roll 1 extra weapon damage die on a critical hit (2 at level 13, 3 at level 17).',
  'relentless rage': 'When you drop to 0 HP while raging and don\'t die, succeed on a DC 10 CON save to stay at 1 HP. DC increases by 5 each time.',
  'persistent rage': 'Your rage only ends if you fall unconscious or choose to end it. No longer ends from lack of attacking/taking damage.',
};

function _lookupFeatureDesc(name) {
  if (!name) return '';
  const key = name.toLowerCase().replace(/\s*\(.*\)/, '').trim(); // strip parentheticals
  if (SRD_FEATURES[key]) return SRD_FEATURES[key];
  // Partial match — feature name starts with a known key
  for (const [k, v] of Object.entries(SRD_FEATURES)) {
    if (key.startsWith(k) || k.startsWith(key)) return v;
  }
  return '';
}
function xpThresholdForLevel(level) { return XP_THRESHOLDS_SHEET[Math.min((level||1)+1, 20)] ?? Infinity; }
function getHitDie(cls) {
  const hd = { barbarian:12,fighter:10,paladin:10,ranger:10,cleric:8,druid:8,monk:8,rogue:8,warlock:8,bard:8,sorcerer:6,wizard:6 };
  return hd[cls?.toLowerCase()] || 8;
}

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
  } else {
    baseAC = char.ac || 10;
  }
  if (allEffects.some(e => e.type === 'shield')) baseAC += 2;
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

export function renderAll() {
  if (!_char) return;
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
  if (_char.hp <= 0) renderDeathSaves();

  // Level-up banner
  const levelBanner = document.getElementById('levelup-banner');
  if (levelBanner) {
    const ready = (_char.level || 1) < 20 && (_char.xp || 0) >= xpThresholdForLevel(_char.level);
    levelBanner.style.display = ready ? 'block' : 'none';
  }

  // XP progress bar
  const xpEl = document.getElementById('xp-bar-section');
  if (xpEl) {
    const xp  = _char.xp || 0;
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
  const profBonus = _char.proficiencyBonus || 2;
  const saves = _char.savingThrows || [];
  document.getElementById('saving-throws').innerHTML = ABILITIES.map(a => {
    const isProficient = saves.includes(a);
    const score = _effectiveStats.abilities[a] ?? _char[a] ?? 10;
    const bonus = abilityMod(score) + (isProficient ? profBonus : 0);
    return `<div class="skill-row">
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

function _effectLabel(e) {
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
  const hasWeapon = effects.some(e => e.type === 'weapon');
  const effectsHtml = (() => {
    if (effects.length) {
      return effects.map(e =>
        `<div style="font-size:9px;color:var(--muted);margin-top:2px">${esc(_effectLabel(e))}</div>`
      ).join('');
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
      ? `<button onclick="toggleEquipped(${idx},false)" style="font-size:10px;padding:3px 8px;background:rgba(212,175,55,.2);border:1px solid rgba(212,175,55,.5);border-radius:4px;color:var(--dnd-gold,#d4af37);cursor:pointer;flex-shrink:0;white-space:nowrap">✦ Equipped</button>`
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
    ? items.map((item, i) => _invItemCard(item, i)).join('')
    : '<div style="font-size:11px;color:var(--muted)">No items in inventory.</div>';
  const currencies = [
    {key:'platinum',symbol:'pp',color:'#e2e8f0'},
    {key:'gold',symbol:'gp',color:'var(--dnd-gold)'},
    {key:'electrum',symbol:'ep',color:'#a78bfa'},
    {key:'silver',symbol:'sp',color:'#94a3b8'},
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
  el.innerHTML = features.map((f, i) => {
    const name     = typeof f === 'string' ? f : (f.name || '');
    const desc     = typeof f === 'string' ? '' : (f.desc || '');
    const expanded = _expandedFeatures.has(i);
    return '<div style="background:var(--surface);border:1px solid var(--border);border-left:2px solid var(--dnd-gold);border-radius:6px;overflow:hidden">' +
      '<div style="padding:9px 10px;cursor:pointer;display:flex;align-items:center;gap:6px" onclick="toggleFeatureExpand(' + i + ')">' +
        '<div style="font-size:12px;font-weight:600;flex:1">' + esc(name) + '</div>' +
        '<span style="font-size:10px;color:var(--muted)">' + (expanded ? '▲' : '▼') + '</span>' +
      '</div>' +
      (expanded
        ? '<div style="padding:0 10px 10px">' +
            (() => {
              const srd = !desc ? _lookupFeatureDesc(name) : '';
              return (srd
                ? '<div style="background:rgba(96,165,250,.06);border:1px solid rgba(96,165,250,.2);border-radius:4px;padding:6px 8px;font-size:10px;color:rgba(255,255,255,.65);line-height:1.5;margin-bottom:6px"><span style="color:#60a5fa;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px">SRD Reference</span>' + esc(srd) + '</div>'
                : '') +
              '<textarea placeholder="Add your notes…" onblur="saveFeatureDesc(' + i + ',this.value)"' +
                ' style="width:100%;min-height:50px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:4px;' +
                'color:var(--text);font-size:11px;line-height:1.5;padding:6px;outline:none;resize:vertical;font-family:inherit;box-sizing:border-box">' +
                esc(desc) + '</textarea>';
            })() +
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
  _char.hp = Math.max(0, Math.min(_char.hpMax, _char.hp + direction * delta));
  document.getElementById('hp-delta').value = '';
  await _saveChar();
  renderMain();
  if (_char.hp !== prev) {
    await realtimePublish(EV.HP_CHANGE, { type: EV.HP_CHANGE, userId: _userId, hp: _char.hp, hpMax: _char.hpMax,
      source: direction < 0 ? `${delta} damage` : `${delta} healing` });
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
  if (!_char.deathSaves) _char.deathSaves = { successes: 0, failures: 0 };
  const key = type + 'es';
  _char.deathSaves[key] = _char.deathSaves[key] === index + 1 ? index : index + 1;
  await _saveChar();
  renderDeathSaves();
  // Broadcast updated death save counts to the hub (so DM and other clients see state)
  if (_campaignId && _userId) {
    realtimePublish(EV.TOKEN_DEATH_SAVE, {
      type: EV.TOKEN_DEATH_SAVE,
      campaignId: _campaignId,
      tokenId: 'player_' + _userId,
      successes: _char.deathSaves.successes,
      failures: _char.deathSaves.failures,
      fromUserId: _userId,
    }).catch(() => {});
  }
  // Auto-stabilize at 3 successes; auto-die at 3 failures
  const ds = _char.deathSaves;
  if (ds.successes >= 3) {
    _char.conditions = [...(_char.conditions || []).filter(c => c !== 'Unconscious'), 'Prone'];
    _char.hp = 1;
    _char.deathSaves = { successes: 0, failures: 0 };
    await _saveChar();
    renderMain();
  } else if (ds.failures >= 3) {
    _char.conditions = [...(_char.conditions || []).filter(c => c !== 'Unconscious'), 'Unconscious'];
    _char.deathSaves = { successes: 0, failures: 0 };
    await _saveChar();
    renderMain();
  }
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
  if (!confirm('Take a short rest? You can spend Hit Dice to recover HP.')) return;
  const hitDie = getHitDie(_char.class);
  const roll = Math.ceil(Math.random() * hitDie) + abilityMod(_char.con ?? 10);
  const gained = Math.max(1, roll);
  _char.hp = Math.min(_char.hpMax, _char.hp + gained);
  await _saveChar();
  renderMain();
  await realtimePublish(EV.REST, { type: EV.REST, userId: _userId, restType: 'short' });
  alert(`Short rest: recovered ${gained} HP (d${hitDie} + CON)`);
}

export async function doLongRest() {
  if (!confirm('Take a long rest? This will fully restore HP and spell slots.')) return;
  _char.hp = _char.hpMax;
  _char.hpTemp = 0;
  if (_char.spellSlots) _char.spellSlots = _char.spellSlots.map(([cur, max]) => [max, max]);
  _char.deathSaves = { successes: 0, failures: 0 };
  await _saveChar();
  renderMain();
  await realtimePublish(EV.REST, { type: EV.REST, userId: _userId, restType: 'long' });
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
