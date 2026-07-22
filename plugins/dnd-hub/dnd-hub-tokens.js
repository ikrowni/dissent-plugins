// dnd-hub-tokens.js — token rendering and drag interaction
import { MAP, serverData, userId, TOKEN_COLORS, effectiveGs, SIZE_SCALE, SIZE_CELLS } from './dnd-hub-state.js?v=20260502p4';
import { storageSet, realtimePublish, debounceStorageSet, request, esc } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { renderFog } from './dnd-hub-fog.js?v=20260502p4';
import { computeLocalPlayerLOS } from './dnd-hub-los.js?v=20260502p4';
import { wouldCrossWall } from './dnd-hub-walls.js?v=20260502p4';
import { startRuler, updateRuler, clearRuler, showActiveTurnRing, hideActiveTurnRing } from './dnd-hub-ruler.js?v=20260502p4';
import { COND_HEX, showConditionPicker, setTokenAC } from './dnd-hub-combat.js?v=20260502p4';
import { showTriggerToast } from './dnd-hub-triggers.js?v=20260502p4';
import { saveHubDm } from './dnd-hub-storage.js?v=20260502p4';

// Portrait texture cache — keyed by portraitFileId
const _portraitCache = new Map();  // fileId → PIXI.Texture
const _portraitLoading = new Set(); // fileIds currently being fetched
const _tokenDataCache = new Map(); // tokenId → last JSON.stringify of token data

export function clearTokenCache() { _tokenDataCache.clear(); }


export function renderTokens() {
  const layers = MAP.layers;
  if (!layers?.tokens || !MAP.mapData) return;
  // (incremental update — only remove/rebuild changed tokens)
  if (!MAP.tokenSprites) MAP.tokenSprites = {};

  const mapData = MAP.mapData;
  const gs = effectiveGs(mapData);
  const campaign = serverData?.campaigns?.[MAP.campaignId];
  if (!campaign) return;

  // Ensure player tokens exist for all campaign members
  const summaries = campaign.characterSummaries || {};
  let changed = false;
  (campaign.members || []).forEach((uid, idx) => {
    const summary = summaries[uid];
    if (!summary) return;
    const tokenId = `player_${uid}`;
    if (!mapData.tokens[tokenId]) {
      const ox = (MAP._bgOffset?.x ?? 0) + (mapData.gridOffsetX ?? 0);
      const oy = (MAP._bgOffset?.y ?? 0) + (mapData.gridOffsetY ?? 0);
      mapData.tokens[tokenId] = {
        id: tokenId, type: 'player', userId: uid,
        name: summary.name || 'Unknown',
        x: ox + (2 + idx * 2) * gs, y: oy + 3 * gs,
        visionRadius: 60,
        hp: summary.hp || 10, hpMax: summary.hpMax || 10,
        conditions: [], visible: true, colorIdx: idx % TOKEN_COLORS.length,
        portraitUrl:    summary.portraitUrl    || '',
        portraitFileId: summary.portraitFileId || '',
      };
      changed = true;
    }
  });
  if (changed) {
    saveHubDm( serverData); // fire-and-forget
    // Tell all clients to add the newly created tokens
    const spawnedTokens = (campaign.members || [])
      .map(uid => mapData.tokens[`player_${uid}`]).filter(Boolean);
    realtimePublish(EV.TOKENS_SPAWN, {
      type: EV.TOKENS_SPAWN, campaignId: MAP.campaignId,
      mapId: MAP.mapId, tokens: spawnedTokens, fromUserId: userId,
    });
  }

  // Remove sprites for tokens that no longer exist
  for (const tid of Object.keys(MAP.tokenSprites)) {
    if (!mapData.tokens[tid]) {
      MAP.tokenSprites[tid]?.parent?.removeChild(MAP.tokenSprites[tid]);
      delete MAP.tokenSprites[tid];
      _tokenDataCache.delete(tid);
    }
  }

  // Rebuild only tokens whose data changed
  Object.values(mapData.tokens).forEach(token => {
    if (!token.visible && !MAP.isDM) {
      // Hidden from player: remove sprite if it exists
      if (MAP.tokenSprites[token.id]) {
        MAP.tokenSprites[token.id].parent?.removeChild(MAP.tokenSprites[token.id]);
        delete MAP.tokenSprites[token.id];
        _tokenDataCache.delete(token.id);
      }
      return;
    }
    const cacheKey = JSON.stringify(token);
    const existing = MAP.tokenSprites[token.id];
    if (existing && _tokenDataCache.get(token.id) === cacheKey) {
      if (!existing.parent) layers.tokens.addChild(existing);
      return;
    }
    if (existing?.parent) layers.tokens.removeChild(existing);
    const container = buildTokenSprite(token, gs);
    layers.tokens.addChild(container);
    MAP.tokenSprites[token.id] = container;
    _tokenDataCache.set(token.id, cacheKey);
  });

  // Reposition active-turn ring to match rebuilt sprite
  if (MAP.activeTurnTokenId) {
    const spr = MAP.tokenSprites[MAP.activeTurnTokenId];
    const gs = effectiveGs(MAP.mapData);
    if (spr) showActiveTurnRing(spr.x, spr.y, Math.floor(gs * 0.42));
    else hideActiveTurnRing();
  }
}

export function buildTokenSprite(token, gs) {
  const r = Math.floor(gs * 0.42);
  const color = token.type === 'player'
    ? TOKEN_COLORS[token.colorIdx ?? 0]
    : (token.type === 'monster' ? 0xef4444 : 0x94a3b8);

  const g = new PIXI.Graphics();
  g.circle(0, 0, r).fill(color);
  g.circle(0, 0, r).stroke({ color: 0xffffff, alpha: 0.5, width: 1.5 });

  if (token.hpMax > 0) {
    const barW = r * 1.8;
    const frac = Math.max(0, token.hp / token.hpMax);
    g.rect(-barW / 2, r + 3, barW, 4).fill({ color: 0x000000, alpha: 0.6 });
    if (frac > 0) {
      const barColor = frac > 0.5 ? 0x22c55e : frac > 0.25 ? 0xf59e0b : 0xef4444;
      g.rect(-barW / 2, r + 3, barW * frac, 4).fill(barColor);
    }
  }

  const label = new PIXI.Text({
    text: (token.name || '?').slice(0, 8),
    style: new PIXI.TextStyle({ fill: 0xffffff, fontSize: 9, fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } }),
  });
  label.anchor.set(0.5, 0);
  label.y = r + 10;

  const container = new PIXI.Container();

  let portraitSprite = null;
  const cachedTexture = token.portraitFileId ? _portraitCache.get(token.portraitFileId) : null;

  if (cachedTexture) {
    // Use cached portrait texture
    portraitSprite = new PIXI.Sprite(cachedTexture);
    portraitSprite.width  = r * 2;
    portraitSprite.height = r * 2;
    portraitSprite.anchor.set(0.5, 0.5);

    // Circular mask
    const mask = new PIXI.Graphics();
    mask.circle(0, 0, r).fill(0xffffff);
    portraitSprite.mask = mask;
    container.addChild(mask);
  } else if (token.portraitFileId && !_portraitLoading.has(token.portraitFileId)) {
    // Trigger async load — re-render once done
    _portraitLoading.add(token.portraitFileId);
    _loadPortrait(token.portraitFileId).then(() => {
      _portraitLoading.delete(token.portraitFileId);
      renderTokens(); // re-render with cached texture
    }).catch(() => {
      _portraitLoading.delete(token.portraitFileId);
    });
  }

  if (portraitSprite) {
    container.addChild(g, portraitSprite, label);
    // Draw ring on top of portrait
    const ring = new PIXI.Graphics();
    ring.circle(0, 0, r).stroke({ color: TOKEN_COLORS[token.colorIdx ?? 0], alpha: 0.9, width: 3 });
    container.addChild(ring);
  } else {
    container.addChild(g, label);
  }

  // Condition dots — colored circles below HP bar, up to 6 shown
  const conditions = token.conditions || [];
  if (conditions.length) {
    const condG = new PIXI.Graphics();
    const count = Math.min(conditions.length, 6);
    const startX = -((count - 1) * 5);
    conditions.slice(0, 6).forEach((cid, i) => {
      condG.circle(startX + i * 10, r + 25, 3.5).fill(COND_HEX[cid] || 0x94a3b8);
    });
    container.addChild(condG);
  }

  // Facing arrow — small triangle just outside the ring pointing in movement direction
  if (token.facing != null) {
    const rad   = token.facing * Math.PI / 180;
    const tipD  = r + Math.max(6, r * 0.4);
    const baseD = r;
    const span  = 0.55; // radians half-spread of base
    const arrowG = new PIXI.Graphics();
    arrowG.poly([
      Math.cos(rad)        * tipD,  Math.sin(rad)        * tipD,
      Math.cos(rad + span) * baseD, Math.sin(rad + span) * baseD,
      Math.cos(rad - span) * baseD, Math.sin(rad - span) * baseD,
    ]).fill({ color: 0xffffff, alpha: 0.8 });
    container.addChild(arrowG);
  }

  // Lootable ring — gold static ring signals to players that this token has loot
  if (token.lootable) {
    const lootRing = new PIXI.Graphics();
    lootRing.circle(0, 0, r + 6).stroke({ color: 0xd4af37, width: 2.5, alpha: 0.85 });
    container.addChild(lootRing);
  }

  // Death overlay: skull + dark circle when token is at 0 HP
  if (token.hpMax > 0 && token.hp <= 0) {
    const deathOverlay = new PIXI.Graphics();
    deathOverlay.circle(0, 0, r).fill({ color: 0x000000, alpha: 0.55 });
    container.addChild(deathOverlay);
    const skullText = new PIXI.Text({
      text: '☠',
      style: new PIXI.TextStyle({ fontSize: Math.max(10, Math.floor(r * 0.75)), fill: 0xffffff }),
    });
    skullText.anchor.set(0.5, 0.5);
    container.addChild(skullText);
  }

  const sizeScale = SIZE_SCALE[token.size || 'medium'] || 1.0;
  const cells     = SIZE_CELLS[token.size || 'medium'] || 1;
  container.scale.set(sizeScale);
  container.x = token.x;
  container.y = token.y;
  container.tokenId = token.id;

  // Selection ring (DM shift-select)
  if (MAP.selectedTokens.has(token.id)) {
    const selRing = new PIXI.Graphics();
    selRing.circle(0, 0, r + 6).stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
    container.addChild(selRing);
  }

  if (token.locked) {
    const lockBadge = new PIXI.Text({
      text: '🔒',
      style: new PIXI.TextStyle({ fontSize: Math.max(7, Math.floor(r * 0.5)), fill: 0xffffff }),
    });
    lockBadge.anchor.set(0.5, 0.5);
    lockBadge.x =  r * 0.65;
    lockBadge.y = -r * 0.65;
    container.addChild(lockBadge);
  }

  // turnLock faded overlay — non-active player tokens can't move when turnLock is on
  const settings = serverData?.campaigns?.[MAP.campaignId]?.settings;
  if (settings?.turnLock && MAP.activeTurnTokenId && MAP.activeTurnTokenId !== token.id) {
    const overlay = new PIXI.Graphics();
    overlay.circle(0, 0, r).fill({ color: 0x000000, alpha: 0.45 });
    container.addChild(overlay);
  }

  // Ghost overlay for tokens hidden from players — DM only sees this
  if (MAP.isDM && !token.visible) {
    const ghostG = new PIXI.Graphics();
    ghostG.circle(0, 0, r + 2).fill({ color: 0x000000, alpha: 0.55 });
    container.addChild(ghostG);
    const eyeLabel = new PIXI.Text({
      text: '🙈',
      style: new PIXI.TextStyle({ fontSize: Math.max(8, Math.floor(r * 0.65)), fill: 0xffffff }),
    });
    eyeLabel.anchor.set(0.5, 0.5);
    container.addChild(eyeLabel);
    container.alpha = 0.65;
  }

  setupTokenDrag(container, token);
  return container;
}

async function _loadPortrait(fileId) {
  const res = await request('files:loadArrayBuffer', { fileId });
  if (!res?.buffer) throw new Error('no buffer');
  const blob = new Blob([res.buffer], { type: res.mime || 'image/png' });
  const url  = URL.createObjectURL(blob);
  const texture = await PIXI.Assets.load(url);
  _portraitCache.set(fileId, texture);
}

function setupTokenDrag(container, token) {
  const canDrag = MAP.isDM || token.userId === userId;
  if (!canDrag) return;

  if (token.locked) {
    container.eventMode = 'static';
    container.cursor    = 'not-allowed';
    return;
  }

  // turnLock: non-active combatants cannot drag during initiative
  const settings = serverData?.campaigns?.[MAP.campaignId]?.settings;
  if (settings?.turnLock && MAP.activeTurnTokenId && MAP.activeTurnTokenId !== token.id && !MAP.isDM) {
    container.eventMode = 'static';
    container.cursor = 'not-allowed';
    return;
  }

  container.eventMode = 'static';
  container.cursor = 'grab';
  let dragging = false, lastPublish = 0;

  container.on('pointerdown', e => {
    if (MAP.activeTool !== 'select') return;
    // Shift-click: DM multi-select
    if (e.shiftKey && MAP.isDM) {
      if (MAP.selectedTokens.has(token.id)) MAP.selectedTokens.delete(token.id);
      else MAP.selectedTokens.add(token.id);
      renderTokens();
      e.stopPropagation();
      return;
    }
    MAP.selectedToken = token.id;
    dragging = true; container.cursor = 'grabbing'; e.stopPropagation();
    // Auto-ruler for active-turn token
    if (MAP.activeTurnTokenId === token.id) {
      startRuler(token.x, token.y);
    }
  });

  container.on('globalpointermove', e => {
    if (!dragging) return;
    const pos = e.getLocalPosition(MAP.layers.tokens);
    container.x = pos.x; container.y = pos.y;
    const now = Date.now();
    if (now - lastPublish > 30) {
      lastPublish = now;
      realtimePublish(EV.TOKEN_MOVE, { type: EV.TOKEN_MOVE, campaignId: MAP.campaignId, tokenId: token.id, x: pos.x, y: pos.y, fromUserId: userId });
    }
    if (MAP.activeTurnTokenId === token.id) {
      updateRuler(pos.x, pos.y);
    }
  });

  container.on('pointerup', async () => {
    if (!dragging) return;
    dragging = false; container.cursor = 'grab';

    // Snap to grid (offset-aware so tokens land inside image grid cells)
    const gs = MAP.mapData ? effectiveGs(MAP.mapData) : 40;
    const ox = (MAP._bgOffset?.x ?? 0) + (MAP.mapData?.gridOffsetX ?? 0);
    const oy = (MAP._bgOffset?.y ?? 0) + (MAP.mapData?.gridOffsetY ?? 0);
    const sKey  = MAP.mapData?.tokens?.[token.id]?.size || 'medium';
    const cells = SIZE_CELLS[sKey] || 1;
    // Large+ snap to grid corner; small/medium snap to cell center
    const snappedX = cells > 1
      ? Math.round((container.x - ox) / gs) * gs + ox
      : Math.round((container.x - ox) / gs) * gs + gs / 2 + ox;
    const snappedY = cells > 1
      ? Math.round((container.y - oy) / gs) * gs + oy
      : Math.round((container.y - oy) / gs) * gs + gs / 2 + oy;

    // Wall collision — revert to last saved position if move would cross a wall or locked door
    const savedX = MAP.mapData?.tokens?.[token.id]?.x ?? snappedX;
    const savedY = MAP.mapData?.tokens?.[token.id]?.y ?? snappedY;
    if (_crossesWallForSize(token, savedX, savedY, snappedX, snappedY, gs)) {
      container.x = savedX; container.y = savedY;
      clearRuler();
      return;
    }

    container.x = snappedX; container.y = snappedY;

    // Accumulate moved distance for turn budget, then clear ruler
    if (MAP.activeTurnTokenId === token.id && MAP.rulerStart) {
      const gs = MAP.mapData ? effectiveGs(MAP.mapData) : 40;
      const dx = snappedX - MAP.rulerStart.x;
      const dy = snappedY - MAP.rulerStart.y;
      MAP.turnMovedDistance += Math.round(Math.sqrt(dx * dx + dy * dy) / gs * 5);
    }
    // Per-token overage tracking (all tokens, not just active turn)
    {
      const movedFt = Math.round(Math.hypot(snappedX - savedX, snappedY - savedY) / gs * 5);
      if (movedFt > 0) {
        const soFar = (MAP.turnMovedDistances.get(token.id) || 0) + movedFt;
        MAP.turnMovedDistances.set(token.id, soFar);
        const tokenSpeed = MAP.mapData?.tokens?.[token.id]?.speed || 30;
        if (soFar > tokenSpeed) {
          const toastEl = document.createElement('div');
          toastEl.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid #f59e0b;color:#fbbf24;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5)';
          toastEl.textContent = `Movement exceeds your speed for this turn (${soFar}ft of ${tokenSpeed}ft used).`;
          document.body.appendChild(toastEl);
          setTimeout(() => toastEl.remove(), 4000);
          realtimePublish(EV.MOVEMENT_OVERAGE, {
            type: EV.MOVEMENT_OVERAGE, campaignId: MAP.campaignId,
            tokenId: token.id, tokenName: token.name, distanceMoved: soFar, speed: tokenSpeed, fromUserId: userId,
          });
        }
      }
    }
    clearRuler();

    if (MAP.mapData?.tokens?.[token.id]) {
      // Update facing when token moves more than half a cell
      const moveDx = snappedX - savedX;
      const moveDy = snappedY - savedY;
      if (Math.sqrt(moveDx * moveDx + moveDy * moveDy) > gs * 0.5) {
        MAP.mapData.tokens[token.id].facing = Math.round(Math.atan2(moveDy, moveDx) * 180 / Math.PI);
      }
      MAP.mapData.tokens[token.id].x = snappedX;
      MAP.mapData.tokens[token.id].y = snappedY;
      serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
      saveHubDm( serverData);
    }

    // Recompute local LOS after player moves their own token
    if (!MAP.isDM) { computeLocalPlayerLOS(); renderFog(); }

    realtimePublish(EV.TOKEN_MOVE, { type: EV.TOKEN_MOVE, campaignId: MAP.campaignId, tokenId: token.id, x: snappedX, y: snappedY, facing: MAP.mapData?.tokens?.[token.id]?.facing ?? null, fromUserId: userId });
  });

  container.on('pointerupoutside', () => { if (dragging) { dragging = false; container.cursor = 'grab'; } });
}

function _crossesWallForSize(token, fromX, fromY, toX, toY, gs) {
  const cells = SIZE_CELLS[token.size || 'medium'] || 1;
  const half  = cells * gs / 2;
  if (cells <= 1) return wouldCrossWall(fromX, fromY, toX, toY);
  return [[-half, -half], [half, -half], [-half, half], [half, half]]
    .some(([dx, dy]) => wouldCrossWall(fromX + dx, fromY + dy, toX + dx, toY + dy));
}

// ── Context Menu ──────────────────────────────────────────────────────────────

// ── Monster attack rolls ──────────────────────────────────────────────────────

function _rollExpr(expr) {
  const s = String(expr).trim().replace(/\s/g, '');
  const plain = Number(s);
  if (!isNaN(plain)) return plain;
  const m = s.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return 0;
  let t = parseInt(m[3] || '0');
  const n = parseInt(m[1]) || 1, d = parseInt(m[2]) || 6;
  for (let i = 0; i < n; i++) t += Math.floor(Math.random() * d) + 1;
  return t;
}

function _showAttackToast(attackerName, attackName, d20, total, toHit, damage, isCrit) {
  const el = document.createElement('div');
  const hitColor = isCrit ? '#f59e0b' : '#22c55e';
  el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid rgba(255,255,255,.2);color:#e2e8f0;padding:10px 16px;border-radius:8px;font-size:12px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5);min-width:220px;text-align:center';
  el.innerHTML =
    `<div style="font-weight:700;margin-bottom:4px">⚔️ ${esc(attackerName)} — ${esc(attackName)}</div>` +
    `<div>Attack: <span style="color:${hitColor};font-weight:700">${d20}</span>${isCrit ? ' 🎯 CRIT!' : ''} (${d20} + ${toHit} = <b>${total}</b>)</div>` +
    `<div>Damage: <b>${damage}</b></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function _showMonsterAttackPanel(token, panelX, panelY) {
  document.getElementById('monster-atk-panel')?.remove();
  const attacks = token.attacks || [];
  if (!attacks.length) { return; }

  const panel = document.createElement('div');
  panel.id = 'monster-atk-panel';
  panel.style.cssText = `position:fixed;left:${panelX}px;top:${panelY}px;background:#1e1e2e;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:8px;z-index:9998;min-width:200px;box-shadow:0 4px 20px rgba(0,0,0,.6)`;
  panel.innerHTML =
    `<div style="font-size:11px;font-weight:700;color:var(--dnd-gold,#f59e0b);margin-bottom:6px">⚔️ ${esc(token.name)}</div>` +
    attacks.map((a, i) =>
      `<div style="padding:6px 10px;border-radius:5px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;color:#e2e8f0;font-size:11px"
           id="atk-row-${i}"
           onmouseenter="this.style.background='rgba(255,255,255,.08)'"
           onmouseleave="this.style.background=''"
           onclick="window._doAtkRoll(${i})">
        <span>${esc(a.name)}</span>
        <span style="color:#94a3b8;font-size:10px">+${a.toHit} / ${esc(a.damageDice)} | ${a.rangeFt ?? 5}ft</span>
      </div>`
    ).join('');
  document.body.appendChild(panel);

  window._doAtkRoll = (i) => {
    const a = attacks[i];
    MAP.selectedAttack = a;
    // Range check: if another token is selected, warn if it's out of range
    if (MAP.selectedToken && MAP.selectedToken !== token.id && MAP.mapData?.tokens) {
      const target = MAP.mapData.tokens[MAP.selectedToken];
      if (target) {
        const gs     = effectiveGs(MAP.mapData);
        const distFt = Math.round(Math.hypot(target.x - token.x, target.y - token.y) / gs * 5);
        if (distFt > a.rangeFt) {
          showTriggerToast(`⚠ ${esc(a.name)}: target is out of range (${distFt}ft — max ${a.rangeFt}ft)`);
        }
      }
    }
    const d20   = Math.floor(Math.random() * 20) + 1;
    const total = d20 + a.toHit;
    const dmg   = _rollExpr(a.damageDice);
    panel.remove();
    _showAttackToast(token.name, a.name, d20, total, a.toHit, dmg, d20 === 20);
  };

  setTimeout(() => {
    document.addEventListener('mousedown', function dismiss(e) {
      if (!panel.contains(e.target)) { panel.remove(); document.removeEventListener('mousedown', dismiss); }
    });
  }, 0);
}

let _ctxMenu = null;

/** Destroy the currently open context menu (if any). */
export function destroyContextMenu() {
  if (_ctxMenu) {
    if (_ctxMenu._dismiss) document.removeEventListener('mousedown', _ctxMenu._dismiss);
    _ctxMenu.remove();
    _ctxMenu = null;
  }
}

/**
 * Show a context menu for the given token at viewport coords (cx, cy).
 * @param {object} token  — token data object from MAP.mapData.tokens
 * @param {number} cx     — e.clientX
 * @param {number} cy     — e.clientY
 */
export function showContextMenu(token, cx, cy) {
  destroyContextMenu();

  const isOwnToken = token.userId === userId;
  const canAct = MAP.isDM || isOwnToken;
  if (!canAct) return;

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  _ctxMenu = menu;

  // ── Player-accessible items ────────────────────────────────────────────
  _addItem(menu, '📏 Measure Movement', () => {
    startRuler(token.x, token.y);
    destroyContextMenu();
  });

  _addItem(menu, '🎲 Roll Attack', () => {}, true);        // Phase 3
  _addItem(menu, '📖 Character Sheet', () => {}, true);    // Phase 4

  if (token.lootable && (token.lootItems || []).some(li => !li.claimed)) {
    _addItem(menu, '🔍 Search for Loot', () => { destroyContextMenu(); _openLootModal(token.id, token); });
  }

  // ── DM-only items ──────────────────────────────────────────────────────
  if (MAP.isDM) {
    _addSep(menu);

    _addItem(menu, '❤️ Edit HP', async () => {
      destroyContextMenu();
      const input = prompt(`HP for ${token.name} (current: ${token.hp}/${token.hpMax}):`);
      if (input === null) return;
      const [hpStr, maxStr] = input.split('/');
      const hp    = parseInt(hpStr.trim());
      const hpMax = maxStr ? parseInt(maxStr.trim()) : token.hpMax;
      if (isNaN(hp)) return;
      token.hp = hp;
      if (!isNaN(hpMax)) token.hpMax = hpMax;
      if (MAP.mapData && serverData?.campaigns?.[MAP.campaignId]?.maps) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        await saveHubDm( serverData);
      }
      await realtimePublish(EV.HP_CHANGE, {
        type: EV.HP_CHANGE, campaignId: MAP.campaignId,
        tokenId: token.id, hp: token.hp, hpMax: token.hpMax, fromUserId: userId,
      });
      renderTokens();
    });

    _addItem(menu, '⚡ Apply Condition', () => {
      destroyContextMenu();
      showConditionPicker(token, cx, cy);
    });

    _addItem(menu, '🛡 Set AC', async () => {
      destroyContextMenu();
      await setTokenAC(token, MAP.campaignId);
    });

    _addItem(menu, '⚔️ Set as Active Turn', async () => {
      destroyContextMenu();
      await realtimePublish(EV.TOKEN_TURN_START, {
        type: EV.TOKEN_TURN_START, campaignId: MAP.campaignId,
        tokenId: token.id, fromUserId: userId,
      });
    });

    _addItem(menu, '⚖️ Set Size', () => {
      destroyContextMenu();
      _showSizeDialog(token);
    });

    _addItem(menu, token.locked ? '🔓 Unlock Token' : '🔒 Lock Token', async () => {
      destroyContextMenu();
      token.locked = !token.locked;
      if (MAP.mapData && serverData?.campaigns?.[MAP.campaignId]?.maps) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        await saveHubDm( serverData);
      }
      await realtimePublish(EV.TOKENS_SPAWN, {
        type: EV.TOKENS_SPAWN, campaignId: MAP.campaignId,
        mapId: MAP.mapId, tokens: [token], fromUserId: userId,
      });
      renderTokens();
    });

    _addItem(menu, token.visible ? '🙈 Hide from Players' : '👁 Reveal to Players', async () => {
      destroyContextMenu();
      token.visible = !token.visible;
      if (MAP.mapData && serverData?.campaigns?.[MAP.campaignId]?.maps) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        await saveHubDm( serverData);
      }
      renderTokens();
      await realtimePublish(EV.TOKENS_SPAWN, {
        type: EV.TOKENS_SPAWN, campaignId: MAP.campaignId,
        mapId: MAP.mapId, tokens: [token], fromUserId: userId,
      });
    });

    if (token.type === 'monster' || token.type === 'npc') {
      if (token.attacks?.length) {
        _addItem(menu, '⚔️ Monster Actions', () => {
          destroyContextMenu();
          _showMonsterAttackPanel(token, cx, cy);
        });
      }

      _addItem(menu, token.dead ? '♟ Remove Death Mark' : '☠️ Mark as Dead', async () => {
        destroyContextMenu();
        token.dead = !token.dead;
        if (token.dead) token.hp = 0;
        if (MAP.mapData && serverData?.campaigns?.[MAP.campaignId]?.maps) {
          serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
          await saveHubDm( serverData);
        }
        if (token.dead) {
          await realtimePublish(EV.HP_CHANGE, {
            type: EV.HP_CHANGE, campaignId: MAP.campaignId,
            tokenId: token.id, hp: 0, hpMax: token.hpMax, fromUserId: userId,
          });
        }
        await realtimePublish(EV.TOKENS_SPAWN, {
          type: EV.TOKENS_SPAWN, campaignId: MAP.campaignId,
          mapId: MAP.mapId, tokens: [token], fromUserId: userId,
        });
        renderTokens();
      }, false, token.dead ? '' : 'danger');

      _addItem(menu, token.lootable ? '🏴 Remove Lootable' : '💰 Mark as Lootable', async () => {
        destroyContextMenu();
        token.lootable = !token.lootable;
        if (MAP.mapData && serverData?.campaigns?.[MAP.campaignId]?.maps) {
          serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
          await saveHubDm( serverData);
        }
        await realtimePublish(EV.TOKENS_SPAWN, {
          type: EV.TOKENS_SPAWN, campaignId: MAP.campaignId,
          mapId: MAP.mapId, tokens: [token], fromUserId: userId,
        });
        renderTokens();
      });
    }

    _addSep(menu);

    _addItem(menu, '🗑 Remove Token', async () => {
      destroyContextMenu();
      if (!confirm(`Remove token "${token.name}"? This will also remove them from the initiative tracker.`)) return;

      // Remove from map
      delete MAP.mapData.tokens[token.id];

      // Remove from initiative order and adjust currentIndex
      const initiative = serverData?.campaigns?.[MAP.campaignId]?.initiative;
      if (initiative?.order) {
        initiative.currentIndex = initiative.currentIndex ?? 0;
        const removedIdx = initiative.order.findIndex(c => c.id === token.id);
        if (removedIdx !== -1) {
          initiative.order.splice(removedIdx, 1);
          if (removedIdx <= initiative.currentIndex && initiative.currentIndex > 0) {
            initiative.currentIndex = Math.max(0, initiative.currentIndex - 1);
          }
        }
      }

      if (MAP.mapData && serverData?.campaigns?.[MAP.campaignId]?.maps) {
        serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
        await saveHubDm( serverData);
      }

      renderTokens();

      await realtimePublish(EV.TOKENS_SPAWN, {
        type: EV.TOKENS_SPAWN, campaignId: MAP.campaignId,
        mapId: MAP.mapId, tokens: [], deleted: [token.id], fromUserId: userId,
      });

      if (initiative) {
        await realtimePublish(EV.INITIATIVE_UPDATE, {
          type: EV.INITIATIVE_UPDATE, campaignId: MAP.campaignId,
          initiative, fromUserId: userId,
        });
      }
    }, false, 'danger');
  }

  // ── Positioning & dismiss ──────────────────────────────────────────────
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.min(cx, vw - rect.width  - 8) + 'px';
  menu.style.top  = Math.min(cy, vh - rect.height - 8) + 'px';

  const dismiss = (e) => {
    if (!menu.contains(e.target)) { destroyContextMenu(); document.removeEventListener('mousedown', dismiss); }
  };
  menu._dismiss = dismiss;
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);

  window.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { destroyContextMenu(); window.removeEventListener('keydown', esc); }
  }, { once: true });
}

async function _showSizeDialog(token) {
  const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:#1a1610;border:1px solid rgba(212,175,55,.4);border-radius:8px;padding:12px;' +
    'z-index:9999;min-width:180px;font-family:system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.7)';
  d.innerHTML = '<div style="font-size:11px;font-weight:700;color:#d4af37;margin-bottom:8px">Token Size</div>' +
    SIZES.map(s =>
      `<button onclick="window._setSizeFor('${s}')" style="display:block;width:100%;margin:2px 0;padding:5px 8px;text-align:left;` +
      `background:${s === (token.size || 'medium') ? 'rgba(212,175,55,.2)' : 'rgba(255,255,255,.05)'};` +
      `border:1px solid rgba(255,255,255,.12);border-radius:5px;color:#fff;font-size:11px;cursor:pointer">` +
      s[0].toUpperCase() + s.slice(1) + '</button>'
    ).join('') +
    '<button onclick="this.closest(\'div\').remove()" style="margin-top:6px;width:100%;padding:5px;background:transparent;' +
    'border:1px solid rgba(255,255,255,.15);border-radius:5px;color:rgba(255,255,255,.5);font-size:10px;cursor:pointer">Cancel</button>';
  document.body.appendChild(d);
  window._setSizeFor = async (size) => {
    d.remove();
    delete window._setSizeFor;
    token.size = size;
    if (MAP.mapData && serverData?.campaigns?.[MAP.campaignId]?.maps) {
      serverData.campaigns[MAP.campaignId].maps[MAP.mapId] = MAP.mapData;
      await saveHubDm( serverData);
    }
    await realtimePublish(EV.TOKENS_SPAWN, {
      type: EV.TOKENS_SPAWN, campaignId: MAP.campaignId,
      mapId: MAP.mapId, tokens: [token], fromUserId: userId,
    });
    renderTokens();
  };
}

async function _openLootModal(tokenId, token) {
  const campaign   = serverData?.campaigns?.[MAP.campaignId];
  const itemLib    = campaign?.items || {};
  const unclaimed  = (token.lootItems || []).filter(li => !li.claimed);
  const playerName = campaign?.characterSummaries?.[userId]?.name || 'Player';

  // Batch-resolve image URLs for items in this loot table
  const imageUrls = {};
  await Promise.all(unclaimed.map(async li => {
    const item = itemLib[li.itemId];
    if (item?.imageFileId) {
      try {
        const r = await request('files:getUrl', { fileId: item.imageFileId });
        if (r?.url) imageUrls[li.itemId] = r.url;
      } catch { /* no image */ }
    }
  }));

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,sans-serif';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1e1e2e;border:1px solid rgba(212,175,55,.35);border-radius:10px;padding:20px;min-width:300px;max-width:400px;max-height:75vh;overflow-y:auto';

  const itemsHtml = unclaimed.length === 0
    ? '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:16px">Nothing left to loot.</div>'
    : unclaimed.map(li => {
        const item = itemLib[li.itemId];
        if (!item) return '';
        const imgHtml = imageUrls[li.itemId]
          ? '<img src="' + imageUrls[li.itemId] + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0">'
          : '<div style="width:48px;height:48px;border-radius:6px;background:#2a2a40;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">📦</div>';
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:#2a2a40;border-radius:8px;margin-bottom:8px">' +
          imgHtml +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:12px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(item.name) + '</div>' +
            '<div style="font-size:10px;color:#94a3b8">' + esc(item.type) + (li.qty > 1 ? ' · ×' + li.qty : '') + '</div>' +
          '</div>' +
          '<button data-itemid="' + item.id + '" data-itemname="' + esc(item.name) + '" class="loot-want-btn" ' +
            'style="flex-shrink:0;padding:5px 12px;border-radius:6px;border:1px solid rgba(212,175,55,.4);background:rgba(212,175,55,.12);color:#d4af37;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap">I Want This</button>' +
        '</div>';
      }).join('');

  modal.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
      '<span style="font-size:14px;font-weight:700;color:#d4af37">🔍 ' + esc(token.name) + ' — Loot</span>' +
      '<button id="loot-modal-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;line-height:1">✕</button>' +
    '</div>' +
    itemsHtml;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('loot-modal-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  modal.querySelectorAll('.loot-want-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId   = btn.dataset.itemid;
      const itemName = btn.dataset.itemname;
      btn.textContent = '✓ Interested';
      btn.disabled = true;
      btn.style.opacity = '0.55';
      realtimePublish(EV.LOOT_INTEREST, {
        type: EV.LOOT_INTEREST,
        contestKey: tokenId + '_' + itemId,
        tokenId, shopId: null,
        itemId, itemName,
        price: 0, source: 'loot',
        userId, displayName: playerName,
        campaignId: MAP.campaignId, fromUserId: userId,
      });
    });
  });
}

function _addItem(menu, label, onClick, disabled = false, extraClass = '') {
  const item = document.createElement('div');
  item.className = 'ctx-menu-item' + (disabled ? ' disabled' : '') + (extraClass ? ' ' + extraClass : '');
  item.innerHTML = label;
  if (!disabled) item.addEventListener('click', onClick);
  menu.appendChild(item);
}

function _addSep(menu) {
  const sep = document.createElement('div');
  sep.className = 'ctx-menu-sep';
  menu.appendChild(sep);
}
