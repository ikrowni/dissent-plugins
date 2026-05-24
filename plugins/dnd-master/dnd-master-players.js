// dnd-master-players.js — DM player sheet viewer and editor
import { storageGetCompanion, storageSetCompanion, realtimePublishCompanion, esc } from '../plugin-sdk.js';

// Fix 1: escAttr escapes single quotes in addition to the chars esc() handles,
// preventing attribute-context XSS when uid is embedded in onclick="...'${uid}'..."
function escAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CONDITIONS = ['Blinded','Charmed','Deafened','Frightened','Grappled',
  'Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone',
  'Restrained','Stunned','Unconscious'];
const ABILITIES  = ['str','dex','con','int','wis','cha'];
const SPELL_LEVELS = [1,2,3,4,5,6,7,8,9];

let _state = { dmCampaign: null, dmCampaignId: null };
let _sheets = {};       // userId → CHAR object
let _selected = null;   // userId currently in detail view
// Fix 3: per-uid save timers to prevent save races between concurrent edits
let _saveTimers = {};

export function setPlayersState(state) { _state = state; }

export async function renderPlayersTab() {
  const el = document.getElementById('tab-players');
  if (!el) return;
  _selected = null;
  el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:12px;text-align:center">Loading players…</div>';
  const members = _state.dmCampaign?.members || [];
  if (members.length === 0) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:12px;text-align:center">No players in this campaign yet.</div>';
    return;
  }
  const entries = await Promise.all(members.map(async uid => {
    const sheet = await storageGetCompanion('dnd-hub', `player_sheet_${_state.dmCampaignId}_${uid}`, 'server');
    if (sheet) _sheets[uid] = sheet;
    return { uid, sheet };
  }));
  el.innerHTML = entries.map(({ uid, sheet }) => _playerCard(uid, sheet)).join('');
}

function _playerCard(uid, sheet) {
  if (!sheet) {
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)">
      Player <code style="font-size:10px">${esc(uid.slice(0,8))}</code> — no sheet yet
    </div>`;
  }
  const hp = parseInt(sheet.hp) || 0;
  const hpMax = parseInt(sheet.hpMax) || 1;
  const pct = hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;
  const barColor = pct > 60 ? '#22c55e' : pct > 30 ? '#f59e0b' : '#ef4444';
  const conditions = (sheet.conditions || []).slice(0, 3).join(', ');
  // Fix 1: use escAttr(uid) inside onclick attribute string
  // Fix 2: esc() hpTemp to prevent injection via numeric-looking strings
  return `<div onclick="dmOpenPlayer('${escAttr(uid)}')"
    style="padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;
           transition:background .15s" onmouseover="this.style.background='rgba(255,255,255,.04)'"
    onmouseout="this.style.background=''">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
      <span style="font-size:12px;font-weight:700">${esc(sheet.name || 'Unnamed')}</span>
      <span style="font-size:10px;color:var(--muted)">${esc(sheet.class || '?')} ${esc(String(parseInt(sheet.level) || 1))}</span>
    </div>
    <div style="height:5px;background:var(--border);border-radius:3px;margin-bottom:4px">
      <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted)">
      <span>HP ${hp}/${hpMax}${sheet.hpTemp ? ' (+'+ esc(String(parseInt(sheet.hpTemp) || 0)) +' tmp)' : ''}</span>
      ${conditions ? `<span style="color:#f87171">${esc(conditions)}</span>` : ''}
    </div>
  </div>`;
}

export function dmOpenPlayer(uid) {
  _selected = uid;
  const sheet = _sheets[uid];
  const el = document.getElementById('tab-players');
  if (!el || !sheet) return;
  el.innerHTML = _detailView(uid, sheet);
  _bindDetailInputs(uid);
}

function _detailView(uid, s) {
  const conditions = (s.conditions || []);
  // Fix 1: escAttr for uid and condition name in onclick attributes
  const condChips = CONDITIONS.map(c =>
    `<div class="condition-chip ${conditions.includes(c) ? 'active' : ''}"
      onclick="dmToggleCondition('${escAttr(uid)}','${escAttr(c)}')" style="cursor:pointer">${esc(c)}</div>`
  ).join('');

  // Fix 2: parseInt numeric input values; Fix 1: escAttr uid in onchange attributes
  const abilityInputs = ABILITIES.map(a =>
    `<div style="text-align:center">
      <div style="font-size:9px;color:var(--muted);letter-spacing:.06em">${a.toUpperCase()}</div>
      <input type="number" id="dm-ability-${a}" value="${parseInt(s[a]) || 10}" min="1" max="30"
        style="width:42px;background:var(--surface);border:1px solid var(--border);border-radius:6px;
               padding:4px 0;color:var(--text);font-size:13px;outline:none;text-align:center"
        onchange="dmEditAbility('${escAttr(uid)}','${a}',this.value)">
    </div>`
  ).join('');

  // Fix 4: add data-spell-level and class="spell-pip" so dmToggleSpellSlot can update in-place
  const slotRows = SPELL_LEVELS.map(lvl => {
    const max  = s.spellSlotsMax?.[lvl] ?? 0;
    if (max === 0) return '';
    const used = s.spellSlots?.[lvl] ?? 0;
    // Fix 1: escAttr uid in onclick; Fix 4: add class="spell-pip"
    const pips = Array.from({ length: max }, (_, i) =>
      `<div class="spell-pip" onclick="dmToggleSpellSlot('${escAttr(uid)}',${lvl},${i})"
        style="width:12px;height:12px;border-radius:50%;cursor:pointer;border:1.5px solid var(--dnd-gold);
               background:${i < used ? 'var(--dnd-gold)' : 'transparent'}"></div>`
    ).join('');
    // Fix 4: add data-spell-level attribute for in-place pip updates
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px" data-spell-level="${lvl}">
      <span style="font-size:10px;color:var(--muted);width:16px">${lvl}</span>
      <div style="display:flex;gap:3px">${pips}</div>
    </div>`;
  }).join('');

  // Fix 2: parseInt all numeric input values; Fix 1: escAttr uid in all onclick/oninput attributes
  return `
    <div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
      <button onclick="dmBackToList()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:0">←</button>
      <div>
        <div style="font-size:13px;font-weight:700">${esc(s.name || 'Unnamed')}</div>
        <div style="font-size:10px;color:var(--muted)">${esc(s.race || '')} ${esc(s.class || '')} · Level ${esc(String(parseInt(s.level) || 1))}</div>
      </div>
    </div>
    <div style="overflow-y:auto;flex:1;padding:10px 12px;display:flex;flex-direction:column;gap:14px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">HIT POINTS</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="number" id="dm-hp" value="${parseInt(s.hp) || 0}"
            style="width:52px;background:var(--surface);border:1px solid var(--border);border-radius:6px;
                   padding:5px 8px;color:var(--text);font-size:13px;outline:none;text-align:center"
            onchange="dmEditHP('${escAttr(uid)}','hp',this.value)">
          <span style="color:var(--muted)">/</span>
          <input type="number" id="dm-hpmax" value="${parseInt(s.hpMax) || 0}"
            style="width:52px;background:var(--surface);border:1px solid var(--border);border-radius:6px;
                   padding:5px 8px;color:var(--text);font-size:13px;outline:none;text-align:center"
            onchange="dmEditHP('${escAttr(uid)}','hpMax',this.value)">
          <span style="font-size:10px;color:var(--muted)">Tmp:</span>
          <input type="number" id="dm-hptemp" value="${parseInt(s.hpTemp) || 0}" min="0"
            style="width:44px;background:var(--surface);border:1px solid var(--border);border-radius:6px;
                   padding:5px 8px;color:var(--text);font-size:12px;outline:none;text-align:center"
            onchange="dmEditHP('${escAttr(uid)}','hpTemp',this.value)">
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">CONDITIONS</div>
        <div class="condition-grid">${condChips}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">ABILITY SCORES</div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px">${abilityInputs}</div>
      </div>
      ${slotRows ? `<div>
        <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">SPELL SLOTS</div>
        ${slotRows}
      </div>` : ''}
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">EXHAUSTION</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button onclick="dmEditExhaustion('${escAttr(uid)}',-1)"
            style="padding:3px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);cursor:pointer">−</button>
          <span id="dm-exhaustion">${parseInt(s.exhaustion) || 0}</span>
          <button onclick="dmEditExhaustion('${escAttr(uid)}',1)"
            style="padding:3px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);cursor:pointer">+</button>
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:6px">NOTES</div>
        <textarea id="dm-notes" oninput="dmEditNotes('${escAttr(uid)}')"
          style="width:100%;min-height:80px;background:var(--surface);border:1px solid var(--border);
                 border-radius:6px;padding:8px;color:var(--text);font-size:11px;line-height:1.6;
                 outline:none;resize:vertical;font-family:inherit;box-sizing:border-box"
          >${esc(s.notes || '')}</textarea>
      </div>
    </div>`;
}

function _bindDetailInputs(uid) {
  // inputs are bound inline via onclick/onchange — no additional wiring needed
}

async function _saveAndBroadcast(uid) {
  const sheet = _sheets[uid];
  if (!sheet) return;
  await storageSetCompanion('dnd-hub', `player_sheet_${_state.dmCampaignId}_${uid}`, 'server', sheet);
  await realtimePublishCompanion('dnd-player', 'sheet:dm-update', {
    type: 'sheet:dm-update',
    userId: uid,
    campaignId: _state.dmCampaignId,
  });
}

// Fix 3: per-uid timers prevent a rapid edit on player A from cancelling player B's pending save
function _scheduleSave(uid) {
  clearTimeout(_saveTimers[uid]);
  _saveTimers[uid] = setTimeout(() => _saveAndBroadcast(uid).catch(() => {}), 500);
}

export function dmBackToList() { renderPlayersTab(); }

export function dmEditHP(uid, field, value) {
  const sheet = _sheets[uid];
  if (!sheet) return;
  sheet[field] = Math.max(0, parseInt(value, 10) || 0);
  _scheduleSave(uid);
}

export function dmToggleCondition(uid, condition) {
  const sheet = _sheets[uid];
  if (!sheet) return;
  const conditions = sheet.conditions || [];
  const idx = conditions.indexOf(condition);
  if (idx === -1) conditions.push(condition); else conditions.splice(idx, 1);
  sheet.conditions = conditions;
  // Re-render condition chips in place
  const chip = [...document.querySelectorAll('.condition-chip')].find(el => el.textContent === condition);
  if (chip) chip.classList.toggle('active', conditions.includes(condition));
  _scheduleSave(uid);
}

export function dmEditAbility(uid, ability, value) {
  const sheet = _sheets[uid];
  if (!sheet) return;
  sheet[ability] = Math.max(1, Math.min(30, parseInt(value, 10) || 10));
  _scheduleSave(uid);
}

// Fix 4: update pip styles in-place instead of full re-render (which destroys unsaved textarea)
export function dmToggleSpellSlot(uid, level, pipIndex) {
  const sheet = _sheets[uid];
  if (!sheet) return;
  if (!sheet.spellSlots) sheet.spellSlots = {};
  const used = sheet.spellSlots[level] ?? 0;
  const max  = sheet.spellSlotsMax?.[level] ?? 0;
  sheet.spellSlots[level] = pipIndex < used
    ? Math.max(0, used - 1)
    : Math.min(max, used + 1);
  const newUsed = sheet.spellSlots[level];
  // Update pip colors in-place instead of re-rendering the whole view
  const pips = document.querySelectorAll(`[data-spell-level="${level}"] .spell-pip`);
  pips.forEach((pip, i) => {
    pip.style.background = i < newUsed ? 'var(--dnd-gold)' : 'transparent';
  });
  _scheduleSave(uid);
}

export function dmEditExhaustion(uid, delta) {
  const sheet = _sheets[uid];
  if (!sheet) return;
  sheet.exhaustion = Math.max(0, Math.min(6, (sheet.exhaustion ?? 0) + delta));
  const el = document.getElementById('dm-exhaustion');
  if (el) el.textContent = String(sheet.exhaustion);
  _scheduleSave(uid);
}

export function dmEditNotes(uid) {
  const sheet = _sheets[uid];
  if (!sheet) return;
  sheet.notes = document.getElementById('dm-notes')?.value ?? '';
  _scheduleSave(uid);
}
