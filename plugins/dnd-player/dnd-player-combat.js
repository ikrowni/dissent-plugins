// dnd-player-combat.js — action economy tracker with action logging

// null = ready, string = used with that label
let _actions = { action: null, bonusAction: null, reaction: null };
let _lastInitiativeActive = false;
let _lastInitiative = null;
let _charClass = '';

export function setInitiativeData(initiative) { _lastInitiative = initiative || null; }
export function setCombatCharData(char) { _charClass = (char?.class || '').toLowerCase(); }

const LABELS = {
  action:      { emoji: '⚔️', label: 'Action',       desc: 'Attack, cast spell, dash, etc.' },
  bonusAction: { emoji: '⚡', label: 'Bonus Action',  desc: 'Offhand attack, bonus spell, etc.' },
  reaction:    { emoji: '🛡', label: 'Reaction',      desc: 'Opportunity attack, counterspell, etc.' },
};

const ACTION_CHOICES = {
  action:      ['Attack', 'Cast Spell', 'Dash', 'Disengage', 'Dodge', 'Help', 'Hide', 'Ready', 'Search', 'Use Object', 'Other…'],
  bonusAction: ['Off-hand Attack', 'Bonus Spell', 'Item Bonus Action', 'Other…'],
  reaction:    ['Opportunity Attack', 'Counterspell', 'Reaction Spell', 'Shield', 'Other…'],
};
// Class-specific additions injected into the pickers
const CLASS_BONUS_ACTIONS = {
  rogue:     ['Cunning Action (Dash)', 'Cunning Action (Disengage)', 'Cunning Action (Hide)'],
  monk:      ['Flurry of Blows (1 ki)', 'Patient Defense (1 ki)', 'Step of the Wind (1 ki)', 'Martial Arts Unarmed Strike'],
  barbarian: ['Enter Rage'],
  bard:      ['Bardic Inspiration', 'Song of Rest'],
  paladin:   ['Divine Smite (spell slot)'],
  ranger:    ['Hunter\'s Mark'],
  druid:     ['Wild Shape'],
  sorcerer:  ['Quickened Spell (2 sp)', 'Sorcery Points conversion'],
  warlock:   ['Pact Magic (bonus action)'],
};
const CLASS_REACTIONS = {
  fighter:  ['Riposte', 'Indomitable (reroll save)'],
  paladin:  ['Divine Smite (reaction)'],
  monk:     ['Deflect Missiles', 'Slow Fall'],
  rogue:    ['Uncanny Dodge'],
  sorcerer: ['Subtle Spell (reaction)'],
};

function _getChoices(key) {
  const base = [...ACTION_CHOICES[key]];
  const other = base.indexOf('Other…');
  if (key === 'bonusAction' && CLASS_BONUS_ACTIONS[_charClass]) {
    base.splice(other, 0, ...CLASS_BONUS_ACTIONS[_charClass]);
  }
  if (key === 'reaction' && CLASS_REACTIONS[_charClass]) {
    base.splice(other, 0, ...CLASS_REACTIONS[_charClass]);
  }
  return base;
}

function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export function renderCombat(initiativeActive) {
  _lastInitiativeActive = initiativeActive;
  const el = document.getElementById('tab-combat');
  if (!el) return;

  if (!initiativeActive) {
    el.innerHTML =
      '<div style="padding:32px 16px;text-align:center;color:var(--muted)">' +
      '<div style="font-size:28px;margin-bottom:10px">⚔️</div>' +
      '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px">No active encounter</div>' +
      '<div style="font-size:11px;line-height:1.5">Action economy tracking appears here<br>when combat is active.</div>' +
      '</div>';
    return;
  }

  let combatHeader = '';
  if (_lastInitiative?.order?.length) {
    const round = _lastInitiative.round || 1;
    const cur = _lastInitiative.order[_lastInitiative.currentIndex || 0];
    combatHeader =
      '<div style="padding:8px 10px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.25);border-radius:8px;margin-bottom:12px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:10px;font-weight:700;color:var(--dnd-gold)">ROUND ' + round + '</span>' +
          (cur ? '<span style="font-size:10px;color:var(--text)">' + _esc(cur.name) + '\'s turn</span>' : '') +
        '</div>' +
      '</div>';
  }

  el.innerHTML =
    combatHeader +
    '<div style="font-size:11px;font-weight:700;color:var(--dnd-gold);margin-bottom:12px;letter-spacing:.05em">ACTION ECONOMY</div>' +
    Object.entries(LABELS).map(([key, { emoji, label, desc }]) => {
      const usedLabel = _actions[key];
      const used = usedLabel !== null;
      return '<div class="action-pill' + (used ? ' used' : '') + '" data-key="' + key + '" onclick="toggleAction(\'' + key + '\')"' +
        ' title="' + (used ? 'Click to reset' : _esc(desc)) + '">' +
        '<div>' +
          '<div style="font-size:12px;font-weight:700">' + emoji + ' ' + label + '</div>' +
          '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + (used ? _esc(usedLabel) : _esc(desc)) + '</div>' +
        '</div>' +
        '<span style="font-size:10px;font-weight:700;color:' + (used ? 'var(--muted)' : '#4ade80') + '">' +
          (used ? '↩ Reset' : 'Ready') +
        '</span>' +
      '</div>';
    }).join('') +
    '<button class="btn btn-ghost" style="width:100%;margin-top:12px;font-size:11px" onclick="clearActionEconomy()">↩ Reset All Actions</button>';
}

export function clearActionEconomy() {
  _actions = { action: null, bonusAction: null, reaction: null };
  const el = document.getElementById('tab-combat');
  if (el && el.classList.contains('active')) renderCombat(_lastInitiativeActive);
}

export function toggleAction(key) {
  if (!(key in _actions)) return;
  if (_actions[key] !== null) {
    // Already used — reset it
    _actions[key] = null;
    renderCombat(_lastInitiativeActive);
    return;
  }
  // Show picker to choose which action was used
  _showActionPicker(key);
}

function _showActionPicker(key) {
  document.getElementById('action-picker-overlay')?.remove();
  const choices = _getChoices(key);

  const overlay = document.createElement('div');
  overlay.id = 'action-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000';

  const pill = document.querySelector('.action-pill[data-key="' + key + '"]');
  const rect  = pill?.getBoundingClientRect() || { left: 40, bottom: 200, right: 240 };
  const menuW = Math.max(rect.right - rect.left, 180);

  const menu = document.createElement('div');
  menu.style.cssText =
    'position:fixed;left:' + rect.left + 'px;top:' + (rect.bottom + 4) + 'px;' +
    'background:#1e1e2e;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px;' +
    'z-index:9001;min-width:' + menuW + 'px;box-shadow:0 4px 16px rgba(0,0,0,.6);max-height:240px;overflow-y:auto';

  choices.forEach(label => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:7px 10px;font-size:11px;cursor:pointer;border-radius:5px;color:#e2e8f0;white-space:nowrap';
    item.textContent = label;
    item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,.08)'; };
    item.onmouseleave = () => { item.style.background = ''; };
    item.onclick = () => {
      overlay.remove();
      if (label === 'Other…') {
        const custom = prompt('What did you use your ' + LABELS[key].label + ' for?');
        if (!custom) return;
        _actions[key] = custom.trim() || label;
      } else {
        _actions[key] = label;
      }
      renderCombat(_lastInitiativeActive);
    };
    menu.appendChild(item);
  });

  overlay.appendChild(menu);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
