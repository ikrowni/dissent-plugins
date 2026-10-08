// dnd-player-resources.js — class resource tracker (Phase 9)

import { heroRules } from './lk-levelling.js';

let _char = null;
let _saveChar = null;

export function setResourceState(char, saveCharFn) { _char = char; _saveChar = saveCharFn; }

// Class resource definitions: { id, label, recharge: 'short'|'long', maxFn(char) }
const RESOURCES = {
  barbarian: [{ id: 'rage', label: 'Rage', recharge: 'long',
    maxFn: c => c.level >= 20 ? 99 : 2 + (c.level >= 3 ? 1 : 0) + (c.level >= 6 ? 1 : 0) + (c.level >= 12 ? 1 : 0) + (c.level >= 17 ? 1 : 0) }],
  monk: [{ id: 'ki', label: 'Ki Points', recharge: 'short', minLevel: 2, maxFn: c => c.level }],
  bard: [{ id: 'bardic_inspiration', label: 'Bardic Inspiration', recharge: c => c.level >= 5 ? 'short' : 'long',
    maxFn: c => Math.max(1, Math.floor(((c.cha ?? 10) - 10) / 2)) }],
  cleric: [{ id: 'channel_divinity', label: 'Channel Divinity', recharge: 'short', minLevel: 2,
    maxFn: c => c.level >= 18 ? 3 : c.level >= 6 ? 2 : 1 }],
  paladin: [{ id: 'channel_divinity', label: 'Channel Divinity', recharge: 'short', minLevel: 3, maxFn: () => 1 }],
  druid: [{ id: 'wild_shape', label: 'Wild Shape', recharge: 'short', minLevel: 2, maxFn: () => 2 }],
  fighter: [
    { id: 'action_surge', label: 'Action Surge', recharge: 'short', minLevel: 2, maxFn: c => c.level >= 17 ? 2 : 1 },
    { id: 'second_wind', label: 'Second Wind', recharge: 'short', maxFn: () => 1 },
  ],
  sorcerer: [{ id: 'sorcery_points', label: 'Sorcery Points', recharge: 'long', minLevel: 2, maxFn: c => c.level }],
  // Warlock Pact Magic slots are real spell slots now (lk-rules5e maxSlotsFor), refilled on a short rest.
  wizard: [{ id: 'arcane_recovery', label: 'Arcane Recovery', recharge: 'long', maxFn: () => 1 }],
};

// The 2024 rules (a hero made under Table rules → Rules: 2024; SRD 5.2.1 class tables). Uses that come back one at a
// time on a short rest are marked 'short' here: the sheet refills them all, a simplification the table can correct.
const by = (rows, l) => rows.filter(([from]) => l >= from).pop()?.[1] ?? 0;
const RESOURCES_2024 = {
  barbarian: [{ id: 'rage', label: 'Rage', recharge: 'long', maxFn: c => by([[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]], c.level) }],
  monk: [{ id: 'ki', label: 'Focus Points', recharge: 'short', minLevel: 2, maxFn: c => c.level }],
  bard: RESOURCES.bard,
  cleric: [{ id: 'channel_divinity', label: 'Channel Divinity', recharge: 'short', minLevel: 2, maxFn: c => by([[2, 2], [6, 3], [18, 4]], c.level) }],
  paladin: [
    { id: 'lay_on_hands', label: 'Lay On Hands (HP)', recharge: 'long', pool: true, maxFn: c => 5 * c.level },
    { id: 'channel_divinity', label: 'Channel Divinity', recharge: 'short', minLevel: 3, maxFn: c => by([[3, 2], [11, 3]], c.level) },
  ],
  druid: [{ id: 'wild_shape', label: 'Wild Shape', recharge: 'short', minLevel: 2, maxFn: c => by([[2, 2], [6, 3], [17, 4]], c.level) }],
  fighter: [
    { id: 'action_surge', label: 'Action Surge', recharge: 'short', minLevel: 2, maxFn: c => c.level >= 17 ? 2 : 1 },
    { id: 'second_wind', label: 'Second Wind', recharge: 'short', maxFn: c => by([[1, 2], [4, 3], [10, 4]], c.level) },
  ],
  ranger: [{ id: 'favored_enemy', label: "Hunter's Mark (free)", recharge: 'long', maxFn: c => by([[1, 2], [5, 3], [9, 4], [13, 5], [17, 6]], c.level) }],
  sorcerer: RESOURCES.sorcerer,
  wizard: RESOURCES.wizard,
};

// minLevel: the class level that grants it (audit L1 — Ki, Channel Divinity, Wild Shape, Action Surge and
// Sorcery Points all used to show at level 1).
function getClassResources(char) {
  const table = heroRules(char) === '2024' ? RESOURCES_2024 : RESOURCES;
  return (table[char?.class?.toLowerCase()] || []).filter(r => (char.level || 1) >= (r.minLevel || 1));
}

function getMax(def, char) {
  return typeof def.maxFn === 'function' ? def.maxFn(char) : def.maxFn;
}

export function renderResources() {
  const el = document.getElementById('tab-resources');
  if (!el || !_char) return;
  const defs = getClassResources(_char);
  if (!defs.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">No class resources for this class.</div>';
    return;
  }
  if (!_char.resources) _char.resources = {};
  el.innerHTML = defs.map(def => {
    const max = getMax(def, _char);
    const cur = _char.resources[def.id] ?? max;
    const recharge = typeof def.recharge === 'function' ? def.recharge(_char) : def.recharge;
    return `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:12px;font-weight:600;color:var(--text)">${def.label}</span>
          <span style="font-size:10px;color:var(--muted)">${cur}/${max} · ${recharge} rest</span>
        </div>
        ${def.pool ? `<input type="number" min="0" max="${max}" value="${cur}" aria-label="${def.label} left"
            onchange="setResourceValue('${def.id}', this.value, ${max})" style="width:80px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px">` : ''}
        <div style="display:${def.pool ? 'none' : 'flex'};gap:6px;flex-wrap:wrap">
          ${def.pool ? '' : Array.from({length: max}, (_, i) =>
            `<div onclick="toggleResourcePip('${def.id}',${i},${max})" style="width:24px;height:24px;border-radius:50%;
              cursor:pointer;border:2px solid var(--dnd-gold);
              background:${i < cur ? 'var(--dnd-gold)' : 'transparent'};
              transition:background .12s"></div>`
          ).join('')}
        </div>
      </div>`;
  }).join('') +
  '<div style="padding-top:10px;font-size:10px;color:var(--muted);text-align:center">Use Short/Long Rest in the main tab to restore resources.</div>';
}

/** A pool spent by number (Lay On Hands): what is left, 0 to max. */
export function setResourceValue(id, value, max) {
  if (!_char) return;
  if (!_char.resources) _char.resources = {};
  _char.resources[id] = Math.max(0, Math.min(max, parseInt(value, 10) || 0));
  _saveChar().catch(() => {});
  renderResources();
}

export function toggleResourcePip(id, index, max) {
  if (!_char) return;
  if (!_char.resources) _char.resources = {};
  const cur = _char.resources[id] ?? max;
  // Clicking a filled pip spends it; clicking empty restores one
  _char.resources[id] = index < cur ? index : index + 1;
  _saveChar().catch(() => {});
  renderResources();
}

export function restoreResourcesOnShortRest(char) {
  if (!char?.class) return;
  const defs = getClassResources(char);
  if (!char.resources) char.resources = {};
  defs.forEach(def => {
    const recharge = typeof def.recharge === 'function' ? def.recharge(char) : def.recharge;
    if (recharge === 'short') char.resources[def.id] = getMax(def, char);
  });
}

export function restoreResourcesOnLongRest(char) {
  if (!char?.class) return;
  const defs = getClassResources(char);
  if (!char.resources) char.resources = {};
  defs.forEach(def => { char.resources[def.id] = getMax(def, char); });
}
