// dnd-hub-combat.js — combat automation: conditions, auto hit/miss, damage, death saves
import { MAP, serverData, userId } from './dnd-hub-state.js?v=20260502p4';
import { storageSet, realtimePublish } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { saveHubDm } from './dnd-hub-storage.js?v=20260502p4';

// ── 5e Conditions ─────────────────────────────────────────────────────────────

export const CONDITIONS = [
  { id: 'Blinded',       icon: '👁', color: '#94a3b8' },
  { id: 'Charmed',       icon: '💖', color: '#ec4899' },
  { id: 'Deafened',      icon: '🔇', color: '#94a3b8' },
  { id: 'Exhaustion',    icon: '😮', color: '#f97316' },
  { id: 'Frightened',    icon: '😱', color: '#a855f7' },
  { id: 'Grappled',      icon: '🤼', color: '#f59e0b' },
  { id: 'Incapacitated', icon: '💤', color: '#6b7280' },
  { id: 'Invisible',     icon: '🌫', color: '#e2e8f0' },
  { id: 'Paralyzed',     icon: '⚡', color: '#facc15' },
  { id: 'Petrified',     icon: '🪨', color: '#78716c' },
  { id: 'Poisoned',      icon: '☠', color: '#22c55e' },
  { id: 'Prone',         icon: '⬇', color: '#6b7280' },
  { id: 'Restrained',    icon: '🕸', color: '#a78bfa' },
  { id: 'Stunned',       icon: '⭐', color: '#fbbf24' },
  { id: 'Unconscious',   icon: '💀', color: '#1f2937' },
];

// Hex lookup for PixiJS (no CSS strings)
export const COND_HEX = Object.fromEntries(
  CONDITIONS.map(c => [c.id, parseInt(c.color.replace('#', ''), 16)])
);

// ── Condition Picker ──────────────────────────────────────────────────────────

let _condPicker = null;

export function showConditionPicker(token, cx, cy) {
  if (_condPicker) { _condPicker.remove(); _condPicker = null; }
  const current = new Set(token.conditions || []);
  const div = document.createElement('div');
  div.className = 'ctx-menu';
  div.style.padding = '8px';
  div.style.minWidth = '170px';
  _condPicker = div;

  div.innerHTML =
    '<div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:6px;letter-spacing:.05em">CONDITIONS</div>' +
    CONDITIONS.map(c =>
      `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px">` +
      `<input type="checkbox" data-id="${c.id}" ${current.has(c.id) ? 'checked' : ''} style="accent-color:${c.color}">` +
      `${c.icon} ${c.id}</label>`
    ).join('') +
    '<div style="margin-top:8px;display:flex;gap:6px">' +
      '<button class="btn btn-ghost btn-sm" style="flex:1" id="_cond-cancel">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" style="flex:1" id="_cond-apply">Apply</button>' +
    '</div>';

  document.body.appendChild(div);
  div.style.position = 'fixed';
  const rect = div.getBoundingClientRect();
  div.style.left = Math.min(cx, window.innerWidth  - rect.width  - 8) + 'px';
  div.style.top  = Math.min(cy, window.innerHeight - rect.height - 8) + 'px';

  div.querySelector('#_cond-cancel').addEventListener('click', () => { div.remove(); _condPicker = null; });
  div.querySelector('#_cond-apply').addEventListener('click', async () => {
    const selected = [...div.querySelectorAll('input[data-id]:checked')].map(i => i.dataset.id);
    div.remove(); _condPicker = null;
    await applyConditions(token, selected, MAP.campaignId);
  });
}

export async function applyConditions(token, conditions, campaignId) {
  token.conditions = conditions;
  if (MAP.mapData && serverData?.campaigns?.[campaignId]?.maps) {
    serverData.campaigns[campaignId].maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  await realtimePublish(EV.TOKEN_CONDITIONS, {
    type: EV.TOKEN_CONDITIONS, campaignId, tokenId: token.id,
    conditions, fromUserId: userId,
  });
}

// ── Set AC ────────────────────────────────────────────────────────────────────

export async function setTokenAC(token, campaignId) {
  const input = prompt(`AC for ${token.name} (current: ${token.ac ?? 10}):`);
  if (input === null) return;
  const ac = parseInt(input.trim());
  if (isNaN(ac)) return;
  token.ac = ac;
  if (MAP.mapData && serverData?.campaigns?.[campaignId]?.maps) {
    serverData.campaigns[campaignId].maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  // Broadcast updated token so other clients see new AC
  await realtimePublish(EV.TOKENS_SPAWN, {
    type: EV.TOKENS_SPAWN, campaignId,
    mapId: MAP.mapId, tokens: [token], fromUserId: userId,
  });
}

// ── Auto Hit / Miss ───────────────────────────────────────────────────────────

export function checkAutoHit(rollResult) {
  if (!MAP.mapData || !MAP.selectedTokens.size) return;
  const targets = [...MAP.selectedTokens]
    .map(id => MAP.mapData.tokens?.[id])
    .filter(Boolean);
  if (!targets.length) return;

  const results = targets.map(t => {
    const ac = t.ac ?? 10;
    const hit = rollResult >= ac;
    return `${t.name}: ${hit ? '✅ HIT' : '❌ MISS'} (AC ${ac})`;
  });

  showCombatToast(`Roll ${rollResult} — ${results.join(' | ')}`);
  if (rollResult === 20) showCombatToast('⚔️ CRITICAL HIT!');
}

// ── Auto Damage ───────────────────────────────────────────────────────────────

export async function applyAutoDamage(damage, campaignId) {
  if (!MAP.mapData || !MAP.selectedTokens.size) return;
  const targets = [...MAP.selectedTokens]
    .map(id => MAP.mapData.tokens?.[id])
    .filter(Boolean);
  if (!targets.length) return;

  if (targets.length > 1) {
    _massDamageModal(damage, targets, campaignId);
  } else {
    await _damageToken(targets[0], damage, campaignId);
  }
}

function _massDamageModal(damage, targets, campaignId) {
  const existing = document.getElementById('_mass-dmg-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = '_mass-dmg-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9998';
  modal.innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;min-width:240px;max-width:300px">' +
      '<div style="font-size:13px;font-weight:700;color:var(--dnd-gold);margin-bottom:12px">Apply ' + damage + ' Damage</div>' +
      targets.map(t =>
        `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border)">${t.name} ` +
        `(${t.hp}/${t.hpMax} HP) → ${Math.max(0, t.hp - damage)}</div>`
      ).join('') +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
        '<button id="_mass-cancel" class="btn btn-ghost" style="flex:1">Cancel</button>' +
        '<button id="_mass-confirm" class="btn btn-red" style="flex:1">Apply All</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  document.getElementById('_mass-cancel').addEventListener('click', () => modal.remove());
  document.getElementById('_mass-confirm').addEventListener('click', async () => {
    modal.remove();
    for (const t of targets) await _damageToken(t, damage, campaignId);
  });
}

async function _damageToken(token, damage, campaignId) {
  const prev = token.hp;
  token.hp = Math.max(0, token.hp - damage);
  if (MAP.mapData && serverData?.campaigns?.[campaignId]?.maps) {
    serverData.campaigns[campaignId].maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  await realtimePublish(EV.HP_CHANGE, {
    type: EV.HP_CHANGE, campaignId, tokenId: token.id,
    hp: token.hp, hpMax: token.hpMax, fromUserId: userId,
  });
  if (prev > 0 && token.hp === 0) await triggerDeathSave(token.id, campaignId);
}

// ── Death Saves ───────────────────────────────────────────────────────────────

export async function triggerDeathSave(tokenId, campaignId) {
  await realtimePublish(EV.TOKEN_DEATH_SAVE, {
    type: EV.TOKEN_DEATH_SAVE, campaignId, tokenId,
    successes: 0, failures: 0, fromUserId: userId,
  });
}

// ── Combat Toast ──────────────────────────────────────────────────────────────

export function showCombatToast(text) {
  let el = document.getElementById('combat-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'combat-toast';
    el.style.cssText =
      'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);' +
      'background:rgba(0,0,0,.88);border:1px solid var(--border);border-radius:8px;' +
      'padding:8px 16px;font-size:12px;color:var(--text);z-index:9001;' +
      'pointer-events:none;display:none;text-align:center;max-width:340px';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}
