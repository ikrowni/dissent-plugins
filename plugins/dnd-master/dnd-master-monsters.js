// dnd-master-monsters.js — SRD monster viewer, stat blocks, combat instances
import { esc, genId, realtimePublish, realtimePublishCompanion, localPublish } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js';

let SRD_MONSTERS = [];
let expandedMonster = null;
let monsterInstances = {};
let _userId = null;

export function setMonstersState({ userId }) {
  _userId = userId;
}

export async function loadSRDMonsters() {
  try {
    const base = new URL('.', document.baseURI).href;
    const r = await fetch(base + 'dnd-srd/monsters.json');
    SRD_MONSTERS = await r.json();
  } catch (err) { SRD_MONSTERS = []; }
}

export function getSRDMonsters() { return SRD_MONSTERS; }

// XP tables — exported so encounter.js can import them
export const XP_THRESHOLDS = [null,[25,50,75,100],[50,100,150,200],[75,150,225,400],[125,250,375,500],[250,500,750,1100],[300,600,900,1400],[350,750,1100,1700],[450,900,1400,2100],[550,1100,1600,2400],[600,1200,1900,2800],[800,1600,2400,3600],[1000,2000,3000,4500],[1100,2200,3300,5100],[1250,2500,3800,5700],[1400,2800,4300,6400],[1600,3200,4800,7200],[2000,3900,5900,8800],[2100,4200,6300,9500],[2400,4900,7300,10900],[2800,5700,8500,12700]];
export const CR_XP = {0:10,0.125:25,0.25:50,0.5:100,'1/8':25,'1/4':50,'1/2':100,1:200,2:450,3:700,4:1100,5:1800,6:2300,7:2900,8:3900,9:5000,10:5900,11:7200,12:8400,13:10000,14:11500,15:13000,16:15000,17:18000,18:20000,19:22000,20:25000,21:33000,22:41000,23:50000,24:62000,25:75000,26:90000,27:105000,28:120000,29:135000,30:155000};

// --- Private helpers ---
function abilityMod(s) { return Math.floor((s - 10) / 2); }
function rollDice(n, d, mod) { mod = mod || 0; let t = 0; for (let i = 0; i < n; i++) t += Math.ceil(Math.random() * d); return t + mod; }
function fmtMod(n) { return n >= 0 ? '+' + n : '' + n; }
function parseHPDice(expr) {
  const m = String(expr).match(/^(\d+)d(\d+)([+-]\d+)?/);
  if (!m) return [1, 8, 0];
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3] || '0')];
}

export function renderMonsterSearch(q) {
  if (q === undefined) q = '';
  const el = document.getElementById('tab-monsters');
  if (!el) return;
  el.innerHTML =
    '<input class="search-input" id="mon-search" placeholder="Search monsters\u2026"' +
    ' oninput="renderMonsterSearch(this.value)" value="' + esc(q) + '">' +
    '<div id="mon-list" style="margin-bottom:10px"></div>' +
    '<div id="mon-instances" style="margin-top:8px"></div>';

  _renderMonsterList(q);
  renderInstances();
}

function _renderMonsterList(q) {
  const listEl = document.getElementById('mon-list');
  if (!listEl) return;
  const matches = SRD_MONSTERS.filter(m => !q || m.name.toLowerCase().indexOf(q.toLowerCase()) !== -1).slice(0, 40);
  if (!matches.length) {
    listEl.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px">No monsters found</div>';
    return;
  }
  listEl.innerHTML = matches.map(m => {
    const isExpanded = expandedMonster?.id === m.id;
    const row = '<div class="monster-row" onclick="expandMonster(\'' + m.id + '\')" style="border-bottom:' +
        (isExpanded ? '1px solid var(--border)' : 'none') + '">' +
        '<span class="cr-badge">CR ' + m.cr + '</span>' +
        '<span style="font-size:11px;font-weight:600;flex:1">' + esc(m.name) + '</span>' +
        '<span style="font-size:9px;color:var(--muted)">' + esc(m.type) + ' \u00b7 ' + m.hp + 'hp</span>' +
        '<span style="font-size:9px;color:var(--muted);margin-left:4px">' + (isExpanded ? '\u25b2' : '\u25bc') + '</span>' +
      '</div>';
    const statblock = isExpanded ? _buildStatblockHtml(m) : '';
    return row + statblock;
  }).join('');
}

export function expandMonster(id) {
  if (expandedMonster?.id === id) {
    expandedMonster = null;
  } else {
    const m = SRD_MONSTERS.find(x => x.id === id);
    if (!m) return;
    expandedMonster = m;
  }
  const q = document.getElementById('mon-search')?.value || '';
  _renderMonsterList(q);
  renderInstances();
}

function _buildStatblockHtml(m) {
  const ABILITIES = ['str','dex','con','int','wis','cha'];
  const speedParts = [];
  if (m.speed) { Object.keys(m.speed).forEach(k => speedParts.push(k + ' ' + m.speed[k])); }
  const speedStr = speedParts.join(', ');

  let actionsHtml = '';
  if (m.actions && m.actions.length) {
    actionsHtml = '<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">';
    m.actions.forEach(a => {
      let rollBtns = '';
      if (a.attack_bonus != null) {
        rollBtns += '<button class="roll-btn" onclick="quickRoll(\'' + esc(m.name) + '\',\'' + esc(a.name) + ' attack\',1,20,' + a.attack_bonus + ',\'attack\')">1d20' + fmtMod(a.attack_bonus) + '</button> ';
      }
      if (a.damage_dice) {
        rollBtns += '<button class="roll-btn" onclick="quickRollExpr(\'' + esc(m.name) + '\',\'' + esc(a.name) + ' dmg\',\'' + a.damage_dice + '\')">Dmg</button>';
      }
      let desc = esc(a.desc || '');
      if (desc.length > 120) desc = desc.slice(0, 120) + '\u2026';
      actionsHtml += '<div class="action-row">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px">' +
          '<strong style="font-size:11px">' + esc(a.name) + '</strong>' +
          '<span>' + rollBtns + '</span>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--muted);line-height:1.4;margin-top:2px">' + desc + '</div>' +
      '</div>';
    });
    actionsHtml += '</div>';
  }

  const statsHtml = ABILITIES.map(a => {
    const val = m[a] || 10;
    return '<div class="stat-cell">' +
      '<div class="stat-name">' + a.toUpperCase() + '</div>' +
      '<div class="stat-val">' + val + '</div>' +
      '<div class="stat-mod">' + fmtMod(abilityMod(val)) + '</div>' +
    '</div>';
  }).join('');

  let extraSections = '';
  if (m.saving_throws && m.saving_throws.length) {
    extraSections += '<div class="sb-section"><strong>Saves</strong> ' +
      m.saving_throws.map(s => s.ability.toUpperCase() + ' ' + fmtMod(s.bonus)).join(', ') + '</div>';
  }
  if (m.skills && m.skills.length) {
    extraSections += '<div class="sb-section"><strong>Skills</strong> ' +
      m.skills.map(s => esc(s.name) + ' ' + fmtMod(s.bonus)).join(', ') + '</div>';
  }
  if (m.damage_immunities && m.damage_immunities.length) {
    extraSections += '<div class="sb-section"><strong>Immunities</strong> ' + esc(m.damage_immunities.join(', ')) + '</div>';
  }
  if (m.senses) {
    const senseParts = [];
    Object.keys(m.senses).forEach(k => {
      if (k === 'passive_perception') senseParts.push('passive Perception ' + m.senses[k]);
      else senseParts.push(k + ' ' + m.senses[k]);
    });
    if (senseParts.length) extraSections += '<div class="sb-section"><strong>Senses</strong> ' + esc(senseParts.join(', ')) + '</div>';
  }
  if (m.languages) extraSections += '<div class="sb-section"><strong>Languages</strong> ' + esc(m.languages) + '</div>';

  return '<div class="statblock" style="margin:0;border-radius:0 0 6px 6px;border-top:none">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
      '<div>' +
        '<div style="font-size:13px;font-weight:800;color:var(--gold)">' + esc(m.name) + '</div>' +
        '<div style="font-size:10px;color:var(--muted)">' + esc(m.size) + ' ' + esc(m.type) + (m.subtype ? ' (' + esc(m.subtype) + ')' : '') + ' \u00b7 ' + esc(m.alignment || '') + '</div>' +
      '</div>' +
      '<button class="btn btn-ghost" onclick="addInstance(\'' + m.id + '\');event.stopPropagation()" style="flex-shrink:0">+ Track</button>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">' +
      'AC ' + m.ac + (m.ac_type ? ' (' + esc(m.ac_type) + ')' : '') +
      ' \u00b7 HP ' + m.hp + ' (' + esc(m.hp_dice || '') + ')' +
      ' \u00b7 Speed ' + esc(speedStr) +
      ' \u00b7 CR ' + m.cr + ' (' + (CR_XP[m.cr] || 0).toLocaleString() + ' XP)' +
    '</div>' +
    '<div class="stat-grid">' + statsHtml + '</div>' +
    extraSections +
    actionsHtml +
  '</div>';
}

export function addInstance(monsterId) {
  const m = SRD_MONSTERS.find(x => x.id === monsterId);
  if (!m) return;
  const existing = Object.values(monsterInstances).filter(i => i.monster.id === monsterId);
  const parts = parseHPDice(m.hp_dice || String(m.hp));
  const hp = rollDice(parts[0], parts[1], parts[2]) || m.hp;
  const id = genId();
  monsterInstances[id] = { id, monster: m, hp, hpMax: hp, name: m.name + (existing.length ? ' ' + (existing.length + 1) : '') };
  renderInstances();
}

function renderInstances() {
  const el = document.getElementById('mon-instances');
  if (!el) return;
  const all = Object.values(monsterInstances);
  if (!all.length) { el.innerHTML = ''; return; }
  const rows = all.map(inst => {
    const frac = inst.hpMax > 0 ? inst.hp / inst.hpMax : 1;
    const col = frac > 0.5 ? '#22c55e' : frac > 0.25 ? '#f59e0b' : '#ef4444';
    return '<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:4px">' +
      '<span style="font-size:11px;font-weight:600;flex:1">' + esc(inst.name) + '</span>' +
      '<div style="display:flex;align-items:center;gap:3px">' +
        '<button onclick="adjHP(\'' + inst.id + '\',-1)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px">\u2212</button>' +
        '<input type="number" value="' + inst.hp + '" min="0" max="' + inst.hpMax + '"' +
          ' onchange="setInstanceHP(\'' + inst.id + '\',this.value)"' +
          ' style="width:36px;background:var(--surface);border:1px solid ' + col + ';border-radius:4px;color:var(--text);font-size:11px;text-align:center;padding:2px;outline:none">' +
        '<button onclick="adjHP(\'' + inst.id + '\',1)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px">+</button>' +
        '<span style="font-size:9px;color:var(--muted)">/' + inst.hpMax + '</span>' +
      '</div>' +
      '<button onclick="deleteInstance(\'' + inst.id + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer">\u2715</button>' +
    '</div>';
  }).join('');
  el.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px;letter-spacing:.05em">COMBAT INSTANCES</div>' + rows;
}

export function adjHP(id, delta) {
  if (!monsterInstances[id]) return;
  monsterInstances[id].hp = Math.max(0, Math.min(monsterInstances[id].hpMax, monsterInstances[id].hp + delta));
  renderInstances();
}

export function setInstanceHP(id, val) {
  if (!monsterInstances[id]) return;
  monsterInstances[id].hp = Math.max(0, Math.min(monsterInstances[id].hpMax, parseInt(val) || 0));
  renderInstances();
}

export function deleteInstance(id) { delete monsterInstances[id]; renderInstances(); }

export async function quickRoll(source, label, n, d, mod, rollType) {
  if (mod === undefined) mod = 0;
  const result = rollDice(n, d, mod);
  const expr = n + 'd' + d + (mod !== 0 ? fmtMod(mod) : '');
  const payload = { type: EV.DICE_ROLL, userId: _userId, source, expression: expr, result, label: source + ': ' + label, ts: Date.now() };
  if (rollType) payload.rollType = rollType;
  await realtimePublish(EV.DICE_ROLL, payload);
  localPublish('dnd-hub', EV.DICE_ROLL, payload);
}

export async function quickRollExpr(source, label, expr) {
  const m = String(expr).match(/^(\d+)d(\d+)([+-]\d+)?/);
  if (!m) return;
  const result = rollDice(parseInt(m[1]), parseInt(m[2]), parseInt(m[3] || '0'));
  console.log('[Roll] ' + source + ' \u2014 ' + label + ': ' + result + ' (' + expr + ')');
  const exprPayload = { type: EV.DICE_ROLL, userId: _userId, source, expression: expr, result, label: source + ': ' + label, ts: Date.now() };
  await realtimePublish(EV.DICE_ROLL, exprPayload);
  localPublish('dnd-hub', EV.DICE_ROLL, exprPayload);
}
