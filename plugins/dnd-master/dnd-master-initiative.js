// dnd-master-initiative.js — initiative tracker: render, move, HP updates
import { storageGetCompanion, storageSetCompanion, realtimePublish, realtimePublishCompanion, localPublish, esc } from '../plugin-sdk.js';
import { publicPayload } from './lk-secrets.js';
import { EV } from './dnd-hub-event-types.js?v=20261014m';
import { publishTo } from './lk-bus.js';
import { loadHubDmCompanion, saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { withPlayerRoll, rollMissing, nextTurn, isDefeated } from './dnd-master-init-order.js';
import { getSRDMonsters } from './dnd-master-monsters.js';
import { fightXp } from './dnd-master-levels.js';

let currentInitiative = null;
let _state = { dmCampaignId: null, dmCampaign: null, serverData: null, userId: null };
let _onEnd = null;
export function setEndCallback(cb) { _onEnd = cb; }
const _selectedRows = new Set(); // indices of initiative rows selected for mass HP

export function setInitiativeSharedState(state) { _state = state; }
export function setInitiativeState(init) { currentInitiative = init; }
export function getInitiativeState() { return currentInitiative; }

// --- Private helpers ---
function rollDice(n, d, mod) { mod = mod || 0; let t = 0; for (let i = 0; i < n; i++) t += Math.ceil(Math.random() * d); return t + mod; }

function renderInitRow(c, i, isCurrent) {
  const isSelected = _selectedRows.has(i);
  const dotColor = c.type === 'player' ? '#3b82f6' : c.type === 'monster' ? '#ef4444' : 'var(--lk-muted)';
  const hpFrac   = c.hpMax > 0 ? c.hp / c.hpMax : 1;
  const hpColor  = hpFrac > 0.5 ? '#22c55e' : hpFrac > 0.25 ? '#f59e0b' : '#ef4444';
  const nameStyle = 'font-size:11px;font-weight:' + (isCurrent ? '800' : '600') +
    ';color:' + (isCurrent ? 'var(--gold)' : 'var(--text)') +
    ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  const conds = c.conditions?.length
    ? '<span style="font-size:9px;color:#f59e0b;margin-left:4px">' + c.conditions.slice(0, 2).join(', ') + '</span>'
    : '';
  const selBg = isSelected ? 'background:rgba(212,175,55,.12);outline:1px solid rgba(212,175,55,.4);' : '';
  const down = isDefeated(c); // skipped by Next turn; HP above 0 brings it back
  return '<div class="init-row' + (isCurrent ? ' current' : '') + '"' +
    ' onclick="toggleInitRow(' + i + ',event)"' + (down ? ' title="Defeated: its turns are skipped"' : '') +
    ' style="cursor:pointer;border-radius:4px;' + selBg + (down ? 'opacity:.45;' : '') + '">' +
    '<div class="init-dot" style="background:' + dotColor + '"></div>' +
    '<div style="font-weight:700;font-size:11px;min-width:14px;color:var(--muted)">' + (c.roll == null ? '…' : c.roll) + '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<div style="' + nameStyle + (down ? ';text-decoration:line-through' : '') + '">' + esc(c.name) + conds + '</div>' +
      '<div style="display:flex;align-items:center;gap:4px;margin-top:2px">' +
        '<div style="font-size:9px;color:var(--muted)">AC ' + c.ac + '</div>' +
        '<div style="flex:1;height:3px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden">' +
          '<div style="width:' + Math.max(0, hpFrac * 100) + '%;height:100%;background:' + hpColor + '"></div>' +
        '</div>' +
        '<span style="font-size:9px;color:var(--muted)">HP</span>' +
        '<input class="hp-input" type="number" value="' + c.hp + '" min="0" max="' + c.hpMax + '"' +
          ' onchange="updateHP(' + i + ',this.value)" onclick="event.stopPropagation()"' +
          ' title="' + c.hp + '/' + c.hpMax + ' HP">' +
        '<span style="font-size:9px;color:var(--muted)">/' + c.hpMax + '</span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

async function saveAndBroadcastInit() {
  const { dmCampaignId, dmCampaign, serverData } = _state;
  dmCampaign.initiative = currentInitiative;
  serverData.campaigns[dmCampaignId].initiative = currentInitiative;
  await saveHubDmCompanion(serverData);
  const initPayload = { type: EV.INITIATIVE_UPDATE, campaignId: dmCampaignId, initiative: currentInitiative, fromUserId: _state.userId };
  await publishTo(['hub', 'player'], EV.INITIATIVE_UPDATE, initPayload);
}

export function renderInitiativeTracker() {
  const el = document.getElementById('tab-initiative');
  if (!el) return;
  const init = currentInitiative;

  if (!init || !init.active || !init.order || !init.order.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px 12px;color:var(--muted)">' +
      '<div style="font-size:28px;margin-bottom:8px">&#x1F3AF;</div>' +
      '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px">No active encounter</div>' +
      '<div style="font-size:11px;line-height:1.5">Build one in <b>Foes → Encounter</b>, then launch it.</div>' +
      '</div>';
    return;
  }

  const cur = init.currentIndex || 0;
  const rows = init.order.map((c, i) => renderInitRow(c, i, i === cur)).join('');

  const massPanel = _selectedRows.size >= 2
    ? '<div style="margin:6px 0;padding:6px 8px;background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.3);border-radius:6px">' +
        '<div style="font-size:9px;color:rgba(212,175,55,.8);margin-bottom:5px">Apply to ' + _selectedRows.size + ' selected (shift-click to select)</div>' +
        '<div style="display:flex;gap:4px">' +
          '<input id="mass-hp-input" type="number" min="1" placeholder="Amount"' +
            ' style="flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:4px 6px;color:#fff;font-size:11px;width:0">' +
          '<button class="btn btn-red" onclick="applyMassHP(true)" title="Deal damage to all selected">-HP</button>' +
          '<button class="btn" style="background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.4);color:#22c55e"' +
            ' onclick="applyMassHP(false)" title="Heal all selected">+HP</button>' +
        '</div>' +
      '</div>'
    : '<div style="font-size:9px;color:var(--muted);text-align:center;padding:3px 0">Shift-click rows to multi-select</div>';

  const missing = init.order.filter(c => c.roll == null);
  const waitBanner = init.waiting
    ? '<div id="init-waiting" style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(212,175,55,.4);border-radius:6px;font-size:10px;color:var(--text)">' +
        'Waiting for initiative from ' + missing.map(c => esc(c.name)).join(', ') +
        '<button class="btn btn-ghost" style="margin-left:6px" onclick="rollMissingInitiative()">Roll for them</button>' +
      '</div>'
    : '';
  const dis = init.waiting ? ' disabled' : '';

  el.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<div style="font-size:11px;color:var(--muted)">Round <strong style="color:var(--gold);font-size:13px">' + init.round + '</strong></div>' +
      '<div style="display:flex;gap:4px">' +
        '<button class="btn btn-ghost" onclick="spawnTokensOnMap()" title="Spawn monster tokens on active map">&#x1F5FA;&#xFE0F;</button>' +
        '<button class="btn btn-ghost" onclick="rerollInitiative()" title="Re-roll all">&#x1F3B2;</button>' +
        '<button class="btn btn-red" onclick="endEncounter()">End</button>' +
      '</div>' +
    '</div>' +
    waitBanner +
    '<div id="init-list" style="margin-bottom:8px">' + rows + '</div>' +
    massPanel +
    '<div style="display:flex;gap:6px;margin-top:6px">' +
      '<button class="btn btn-ghost" style="flex:1"' + dis + ' onclick="moveInitiative(-1)">\u2190 Prev</button>' +
      '<button class="btn btn-gold" style="flex:1"' + dis + ' onclick="moveInitiative(1)">Next \u2192</button>' +
    '</div>';
}

export async function moveInitiative(dir) {
  if (!currentInitiative || !currentInitiative.order || !currentInitiative.order.length) return;
  if (currentInitiative.waiting) return;
  // A monster at 0 HP is defeated (SRD: most monsters die at 0) and takes no more turns; heroes at 0 still get
  // theirs (death saves). The row stays in the list, so the DM can bring it back by giving it HP.
  const { index, wrapped } = nextTurn(currentInitiative.order, currentInitiative.currentIndex, dir);
  currentInitiative.currentIndex = index;
  if (wrapped) currentInitiative.round++;
  await saveAndBroadcastInit();
  renderInitiativeTracker();
}

const tokenIdOf = c => (c.type === 'player' ? 'player_' + c.userId : c.id);

export async function updateHP(idx, val) {
  if (!currentInitiative || !currentInitiative.order[idx]) return;
  currentInitiative.order[idx].hp = Math.max(0, parseInt(val) || 0);
  await saveAndBroadcastInit();
  renderInitiativeTracker();
  const combatant = currentInitiative.order[idx];
  // To the Hub (the token) and the player's sheet. Monsters' tokens are keyed by their own id; this
  // used to send 'player_<monster id>' to the DM sidebar only, so no token ever changed (audit N2).
  await publishTo(['hub', 'player'], EV.HP_CHANGE, { campaignId: _state.dmCampaignId,
    tokenId: tokenIdOf(combatant), hp: combatant.hp, hpMax: combatant.hpMax, fromUserId: _state.userId });
}

/**
 * HP changed somewhere else (the map's Edit HP, an attack's damage, a hero's sheet): the tracker row follows, so a
 * monster killed on the map is shown defeated and loses its turns. It used to keep its old HP.
 */
export async function syncRowHp(tokenId, hp, hpMax) {
  const c = currentInitiative?.active && currentInitiative.order?.find(r => tokenIdOf(r) === tokenId);
  if (!c || hp == null || (c.hp === hp && (hpMax == null || c.hpMax === hpMax))) return;
  c.hp = Math.max(0, Number(hp) || 0);
  if (hpMax != null) c.hpMax = Number(hpMax) || c.hpMax;
  await saveAndBroadcastInit();
  renderInitiativeTracker();
}

export async function rerollInitiative() {
  if (!currentInitiative || !currentInitiative.order) return;
  // Initiative is a Dexterity check (SRD): d20 + DEX. The reroll used to roll a bare d20 for everyone.
  const chars = _state.serverData?.campaigns?.[_state.dmCampaignId]?.characterSummaries || {};
  const srd = getSRDMonsters();
  const modOf = c => c.initMod ?? Math.floor((((c.type === 'player' ? chars[c.userId]?.dex : srd.find(m => m.id === c.monsterId)?.dex) ?? 10) - 10) / 2);
  currentInitiative.order.forEach(c => { c.roll = rollDice(1, 20, modOf(c)); });
  currentInitiative.order.sort((a, b) => b.roll - a.roll);
  currentInitiative.currentIndex = 0;
  currentInitiative.waiting = false; // every row has a roll now
  await saveAndBroadcastInit();
  renderInitiativeTracker();
}

export async function endEncounter() {
  if (!confirm('End encounter and clear initiative?')) return;

  const finished = currentInitiative?.order || []; // for the fight's XP (experience mode)
  // Collect monster IDs before clearing so we can remove their map tokens
  const monsterIds = (currentInitiative?.order || [])
    .filter(c => c.type === 'monster')
    .map(c => c.id);

  _selectedRows.clear();
  currentInitiative = { active: false, round: 1, currentIndex: 0, order: [] };
  _state.dmCampaign.initiative = currentInitiative;
  _state.serverData.campaigns[_state.dmCampaignId].initiative = currentInitiative;
  await saveHubDmCompanion(_state.serverData);
  const endPayload = { type: EV.INITIATIVE_UPDATE, campaignId: _state.dmCampaignId, initiative: currentInitiative, fromUserId: _state.userId };
  await publishTo(['hub', 'player'], EV.INITIATIVE_UPDATE, endPayload);

  // Remove monster tokens from the active map
  if (monsterIds.length) {
    _removeMonsterTokensFromMap(monsterIds).catch(() => {});
  }

  if (_onEnd) _onEnd();
  renderInitiativeTracker();
  fightXp(finished).catch(() => {});
}

async function _removeMonsterTokensFromMap(monsterIds) {
  const freshData = await loadHubDmCompanion();
  if (!freshData) return;
  const campaign = freshData.campaigns?.[_state.dmCampaignId];
  const activeMapId = campaign?.activeMapId;
  if (!activeMapId || !campaign?.maps?.[activeMapId]) return;

  const mapData = campaign.maps[activeMapId];
  if (!mapData.tokens) return;
  const deleted = monsterIds.filter(id => mapData.tokens[id]);
  if (!deleted.length) return;
  deleted.forEach(id => { delete mapData.tokens[id]; });

  await saveHubDmCompanion(freshData);
  const payload = { type: EV.TOKENS_SPAWN, campaignId: _state.dmCampaignId, mapId: activeMapId, tokens: [], deleted, fromUserId: _state.userId };
  localPublish('dnd-hub', EV.TOKENS_SPAWN, payload);
  realtimePublishCompanion('dnd-hub', EV.TOKENS_SPAWN, payload);
}

export function toggleInitRow(idx, e) {
  if (!e?.shiftKey) return;
  if (_selectedRows.has(idx)) _selectedRows.delete(idx);
  else _selectedRows.add(idx);
  renderInitiativeTracker();
}

export async function applyMassHP(isDamage) {
  const amount = parseInt(document.getElementById('mass-hp-input')?.value) || 0;
  if (amount <= 0 || !currentInitiative) return;
  const { dmCampaignId, userId } = _state;
  for (const idx of _selectedRows) {
    const c = currentInitiative.order[idx];
    if (!c) continue;
    c.hp = isDamage ? Math.max(0, c.hp - amount) : Math.min(c.hpMax, c.hp + amount);
    // A player's sheet applies the amount itself (temporary HP, 0 HP and death saves).
    await publishTo(['hub', 'player'], EV.HP_CHANGE, {
      campaignId: dmCampaignId, tokenId: tokenIdOf(c),
      hp: c.hp, hpMax: c.hpMax, fromUserId: userId,
      ...(isDamage ? { damage: amount } : { heal: amount }),
    });
  }
  await saveAndBroadcastInit();
  renderInitiativeTracker();
}

export async function spawnTokensOnMap() {
  if (!currentInitiative?.order?.length) return;
  const { dmCampaignId, userId } = _state;

  // Always read fresh data from hub storage to avoid overwriting recent hub changes.
  const freshData = await loadHubDmCompanion();
  if (!freshData) { alert('Could not read campaign data. Make sure the LanternKeep table is open.'); return; }

  const campaign = freshData.campaigns?.[dmCampaignId];
  if (!campaign) return;
  const activeMapId = campaign.activeMapId;
  if (!activeMapId || !campaign.maps?.[activeMapId]) {
    alert('No active map. Activate a map in the Maps tab first.');
    return;
  }
  const mapData = campaign.maps[activeMapId];
  // bgOffsetX/Y: letterbox offset stored by hub after renderMapBackground.
  // bgScaledW: scaled image width — used to find the map's right edge in canvas pixels.
  const bgOffX = mapData.bgOffsetX ?? 0;
  const bgOffY = mapData.bgOffsetY ?? 0;
  const bgW    = mapData.bgScaledW ?? 0;
  const gs = (mapData.mapCellW && bgW > 0)
    ? bgW / mapData.mapCellW
    : (mapData.gridSize || 40);
  const oy = bgOffY + (mapData.gridOffsetY || 0);
  // Place tokens one full cell outside the map's right edge.
  const spawnX = bgOffX + bgW + gs;
  mapData.tokens = mapData.tokens || {};

  const newTokens = [];
  let row = 0;
  for (const c of currentInitiative.order) {
    if (c.type !== 'monster') continue;
    if (mapData.tokens[c.id]) continue;
    mapData.tokens[c.id] = {
      id: c.id, type: 'monster', name: c.name,
      x: spawnX,
      y: oy + row * gs + gs / 2,
      hp: c.hp, hpMax: c.hpMax, ac: c.ac || 10,
      conditions: [], visible: true,
    };
    newTokens.push(mapData.tokens[c.id]);
    row++;
  }

  if (!newTokens.length) { alert('All monsters are already on the map.'); return; }

  await saveHubDmCompanion(freshData);
  const spawnPayload = { type: EV.TOKENS_SPAWN, campaignId: dmCampaignId, mapId: activeMapId, tokens: newTokens, fromUserId: userId };
  localPublish('dnd-hub', EV.TOKENS_SPAWN, spawnPayload);
  realtimePublishCompanion('dnd-hub', EV.TOKENS_SPAWN, publicPayload(EV.TOKENS_SPAWN, spawnPayload)); // hidden ones travel as stubs (lk-secrets.js)
}

/** A player's own initiative roll (Table rules: playersRollInitiative). */
export async function acceptInitiativeRoll(userId, roll) {
  if (!Number.isFinite(Number(roll))) return;
  const next = withPlayerRoll(currentInitiative, userId, Math.round(Number(roll)));
  if (next === currentInitiative) return;
  currentInitiative = next;
  await saveAndBroadcastInit();
  renderInitiativeTracker();
}

/** The DM rolls for every player who has not (someone stepped away). */
export async function rollMissingInitiative() {
  if (!currentInitiative?.active) return;
  const chars = _state.dmCampaign?.characterSummaries || {};
  currentInitiative = rollMissing(currentInitiative, c => rollDice(1, 20, Math.floor(((chars[c.userId]?.dex || 10) - 10) / 2)));
  await saveAndBroadcastInit();
  renderInitiativeTracker();
}
