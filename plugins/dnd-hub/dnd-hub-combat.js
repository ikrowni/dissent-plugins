// dnd-hub-combat.js — combat automation: conditions, auto hit/miss, damage, death saves
import { MAP, serverData, userId, effectiveGs } from './dnd-hub-state.js?v=20261015b';
import { storageSet } from '../plugin-sdk.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { EV } from './dnd-hub-event-types.js?v=20261015b';
import { saveHubDm } from './dnd-hub-storage.js?v=20261015b';
import { rule } from './lk-table-rules.js';
import { attackVerdict, attackCheck, attackTurnCheck } from './dnd-hub-rules.js';
import { limitingTurnId } from './dnd-hub-turn-move.js';
import { publishTo, isRepeat } from './lk-bus.js';
import { renderTokens } from './dnd-hub-tokens.js?v=20261015b';
import { moveToast } from './dnd-hub-turn-move.js';

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
  if (!tableRule('autoHit') || !MAP.mapData) return null;
  if (!MAP.selectedTokens.size && !MAP.isDM) {
    // No target picked: the one enemy standing next to my hero, if there is exactly one (a melee swing).
    const near = adjacentEnemies(rollerId);
    if (near.length === 1) { MAP.selectedTokens.add(near[0].id); renderTokens(); }
    else { moveToast(near.length ? 'Several enemies are next to you: click the one you attack, then roll.'
      : 'No target: click the enemy you attack on the map, then roll.'); return null; }
  }
  if (!MAP.selectedTokens.size) return null;
  const targets = [...MAP.selectedTokens].map(id => MAP.mapData.tokens?.[id]).filter(Boolean);
  const v = attackVerdict(targets, natural, total);
  if (v?.hitIds.length) _pendingHit = { rollerId, hitIds: v.hitIds, crit: !!v.crit, at: Date.now() };
  return v;
}

const _attacksUsed = {}; // turn key → weapon attacks I have made this turn

/**
 * Before a weapon attack from my sheet is rolled (owner, 2026-10-05): is there a target, is it in reach, is it my
 * turn with an attack left (Extra Attack counts), and does flanking, long range or a nearby enemy give advantage or
 * disadvantage? `weapon` = { reach (lk-rules5e weaponReach), perAction }. Returns attackCheck's answer plus `target`.
 */
export function preAttack(rollerId, weapon) {
  const toks = Object.values(MAP.mapData?.tokens || {});
  const me = toks.find(t => t.type === 'player' && t.userId === rollerId && !t.waiting);
  if (!me) return { ok: false, reason: 'Your token is not on the map yet.' };
  let target = [...MAP.selectedTokens].map(id => MAP.mapData.tokens[id]).find(Boolean);
  if (!target) {
    const near = adjacentEnemies(rollerId);
    if (near.length !== 1) return { ok: false, reason: near.length ? 'Several enemies are next to you: click the one you attack, then roll.'
      : 'No target: click the enemy you attack on the map, then roll.' };
    target = near[0];
    MAP.selectedTokens.add(target.id); renderTokens();
  }
  const turnId = limitingTurnId();
  const key = MAP.turnMove?.key || 'none';
  const turn = attackTurnCheck({ fightOn: !!turnId, myTurn: turnId === me.id, used: _attacksUsed[key] || 0, perAction: weapon?.perAction || 1 });
  if (!turn.ok) return turn;
  const r = attackCheck({ attacker: me, target, reach: weapon?.reach, tokens: toks, gs: effectiveGs(MAP.mapData), flanking: tableRule('flanking') });
  if (r.ok && turnId) _attacksUsed[key] = (_attacksUsed[key] || 0) + 1;
  return { ...r, target };
}

/**
 * My turn has come: target the closest enemy I can see (owner, 2026-10-05), unless I already picked one that is still
 * standing. My next attack is against it; clicking another enemy changes it.
 */
export function focusClosestEnemy() {
  if (MAP.isDM || !MAP.mapData?.tokens) return;
  const toks = Object.values(MAP.mapData.tokens);
  const me = toks.find(t => t.type === 'player' && t.userId === userId && !t.waiting);
  if (!me) return;
  const still = [...MAP.selectedTokens].some(id => (MAP.mapData.tokens[id]?.hp ?? 0) > 0);
  if (still) return;
  const foes = toks.filter(t => t.type === 'monster' && (t.hp ?? 1) > 0 && MAP.tokenSprites?.[t.id]?.visible !== false);
  if (!foes.length) return;
  const near = foes.reduce((a, b) => (Math.hypot(a.x - me.x, a.y - me.y) <= Math.hypot(b.x - me.x, b.y - me.y) ? a : b));
  MAP.selectedTokens.clear();
  MAP.selectedTokens.add(near.id);
  renderTokens();
}

/** Visible monsters within one square of `uid`'s hero. */
function adjacentEnemies(uid) {
  const tokens = Object.values(MAP.mapData?.tokens || {});
  const me = tokens.find(t => t.type === 'player' && t.userId === uid && !t.waiting);
  if (!me) return [];
  const gs = effectiveGs(MAP.mapData);
  return tokens.filter(t => t.type === 'monster' && t.visible !== false && (t.hp ?? 1) > 0
    && MAP.tokenSprites?.[t.id]?.visible !== false // one the player can see right now
    && Math.max(Math.abs(t.x - me.x), Math.abs(t.y - me.y)) <= gs * 1.5);
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
  if (MAP.isDM) await damageTokens(h.hitIds, damage, MAP.campaignId, { crit: h.crit });
  else await publishTo([], EV.DAMAGE_REQUEST, { campaignId: MAP.campaignId, tokenIds: h.hitIds, damage, crit: h.crit, fromUserId: userId });
  return true;
}

/**
 * The DM's Hub applies `damage` to each token (the damage request, the monster attack panel). `crit`: it was a
 * critical hit, which a hero already at 0 HP counts as two death-save failures (their sheet applies it).
 */
export async function damageTokens(tokenIds, damage, campaignId, { crit = false } = {}) {
  for (const id of tokenIds) {
    const t = MAP.mapData?.tokens?.[id];
    if (t) await _damageToken(t, damage, campaignId, crit);
  }
}

async function _damageToken(token, damage, campaignId, crit = false) {
  const prev = token.hp;
  token.hp = Math.max(0, token.hp - damage);
  if (MAP.mapData && serverData?.campaigns?.[campaignId]?.maps) {
    serverData.campaigns[campaignId].maps[MAP.mapId] = MAP.mapData;
    await saveHubDm( serverData);
  }
  // The DM sidebar and the player's sheet hear it too; a player's sheet applies the damage itself.
  await publishTo(['master', 'player'], EV.HP_CHANGE, {
    campaignId, tokenId: token.id, hp: token.hp, hpMax: token.hpMax, damage, ...(crit ? { crit: true } : {}), fromUserId: userId,
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
