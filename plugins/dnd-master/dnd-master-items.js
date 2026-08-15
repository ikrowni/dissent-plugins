// dnd-master-items.js — Items tab: item forge + item library
import { storageGet, storageSet, storageSetCompanion, esc, genId, requestWithTransfer, request, realtimePublish, realtimePublishCompanion } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js?v=20260502p4';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';

let _state = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null };
let _pendingItemImg = null;
const _itemImageUrls = {};
let _lootContests = {};
// { status:'rolling'|'complete', contestKey, itemName, contestants, rolls, winner, winnerName }
let _contestPanel = null;

// Effects builder state
let _forgeEffects = [];  // array of EffectDef objects being built

export function setItemsState(state) { _state = state; }

// Write items+shops to the DM's own storage so players can read a hub-race-proof copy.
async function _persistDmCatalog() {
  try {
    const camp = _state.serverData?.campaigns?.[_state.dmCampaignId];
    if (!camp) return;
    const existing = (await storageGet('dm-catalog')) || { campaigns: {} };
    if (!existing.campaigns) existing.campaigns = {};
    existing.campaigns[_state.dmCampaignId] = {
      items: camp.items || {},
      shops: camp.shops || {},
    };
    await storageSet('dm-catalog', existing);
  } catch { /* non-critical */ }
}

async function _resolveItemImageUrls(items) {
  await Promise.all(
    items
      .filter(it => it.imageFileId && !_itemImageUrls[it.id])
      .map(async it => {
        try {
          const r = await request('files:getUrl', { fileId: it.imageFileId });
          if (r?.url) _itemImageUrls[it.id] = r.url;
        } catch { /* ignore */ }
      })
  );
}

export async function renderItemsTab() {
  const el = document.getElementById('tab-items');
  if (!el) return;
  const items = Object.values(_state.dmCampaign?.items || {});
  await _resolveItemImageUrls(items);

  const _contests = Object.entries(_lootContests);
  const _contestsHtml = _contests.length === 0 ? '' :
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px;letter-spacing:.05em">ACTIVE CONTESTS</div>' +
    _contests.map(([key, c]) =>
      '<div style="background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.2);border-radius:6px;padding:8px 10px;margin-bottom:8px">' +
        '<div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:3px">' + esc(c.itemName) + (c.source === 'shop' ? ' 🏪' : ' ⚔️') + '</div>' +
        '<div style="font-size:10px;color:var(--muted);margin-bottom:6px">Interested: ' + (c.interested.map(p => esc(p.displayName)).join(', ') || 'nobody yet') + '</div>' +
        (_contestPanel?.contestKey === key
          ? '<div style="font-size:10px;color:var(--gold)">⏳ Rolling on map…</div>'
          : '<button class="btn btn-gold" onclick="resolveContest(\'' + key + '\')" style="font-size:10px;padding:3px 10px">🎲 Resolve</button>') +
      '</div>'
    ).join('') +
    '<div style="height:1px;background:var(--border);margin-bottom:10px"></div>';

  const _panelHtml = _contestPanel ? _renderContestPanel() : '';

  el.innerHTML = _panelHtml + _contestsHtml +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">ITEM FORGE</div>' +
    _itemForm() +
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:6px;margin-top:8px;letter-spacing:.05em">ITEM LIBRARY</div>' +
    (items.length === 0
      ? '<div style="font-size:11px;color:var(--muted);text-align:center;padding:8px">No items created yet</div>'
      : items.map(it => _itemRow(it)).join('')
    );

  // Re-render effects list after DOM is built
  _renderForgeEffects();
  // Show correct primary effect panel for default type
  _onForgeTypeChange(document.getElementById('item-type')?.value || 'weapon');
}

function _itemForm() {
  return '<div class="item-form">' +
    '<label>Name</label><input id="item-name" placeholder="Potion of Healing">' +
    '<label>Type</label>' +
    '<select id="item-type" onchange="window._onForgeTypeChange(this.value)"><option value="weapon">Weapon</option><option value="armor">Armor</option><option value="consumable">Consumable</option><option value="misc">Misc</option></select>' +
    '<label>Description</label>' +
    '<textarea id="item-desc" rows="2" placeholder="A red, bubbly liquid…"></textarea>' +
    '<label>Image</label>' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      '<button class="btn btn-ghost" onclick="document.getElementById(\'item-img-input\').click()" style="font-size:10px;padding:3px 8px">Choose…</button>' +
      '<span id="item-img-label" style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis">none</span>' +
    '</div>' +
    '<input type="file" id="item-img-input" accept="image/*" style="display:none" onchange="onItemImgSelected()">' +
    '<div id="item-img-preview" style="display:none;margin-bottom:6px">' +
      '<img id="item-img-thumb" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid rgba(255,255,255,.15)">' +
    '</div>' +
    '<label>Effects</label>' +
    '<div id="forge-primary-effect" style="margin-bottom:6px">' +
      '<div id="forge-weapon-effect" style="display:none">' +
        '<label style="display:block;margin-bottom:3px">To-Hit modifier <input id="forge-toHit" value="+0" style="width:60px"></label>' +
        '<label style="display:block;margin-bottom:3px">Damage dice <input id="forge-damage" value="1d6" style="width:80px"></label>' +
        '<label style="display:block;margin-bottom:3px">Damage type' +
          '<select id="forge-damageType">' +
            '<option>slashing</option><option>piercing</option><option>bludgeoning</option>' +
            '<option>fire</option><option>cold</option><option>lightning</option><option>poison</option>' +
            '<option>psychic</option><option>radiant</option><option>necrotic</option>' +
            '<option>thunder</option><option>acid</option><option>force</option>' +
          '</select>' +
        '</label>' +
      '</div>' +
      '<div id="forge-armor-effect" style="display:none">' +
        '<label style="display:block;margin-bottom:3px">AC value <input id="forge-ac" type="number" value="12" style="width:60px"></label>' +
        '<label style="display:block;margin-bottom:3px"><input id="forge-addDex" type="checkbox" checked> Add DEX modifier</label>' +
        '<label style="display:block;margin-bottom:3px">Max DEX bonus <input id="forge-maxDex" type="number" placeholder="no cap" style="width:60px"></label>' +
        '<label style="display:block;margin-bottom:3px"><input id="forge-isShield" type="checkbox"> Shield (+2 AC, not armor)</label>' +
      '</div>' +
      '<div id="forge-consumable-effect" style="display:none">' +
        '<label style="display:block;margin-bottom:3px">Healing dice (blank = non-healing) <input id="forge-healDice" placeholder="2d4+2" style="width:80px"></label>' +
      '</div>' +
    '</div>' +
    '<div id="forge-additional-effects" style="margin-bottom:6px">' +
      '<div style="font-size:10px;color:var(--muted);margin-bottom:4px">Additional Effects</div>' +
      '<div id="forge-effects-list"></div>' +
      '<div style="display:flex;gap:4px;margin-top:4px">' +
        '<select id="forge-add-effect-type" style="flex:1">' +
          '<option value="">＋ Additional Effect…</option>' +
          '<option value="ac_bonus">AC Bonus</option>' +
          '<option value="hp_max_bonus">HP Max Bonus</option>' +
          '<option value="ability_bonus">Ability Bonus</option>' +
          '<option value="condition_self">Condition on Wearer</option>' +
          '<option value="condition_target">Condition on Hit Target</option>' +
        '</select>' +
        '<button class="btn btn-ghost" onclick="(function(){const sel=document.getElementById(\'forge-add-effect-type\');if(sel.value){window.addForgeEffect(sel.value);sel.value=\'\';}})()">Add</button>' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-gold" onclick="saveNewItem()" style="width:100%;margin-top:8px">&#x2795; Create Item</button>' +
  '</div>';
}

function _renderForgeEffects() {
  const el = document.getElementById('forge-effects-list');
  if (!el) return;
  el.innerHTML = _forgeEffects.map((ef, i) => {
    let fields = '';
    if (ef.type === 'ac_bonus')
      fields = `+<input type="number" value="${ef.value}" style="width:50px" onchange="window._forgeEffectChange(${i},'value',+this.value)"> AC`;
    else if (ef.type === 'hp_max_bonus')
      fields = `+<input type="number" value="${ef.value}" style="width:50px" onchange="window._forgeEffectChange(${i},'value',+this.value)"> HP max`;
    else if (ef.type === 'ability_bonus')
      fields = `<select onchange="window._forgeEffectChange(${i},'ability',this.value)">${['str','dex','con','int','wis','cha'].map(a=>`<option${ef.ability===a?' selected':''}>${a}</option>`).join('')}</select>
               +<input type="number" value="${ef.value}" style="width:50px" onchange="window._forgeEffectChange(${i},'value',+this.value)">`;
    else if (ef.type === 'condition_self')
      fields = `<input value="${esc(ef.condition)}" style="width:100px" onchange="window._forgeEffectChange(${i},'condition',this.value)"> (on wearer)`;
    else if (ef.type === 'condition_target')
      fields = `<input value="${esc(ef.condition)}" style="width:100px" onchange="window._forgeEffectChange(${i},'condition',this.value)"> on hit
               DC<input type="number" value="${ef.saveDC||''}" placeholder="—" style="width:40px" onchange="window._forgeEffectChange(${i},'saveDC',+this.value||undefined)">
               <select onchange="window._forgeEffectChange(${i},'saveAbility',this.value)">${['','str','dex','con','int','wis','cha'].map(a=>`<option${ef.saveAbility===a?' selected':''}>${a||'—'}</option>`).join('')}</select> save`;
    return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
      <span style="min-width:120px;font-size:11px;color:var(--muted)">${ef.type}</span>
      ${fields}
      <button onclick="window.removeForgeEffect(${i})" style="margin-left:auto">✕</button>
    </div>`;
  }).join('');
}

function _forgeEffectChange(idx, field, value) {
  if (_forgeEffects[idx]) _forgeEffects[idx][field] = value;
}

function _onForgeTypeChange(itemType) {
  ['forge-weapon-effect','forge-armor-effect','forge-consumable-effect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (itemType === 'weapon') {
    const el = document.getElementById('forge-weapon-effect');
    if (el) el.style.display = '';
  } else if (itemType === 'armor') {
    const el = document.getElementById('forge-armor-effect');
    if (el) el.style.display = '';
  } else if (itemType === 'consumable') {
    const el = document.getElementById('forge-consumable-effect');
    if (el) el.style.display = '';
  }
}

export function addForgeEffect(type) {
  const defaults = {
    weapon:           { type: 'weapon', toHit: '+0', damage: '1d6', damageType: 'slashing' },
    armor:            { type: 'armor', ac: 12, addDex: true, maxDex: undefined },
    shield:           { type: 'shield' },
    ac_bonus:         { type: 'ac_bonus', value: 1 },
    hp_max_bonus:     { type: 'hp_max_bonus', value: 5 },
    heal:             { type: 'heal', dice: '1d4' },
    ability_bonus:    { type: 'ability_bonus', ability: 'str', value: 1 },
    condition_self:   { type: 'condition_self', condition: 'frightened' },
    condition_target: { type: 'condition_target', condition: 'frightened' },
  };
  const def = defaults[type];
  if (!def) return;
  _forgeEffects.push({ ...def });
  _renderForgeEffects();
}

export function removeForgeEffect(idx) {
  _forgeEffects.splice(idx, 1);
  _renderForgeEffects();
}

export function onItemImgSelected() {
  const input = document.getElementById('item-img-input');
  _pendingItemImg = input?.files?.[0] || null;
  const label   = document.getElementById('item-img-label');
  const preview = document.getElementById('item-img-preview');
  const thumb   = document.getElementById('item-img-thumb');
  if (_pendingItemImg && label && preview && thumb) {
    label.textContent = _pendingItemImg.name;
    preview.style.display = 'block';
    thumb.src = URL.createObjectURL(_pendingItemImg);
  } else if (label && preview) {
    label.textContent = 'none';
    preview.style.display = 'none';
  }
}

export function handleLootInterest(p) {
  const c = _lootContests[p.contestKey] || {
    tokenId:  p.tokenId,
    shopId:   p.shopId,
    itemId:   p.itemId,
    itemName: p.itemName,
    source:   p.source,
    goldCost: p.price || 0,
    interested: [],
  };
  if (!c.interested.find(x => x.userId === p.userId)) {
    c.interested.push({ userId: p.userId, displayName: p.displayName });
  }
  _lootContests[p.contestKey] = c;
  renderItemsTab();
}

export function dismissContestPanel() { _contestPanel = null; renderItemsTab(); }

function _renderContestPanel() {
  const cp = _contestPanel;
  if (!cp) return '';
  const isRolling = cp.status === 'rolling';
  const rollMap = {};
  (cp.rolls || []).forEach(r => { rollMap[r.userId] = r; });
  const contestants = cp.contestants || [];

  const cards = contestants.map(c => {
    const roll = rollMap[c.userId];
    const isWinner = cp.winner === c.userId;
    const bg = isWinner ? 'rgba(212,175,55,.18)' : 'rgba(255,255,255,.04)';
    const border = isWinner ? 'rgba(212,175,55,.6)' : 'var(--border)';
    const label = isRolling ? '🎲…' : (roll ? roll.roll + (roll.tieBreaker ? '*' : '') : '?');
    const color = isWinner ? 'var(--gold)' : 'var(--text)';
    return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;padding:8px 10px;text-align:center;min-width:0">' +
      '<div style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px">' + esc(c.name) + (isWinner ? ' 👑' : '') + '</div>' +
      '<div style="font-size:20px;font-weight:800;color:' + color + '">' + label + '</div>' +
    '</div>';
  });

  const cols = Math.min(contestants.length, 4);
  return '<div style="margin-bottom:12px;padding:10px;background:rgba(0,0,0,.3);border:1px solid rgba(212,175,55,.3);border-radius:8px">' +
    '<div style="font-size:10px;font-weight:700;color:var(--gold);margin-bottom:8px;letter-spacing:.05em">' +
      (isRolling ? '🎲 ROLLING — ' : '🏆 RESULT — ') + esc(cp.itemName) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:6px;margin-bottom:' + (isRolling ? '0' : '8px') + '">' +
      cards.join('') +
    '</div>' +
    (!isRolling
      ? '<div style="font-size:10px;color:var(--muted);text-align:center;cursor:pointer;margin-top:6px" onclick="window._dismissContestPanel()">✕ Dismiss</div>'
      : '') +
  '</div>';
}

export async function resolveContest(contestKey) {
  const contest = _lootContests[contestKey];
  if (!contest || !contest.interested.length) return;

  // Send to DM hub to animate physics dice and return results via CONTEST_RESULT
  _contestPanel = { status: 'rolling', contestKey, itemName: contest.itemName,
    contestants: contest.interested.map(p => ({ userId: p.userId, name: p.displayName })) };
  renderItemsTab();

  await realtimePublishCompanion('dnd-hub', EV.CONTEST_ROLL, {
    type: EV.CONTEST_ROLL, contestKey,
    itemName: contest.itemName,
    contestants: contest.interested.map(p => ({ userId: p.userId, name: p.displayName })),
    campaignId: _state.dmCampaignId,
    fromUserId: _state.userId,
  });
}

export async function handleContestResult(p) {
  const contestKey = p.contestKey;
  const contest = _lootContests[contestKey];
  if (!contest) return; // already resolved or unknown

  const rolls   = p.rolls   || [];
  const winner  = { userId: p.winner, name: p.winnerName };

  // Show head-to-head result panel
  _contestPanel = { status: 'complete', contestKey, itemName: contest.itemName,
    contestants: contest.interested.map(c => ({ userId: c.userId, name: c.displayName })),
    rolls, winner: p.winner, winnerName: p.winnerName };

  // Write pendingRewards for offline-safe delivery
  const camp = _state.serverData.campaigns[_state.dmCampaignId];
  if (!camp.pendingRewards) camp.pendingRewards = {};
  camp.pendingRewards[winner.userId] = [
    ...(camp.pendingRewards[winner.userId] || []),
    { itemId: contest.itemId, qty: 1, source: contest.source, goldCost: contest.goldCost || 0, awardedAt: Date.now() },
  ];

  // Mark claimed on the token if this is a loot contest
  if (contest.source === 'loot' && contest.tokenId) {
    const activeMapId = camp.activeMapId;
    if (activeMapId && camp.maps?.[activeMapId]?.tokens?.[contest.tokenId]) {
      const li = (camp.maps[activeMapId].tokens[contest.tokenId].lootItems || [])
        .find(x => x.itemId === contest.itemId);
      if (li) li.claimed = true;
    }
  }

  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  delete _lootContests[contestKey];

  const payload = {
    type: EV.LOOT_RESOLVED, contestKey,
    winner: winner.userId, winnerName: winner.name,
    itemId: contest.itemId, itemName: contest.itemName,
    rolls, source: contest.source,
    goldCost: contest.goldCost || 0,
    tokenId:  contest.tokenId  || null,
    shopId:   contest.shopId   || null,
    campaignId: _state.dmCampaignId,
    fromUserId: _state.userId,
  };
  await realtimePublishCompanion('dnd-hub',    EV.LOOT_RESOLVED, payload);
  await realtimePublishCompanion('dnd-player', EV.LOOT_RESOLVED, payload);

  renderItemsTab();
}

function _itemRow(item) {
  const imgHtml = _itemImageUrls[item.id]
    ? '<img src="' + _itemImageUrls[item.id] + '" style="width:24px;height:24px;object-fit:cover;border-radius:3px;flex-shrink:0">'
    : '<div style="width:24px;height:24px;border-radius:3px;background:rgba(255,255,255,.06);flex-shrink:0"></div>';
  return '<div class="item-row">' +
    imgHtml +
    '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:10px;background:rgba(212,175,55,.15);color:var(--gold);border:1px solid rgba(212,175,55,.25)">' + esc(item.type) + '</span>' +
    '<span style="flex:1;font-size:11px;font-weight:600">' + esc(item.name) + '</span>' +
    '<button onclick="deleteItem(\'' + item.id + '\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0 2px" title="Delete">&#x2715;</button>' +
  '</div>';
}

export async function saveNewItem() {
  const name = document.getElementById('item-name')?.value.trim();
  if (!name) { alert('Item name is required.'); return; }
  const btn = document.querySelector('#tab-items .btn-gold');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  let imageFileId = null;
  try {
    if (_pendingItemImg) {
      const buf = await _pendingItemImg.arrayBuffer();
      const res = await requestWithTransfer('files:upload',
        { name: _pendingItemImg.name, mime: _pendingItemImg.type, size: _pendingItemImg.size, dmOnly: false, data: buf },
        [buf], 60000);
      imageFileId = res?.id || null;
    }
  } catch (e) {
    alert('Image upload failed: ' + (e?.message || String(e)));
    if (btn) { btn.disabled = false; btn.textContent = '&#x2795; Create Item'; }
    return;
  }

  // Build effects array from forge state
  const itemType = document.getElementById('item-type')?.value || 'misc';
  const effects = [];

  // Primary effect
  if (itemType === 'weapon') {
    effects.push({
      type: 'weapon',
      toHit: document.getElementById('forge-toHit')?.value || '+0',
      damage: document.getElementById('forge-damage')?.value || '1d6',
      damageType: document.getElementById('forge-damageType')?.value || 'slashing',
    });
  } else if (itemType === 'armor') {
    const isShield = document.getElementById('forge-isShield')?.checked;
    if (isShield) {
      effects.push({ type: 'shield' });
    } else {
      const maxDexVal = document.getElementById('forge-maxDex')?.value;
      const ef = {
        type: 'armor',
        ac: parseInt(document.getElementById('forge-ac')?.value) || 12,
        addDex: document.getElementById('forge-addDex')?.checked ?? true,
      };
      if (maxDexVal !== '' && maxDexVal !== undefined) ef.maxDex = parseInt(maxDexVal);
      effects.push(ef);
    }
  } else if (itemType === 'consumable') {
    const healDice = document.getElementById('forge-healDice')?.value.trim();
    if (healDice) effects.push({ type: 'heal', dice: healDice });
  }

  // Additional effects
  effects.push(..._forgeEffects);

  const item = {
    id:          genId(), name,
    type:        itemType,
    description: document.getElementById('item-desc')?.value    || '',
    effects,
    effectsText: '',  // legacy field, empty for new items
    imageFileId,
  };
  if (!_state.dmCampaign.items) _state.dmCampaign.items = {};
  _state.dmCampaign.items[item.id] = item;
  _state.serverData.campaigns[_state.dmCampaignId].items = _state.dmCampaign.items;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  _pendingItemImg = null;
  _forgeEffects = [];
  if (btn) { btn.disabled = false; btn.textContent = '&#x2795; Create Item'; }
  renderItemsTab();
}

export async function deleteItem(id) {
  if (!_state.dmCampaign.items?.[id]) return;
  delete _state.dmCampaign.items[id];
  // Remove from all shops (shops data may still exist on the campaign)
  const shops = _state.dmCampaign.shops || {};
  Object.values(shops).forEach(s => { if (s.items) s.items = s.items.filter(si => si.itemId !== id); });
  _state.dmCampaign.shops = shops;
  _state.serverData.campaigns[_state.dmCampaignId].items = _state.dmCampaign.items;
  _state.serverData.campaigns[_state.dmCampaignId].shops = shops;
  await saveHubDmCompanion(_state.serverData);
  await _persistDmCatalog();
  renderItemsTab();
}

// Expose helpers to window for inline event handlers
window._onForgeTypeChange  = _onForgeTypeChange;
window._forgeEffectChange  = _forgeEffectChange;
