// dnd-hub-combat.js — combat automation: conditions, auto hit/miss, damage, death saves
import { MAP, serverData, userId } from './dnd-hub-state.js?v=20261007v';
import { storageSet } from '../plugin-sdk.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { EV } from './dnd-hub-event-types.js?v=20261007k';
import { saveHubDm } from './dnd-hub-storage.js?v=20261006s';
import { rule } from './lk-table-rules.js';
import { attackVerdict } from './dnd-hub-rules.js';
import { publishTo, isRepeat } from './lk-bus.js';

// ── 5e Conditions ─────────────────────────────────────────────────────────────

export const CONDITIONS = [
  { id: 'Blinded',       icon: '👁', color: 'var(--lk-muted)' },
  { id: 'Charmed',       icon: '💖', color: '#ec4899' },
  { id: 'Deafened',      icon: '🔇', color: 'var(--lk-muted)' },
  { id: 'Exhaustion',    icon: '😮', color: '#f97316' },
  { id: 'Frightened',    icon: '😱', color: '#a855f7' },
  { id: 'Grappled',      icon: '🤼', color: '#f59e0b' },
  { id: 'Incapacitated', icon: '💤', color: '#6b7280' },
  { id: 'Invisible',     icon: '🌫', color: 'var(--lk-text)' },
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
  // Only the DM's screen keeps the map record.
  if (MAP.isDM && MAP.mapData && serverData?.campaigns?.[campaignId]?.maps) {
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

const tableRule = k => rule(serverData?.campaigns?.[MAP.campaignId]?.settings, k);

// ── Auto Hit / Miss ───────────────────────────────────────────────────────────

let _pendingHit = null; // { rollerId, hitIds, at }: the last attack judged on this screen that hit something

/**
 * The verdict for an attack rolled on THIS screen, against the targets selected here (audit G6), or null when the
 * table does not judge attacks (`autoHit` off) or nothing is selected. It rides in the dice:roll event, so every
 * screen shows this one verdict.
 */
export function judgeAttack(total, natural, rollerId) {
  _pendingHit = null;
  if (!tableRule('autoHit') || !MAP.mapData || !MAP.selectedTokens.size) return null;
  const targets = [...MAP.selectedTokens].map(id => MAP.mapData.tokens?.[id]).filter(Boolean);
  const v = attackVerdict(targets, natural, total);
  if (v?.hitIds.length) _pendingHit = { rollerId, hitIds: v.hitIds, at: Date.now() };
  return v;
}

// ── Auto Damage ───────────────────────────────────────────────────────────────

/**
 * A damage roll right after a judged hit by the same roller comes off the targets that were hit, when the table
 * applies damage (`autoDamage`). Only the DM's Hub may change HP, so a player's Hub asks it to (DAMAGE_REQUEST).
 */
export async function applyPendingDamage(rollerId, damage) {
  const h = _pendingHit;
  _pendingHit = null;
  if (!h || h.rollerId !== rollerId || Date.now() - h.at > 60_000 || !tableRule('autoDamage')) return false;
  if (MAP.isDM) await damageTokens(h.hitIds, damage, MAP.campaignId);
  else await publishTo([], EV.DAMAGE_REQUEST, { campaignId: MAP.campaignId, tokenIds: h.hitIds, damage, fromUserId: userId });
  return true;
}

/** The DM's Hub applies `damage` to each token (the damage request, the monster attack panel). */
export async function damageTokens(tokenIds, damage, campaignId) {
  for (const id of tokenIds) {
    const t = MAP.mapData?.tokens?.[id];
    if (t) await _damageToken(t, damage, campaignId);
  }
}

async function _damageToken(token, damage, campaignId) {
  const prev = token.hp;
  token.hp = Math.max(0, token.hp - damage);
  if (MAP.mapData && serverData?.campaigns?.[campaignId]?.maps) {
    serverData.campaigns[campaignId].maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  // The DM sidebar and the player's sheet hear it too; a player's sheet applies the damage itself.
  await publishTo(['master', 'player'], EV.HP_CHANGE, {
    campaignId, tokenId: token.id, hp: token.hp, hpMax: token.hpMax, damage, fromUserId: userId,
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
