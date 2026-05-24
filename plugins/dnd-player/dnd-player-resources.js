// dnd-player-resources.js — class resource tracker (Phase 9)

let _char = null;
let _saveChar = null;

export function setResourceState(char, saveCharFn) { _char = char; _saveChar = saveCharFn; }

// Class resource definitions: { id, label, recharge: 'short'|'long', maxFn(char) }
const RESOURCES = {
  barbarian: [{ id: 'rage', label: 'Rage', recharge: 'long',
    maxFn: c => 2 + (c.level >= 3 ? 1 : 0) + (c.level >= 6 ? 1 : 0) + (c.level >= 12 ? 1 : 0) + (c.level >= 17 ? 1 : 0) }],
  monk: [{ id: 'ki', label: 'Ki Points', recharge: 'short', maxFn: c => c.level }],
  bard: [{ id: 'bardic_inspiration', label: 'Bardic Inspiration', recharge: c => c.level >= 5 ? 'short' : 'long',
    maxFn: c => Math.max(1, Math.floor(((c.cha ?? 10) - 10) / 2)) }],
  cleric: [{ id: 'channel_divinity', label: 'Channel Divinity', recharge: 'short',
    maxFn: c => c.level >= 18 ? 3 : c.level >= 6 ? 2 : 1 }],
  paladin: [{ id: 'channel_divinity', label: 'Channel Divinity', recharge: 'short', maxFn: () => 1 }],
  druid: [{ id: 'wild_shape', label: 'Wild Shape', recharge: 'short', maxFn: () => 2 }],
  fighter: [
    { id: 'action_surge', label: 'Action Surge', recharge: 'short', maxFn: c => c.level >= 17 ? 2 : 1 },
    { id: 'second_wind', label: 'Second Wind', recharge: 'short', maxFn: () => 1 },
  ],
  sorcerer: [{ id: 'sorcery_points', label: 'Sorcery Points', recharge: 'long', maxFn: c => c.level }],
  warlock: [{ id: 'warlock_slots', label: 'Warlock Spell Slots', recharge: 'short',
    maxFn: c => c.level >= 17 ? 4 : c.level >= 11 ? 3 : c.level >= 2 ? 2 : 1 }],
  wizard: [{ id: 'arcane_recovery', label: 'Arcane Recovery', recharge: 'long', maxFn: () => 1 }],
};

function getClassResources(char) {
  return RESOURCES[char?.class?.toLowerCase()] || [];
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
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${Array.from({length: max}, (_, i) =>
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
