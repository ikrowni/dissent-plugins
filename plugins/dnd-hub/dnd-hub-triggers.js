// dnd-hub-triggers.js — trigger tile rendering, placement, and activation (Phase 7)
import { MAP, serverData, userId, effectiveGs } from './dnd-hub-state.js?v=20261014n';
import { storageSet, genId, esc, request } from '../plugin-sdk.js';
import { publishTo } from './lk-bus.js'; // trap events carry an id (isRepeat): a sheet that hears one twice applies it once
import { EV } from './dnd-hub-event-types.js?v=20261014n';
import { saveHubDm } from './dnd-hub-storage.js?v=20261014n';
import { rule } from './lk-table-rules.js';

import { guarded } from './lk-upload.js';
import { pickCell } from './dnd-hub-trigger-pick.js';
import { publishMove, moveStamp, renderTokens } from './dnd-hub-tokens.js?v=20261014n';
import { toPoint, clampToMap, turnFor, commitPath } from './dnd-hub-turn-move.js';
import { renderLights } from './dnd-hub-lights.js?v=20261014n';
import { renderFog } from './dnd-hub-fog.js?v=20261014n';
let _triggerSprites = [];  // { id, gfx, label } — tracked for selective removal

// ── Grid helpers ───────────────────────────────────────────────────────────────

function worldToCell(wx, wy) {
  const md  = MAP.mapData;
  const gs  = effectiveGs(md);
  const ox  = (MAP._bgOffset?.x ?? 0) + (md?.gridOffsetX || 0);
  const oy  = (MAP._bgOffset?.y ?? 0) + (md?.gridOffsetY || 0);
  return { cx: Math.floor((wx - ox) / gs), cy: Math.floor((wy - oy) / gs) };
}

function cellToWorld(cx, cy) {
  const md  = MAP.mapData;
  const gs  = effectiveGs(md);
  const ox  = (MAP._bgOffset?.x ?? 0) + (md?.gridOffsetX || 0);
  const oy  = (MAP._bgOffset?.y ?? 0) + (md?.gridOffsetY || 0);
  return { wx: ox + cx * gs, wy: oy + cy * gs };
}

// ── Dice helper ────────────────────────────────────────────────────────────────

function rollDiceExpr(expr) {
  if (!expr) return 0;
  const s = String(expr).trim();
  const plain = Number(s);
  if (!isNaN(plain)) return plain;
  const m = s.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return 0;
  const count = parseInt(m[1]) || 1;
  const sides = parseInt(m[2]) || 6;
  const bonus = parseInt(m[3]) || 0;
  let total = bonus;
  for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
  return total;
}

// ── Render ─────────────────────────────────────────────────────────────────────

export function renderTriggers() {
  const uiLayer = MAP.layers?.ui;
  if (!uiLayer) return;

  _triggerSprites.forEach(({ gfx, label }) => {
    if (gfx.parent) gfx.parent.removeChild(gfx);
    if (label?.parent) label.parent.removeChild(label);
  });
  _triggerSprites = [];

  if (!MAP.isDM) return;
  if (!MAP.mapData?.triggers?.length) return;

  const gs = effectiveGs(MAP.mapData);

  for (const trig of MAP.mapData.triggers) {
    const { wx, wy } = cellToWorld(trig.cx, trig.cy);
    const isSelected = trig.id === MAP.activeTriggerId;

    const gfx = new PIXI.Graphics();
    const color = isSelected ? 0xef4444 : (trig.type === 'trap' ? 0xf59e0b : 0xa855f7);
    gfx.lineStyle(2, color, 0.9);
    gfx.beginFill(color, isSelected ? 0.35 : 0.18);
    gfx.drawRoundedRect(0, 0, gs - 2, gs - 2, 4);
    gfx.endFill();
    gfx.x = wx + 1;
    gfx.y = wy + 1;
    gfx.eventMode = 'none';

    const icon = trig.type === 'trap' ? '🪤' : trig.type === 'teleport' ? '🌀' : trig.type === 'message' ? '💬' : '⚙️';
    const style = new PIXI.TextStyle({ fontSize: Math.max(10, gs * 0.45), fill: '#ffffff' });
    const label = new PIXI.Text(icon, style);
    label.x = gfx.x + (gs - label.width) / 2;
    label.y = gfx.y + (gs - label.height) / 2;
    label.eventMode = 'none';

    uiLayer.addChild(gfx);
    uiLayer.addChild(label);
    _triggerSprites.push({ id: trig.id, gfx, label });

    // A teleporter's exit: a ring on its square and a dotted line from the entrance, so the DM sees the pair.
    if (trig.type === 'teleport' && trig.destCx != null && trig.destCy != null) {
      const to = cellToWorld(trig.destCx, trig.destCy);
      const exit = new PIXI.Graphics();
      exit.eventMode = 'none';
      const a = { x: wx + gs / 2, y: wy + gs / 2 }, b = { x: to.wx + gs / 2, y: to.wy + gs / 2 };
      const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.floor(len / 10);
      for (let i = 0; i < n; i += 2) {
        exit.moveTo(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)
          .lineTo(a.x + (b.x - a.x) * (i + 1) / n, a.y + (b.y - a.y) * (i + 1) / n);
      }
      if (n) exit.stroke({ color, width: 2, alpha: 0.6 });
      exit.circle(b.x, b.y, gs * 0.42).fill({ color, alpha: 0.15 }).stroke({ color, width: 2, alpha: 0.9 });
      const tag = new PIXI.Text({ text: 'exit', style: new PIXI.TextStyle({ fontSize: Math.max(9, gs * 0.26), fill: '#e9d5ff', fontWeight: 'bold' }) });
      tag.anchor.set(0.5, 0.5);
      tag.x = b.x; tag.y = b.y;
      tag.eventMode = 'none';
      uiLayer.addChild(exit, tag);
      _triggerSprites.push({ id: trig.id, gfx: exit, label: tag });
    }
  }
}

// ── Persistence ────────────────────────────────────────────────────────────────

export async function saveTriggersAndBroadcast() {
  // The open map into the campaign first, as every other tool does: when the two had come apart (a merge swapped
  // one of them), a trap's change — a one-shot trap spent — was never written, and came back armed (rules playtest).
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (camp?.maps && MAP.mapId && MAP.mapData) camp.maps[MAP.mapId] = MAP.mapData;
  await saveHubDm( serverData);
  renderTriggers();
}

// ── Token entry check (DM-only) ────────────────────────────────────────────────

const _lastCell = {}; // tokenId → "cx,cy" last checked: live drag frames on one square must not fire it again

/**
 * The DM's screen springs traps on the squares a token entered: `cells` is every square of the move (a fight
 * move's path, so a trap in the middle of the path counts), or just where it stopped. Only the DM's screen does
 * this; players' screens used to ask as well, so one step could fire a trap twice.
 */
export async function checkTriggers(tokenId, cells) {
  if (!MAP.isDM || !MAP.mapData?.triggers?.length || !cells?.length) return;
  for (const { cx, cy } of cells) {
    const key = `${cx},${cy}`;
    if (_lastCell[tokenId] === key) continue;
    _lastCell[tokenId] = key;
    const hit = MAP.mapData.triggers.filter(t => t.cx === cx && t.cy === cy && !t.disabled);
    for (const trig of hit) {
      // Only the DM's screen gets here, so it asks its own DM: no round trip through the node (the prompt used to
      // wait for the echo of a message the DM's screen sent itself).
      if (trig.requireConfirm) {
        showTriggerConfirm(trig, tokenId);
      } else if (await fireTrigger(trig, tokenId) === 'teleported') {
        return; // the rest of this move's squares are behind it now
      }
    }
  }
}

/** The square a world point is in, as triggers count squares. */
export const triggerCell = worldToCell;

// ── Fire a trigger ─────────────────────────────────────────────────────────────

// Spent at once and by id: the events below take a moment, and a save that finishes meanwhile swaps MAP.mapData for
// the merged copy, so a flag set afterwards on the old object was lost and a one-shot trap fired again on the next
// step (rules playtest, 2026-10-04).
function markSpent(id) {
  const t = MAP.mapData?.triggers?.find(x => x.id === id);
  if (t) t.disabled = true;
}

export async function fireTrigger(trigger, tokenId) {
  const type = trigger.type || 'message';
  if (trigger.oneShot) { trigger.disabled = true; markSpent(trigger.id); }

  if (type === 'message') {
    await publishTo([], EV.TRIGGER_FIRED, {
      type: EV.TRIGGER_FIRED, fromUserId: userId,
      campaignId: MAP.campaignId,
      triggerId: trigger.id,
      tokenId,
      action: 'send-message',
      message: trigger.message || '',
    });
  }

  if (type === 'trap') {
    // 5e traps can be spotted (passive Perception against a DC) and usually allow a saving throw for
    // half damage. They used to deal full damage, always (audit H1).
    const camp = serverData?.campaigns?.[MAP.campaignId];
    const tok = MAP.mapData?.tokens?.[tokenId];
    const summary = tok?.userId ? camp?.characterSummaries?.[tok.userId] : null;
    const name = tok?.name || 'Someone';
    if (trigger.spotDC && summary && (summary.passivePerception || 0) >= trigger.spotDC) {
      await publishTo([], EV.TRIGGER_FIRED, {
      type: EV.TRIGGER_FIRED, fromUserId: userId,
        campaignId: MAP.campaignId, triggerId: trigger.id, tokenId, action: 'trap-spotted',
        message: `${name} spots a trap here (passive Perception ${summary.passivePerception}).`,
      });
      // Seen, so not sprung: a one-shot trap stays armed for whoever comes next.
      if (trigger.oneShot) { trigger.disabled = false; const t = MAP.mapData?.triggers?.find(x => x.id === trigger.id); if (t) t.disabled = false; }
      return 'spotted';
    }
    const dmg = rollDiceExpr(trigger.damageExpr || '1d6');
    const hints = rule(serverData?.campaigns?.[MAP.campaignId]?.settings, 'hints');
    const save = trigger.saveAbility && trigger.saveDC
      ? ` ${trigger.saveAbility.toUpperCase()} save${hints ? ` DC ${trigger.saveDC}` : ''} for half.` : '';
    await publishTo([], EV.TRIGGER_FIRED, {
      type: EV.TRIGGER_FIRED, fromUserId: userId,
      campaignId: MAP.campaignId,
      triggerId: trigger.id,
      tokenId,
      action: 'trap',
      damage: dmg,
      saveAbility: trigger.saveAbility || null,
      saveDC: trigger.saveDC || null,
      message: `${trigger.label || 'Trap'}: ${dmg} damage to ${name}.${save}`,
    });
  }

  if (type === 'teleport' && trigger.destCx != null) {
    await publishTo([], EV.TRIGGER_FIRED, {
      type: EV.TRIGGER_FIRED, fromUserId: userId,
      campaignId: MAP.campaignId,
      triggerId: trigger.id,
      tokenId,
      action: 'teleport',
      destCx: trigger.destCx,
      destCy: trigger.destCy,
    });
  }
  const teleported = type === 'teleport' && trigger.destCx != null && teleportToken(tokenId, trigger.destCx, trigger.destCy);

  if (type === 'sound' && trigger.fileId) {
    await publishTo([], EV.TRIGGER_FIRED, {
      type: EV.TRIGGER_FIRED, fromUserId: userId,
      campaignId: MAP.campaignId,
      triggerId: trigger.id,
      tokenId,
      action: 'sound',
      fileId: trigger.fileId,
    });
  }

  if (trigger.oneShot) {
    markSpent(trigger.id); // on the map as it is now
    await saveTriggersAndBroadcast();
  }
  return teleported ? 'teleported' : undefined;
}

/**
 * Move a token to a square, on the DM's screen (the only one that fires triggers), and tell every screen.
 * The teleport event used to go out with nobody acting on it, so a teleporter moved no one (owner, 2026-10-05).
 * During a fight the jump goes on the end of this turn's path, so every screen agrees where the token now
 * walks from; it counts as one 5 ft step.
 */
function teleportToken(tokenId, cx, cy) {
  const tok = MAP.mapData?.tokens?.[tokenId];
  if (!tok || cy == null) return false;
  const { x, y } = clampToMap(toPoint({ cx, cy }));
  tok.x = x; tok.y = y;
  const spr = MAP.tokenSprites?.[tokenId];
  if (spr) { spr.x = x; spr.y = y; }
  _lastCell[tokenId] = `${cx},${cy}`; // arriving is not stepping onto: a trigger on the destination does not fire
  let moved = false;
  for (const light of MAP.mapData.lights || []) if (light.tokenId === tokenId) { light.x = x; light.y = y; moved = true; }
  if (moved) { renderLights(); renderFog(); }
  const turn = turnFor(tokenId);
  const turnPath = turn ? [...turn.path, { cx, cy }] : null;
  if (turnPath) commitPath(turnPath);
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (camp?.maps && MAP.mapId) camp.maps[MAP.mapId] = MAP.mapData;
  saveHubDm(serverData);
  renderTokens();
  publishMove({ type: EV.TOKEN_MOVE, campaignId: MAP.campaignId, tokenId, x, y, final: true,
    turnPath, turnKey: turnPath ? turn.key : null, fromUserId: userId, ...moveStamp() });
  return true;
}

/** The DM's prompt: someone stepped on a trigger that waits for the DM. */
export function showTriggerConfirm(trig, tokenId) {
  document.getElementById('trigger-confirm-overlay')?.remove();
  const who = MAP.mapData?.tokens?.[tokenId]?.name || 'A token';
  const d = document.createElement('div');
  d.id = 'trigger-confirm-overlay';
  d.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--lk-panel);border:1px solid #f59e0b;color:#fbbf24;padding:14px 18px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.6);text-align:center;min-width:240px';
  d.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px">🪤 ${esc(who)} stepped on ${esc(trig.label || trig.type)}</div>
    <div style="font-size:11px;color:var(--lk-muted);margin-bottom:12px">Set it off?</div>
    <div style="display:flex;gap:8px;justify-content:center">
      <button id="tcp-cancel" style="background:transparent;border:1px solid #475569;color:var(--lk-muted);padding:6px 14px;border-radius:6px;cursor:pointer">Not now</button>
      <button id="tcp-fire" style="background:#ef4444;border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600">Fire!</button>
    </div>`;
  document.body.appendChild(d);
  d.querySelector('#tcp-cancel').onclick = () => d.remove();
  d.querySelector('#tcp-fire').onclick = async () => { d.remove(); await fireTrigger(trig, tokenId); };
  setTimeout(() => d.remove(), 30000);
}

// ── Toast notification ─────────────────────────────────────────────────────────

export function showTriggerToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--lk-panel);border:1px solid #ef4444;color:#f87171;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── Trigger editor dialog ──────────────────────────────────────────────────────

export function showTriggerDialog(cx, cy, existingTrigger) {
  const trigger = existingTrigger || {
    id: genId(), cx, cy,
    type: 'message',
    label: 'Trigger',
    message: '',
    damageExpr: '1d6',
    destCx: null, destCy: null,
    fileId: null,
    requireConfirm: true,
    oneShot: false,
    disabled: false,
  };

  const existing = document.getElementById('trigger-dialog');
  if (existing) existing.remove();

  const d = document.createElement('div');
  d.id = 'trigger-dialog';
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--lk-panel);border:1px solid var(--lk-line);border-radius:12px;padding:20px;z-index:9999;min-width:300px;color:var(--lk-text);box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  d.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:12px">🪤 ${existingTrigger ? 'Edit' : 'New'} Trigger</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px">
      <span id="td-at-label" style="flex:1">Where it is: square <b id="td-at">${trigger.cx}, ${trigger.cy}</b></span>
      <button id="td-pick-at" type="button" style="background:transparent;border:1px solid #a855f7;color:#c4b5fd;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap">📍 Pick on map</button>
    </div>
    <label style="font-size:12px;display:block;margin-bottom:4px">Label</label>
    <input id="td-label" value="${esc(trigger.label)}" style="width:100%;box-sizing:border-box;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px">
    <label style="font-size:12px;display:block;margin-bottom:4px">Type</label>
    <select id="td-type" style="width:100%;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px" onchange="window._triggerDialogTypeChange()">
      <option value="message" ${trigger.type==='message'?'selected':''}>💬 Message</option>
      <option value="trap"    ${trigger.type==='trap'   ?'selected':''}>🪤 Trap (damage)</option>
      <option value="teleport"${trigger.type==='teleport'?'selected':''}>🌀 Teleport</option>
      <option value="sound"   ${trigger.type==='sound'  ?'selected':''}>🔔 Play sound</option>
    </select>
    <div id="td-fields-message" style="${trigger.type!=='message'?'display:none':''}">
      <label style="font-size:12px;display:block;margin-bottom:4px">Message text</label>
      <textarea id="td-message" style="width:100%;box-sizing:border-box;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px;min-height:60px;margin-bottom:10px">${esc(trigger.message)}</textarea>
    </div>
    <div id="td-fields-trap" style="${trigger.type!=='trap'?'display:none':''}">
      <label style="font-size:12px;display:block;margin-bottom:4px">Damage expression (e.g. 2d6+2)</label>
      <input id="td-damage" value="${esc(trigger.damageExpr)}" style="width:100%;box-sizing:border-box;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px">
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <label style="font-size:12px;flex:1">Saving throw
          <select id="td-save-ability" style="width:100%;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px">
            ${['', 'dex', 'con', 'str', 'wis'].map(a => `<option value="${a}" ${(trigger.saveAbility || '') === a ? 'selected' : ''}>${a ? a.toUpperCase() : 'None'}</option>`).join('')}
          </select></label>
        <label style="font-size:12px;width:70px">DC
          <input id="td-save-dc" type="number" min="5" max="30" value="${trigger.saveDC ?? 13}" style="width:100%;box-sizing:border-box;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px"></label>
        <label style="font-size:12px;width:80px" title="Heroes whose passive Perception reaches this notice the trap and it does not spring">Spot DC
          <input id="td-spot-dc" type="number" min="0" max="30" value="${trigger.spotDC ?? ''}" placeholder="—" style="width:100%;box-sizing:border-box;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px"></label>
      </div>
    </div>
    <div id="td-fields-teleport" style="${trigger.type!=='teleport'?'display:none':''}">
      <div style="font-size:12px;margin-bottom:4px">Sends them to square</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px">
        X <input id="td-destcx" type="number" value="${trigger.destCx ?? ''}" style="width:60px;box-sizing:border-box;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px">
        Y <input id="td-destcy" type="number" value="${trigger.destCy ?? ''}" style="width:60px;box-sizing:border-box;background:var(--lk-bg);border:1px solid var(--lk-line);color:inherit;padding:6px 8px;border-radius:6px">
        <button id="td-pick-dest" type="button" style="background:transparent;border:1px solid #a855f7;color:#c4b5fd;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap">📍 Pick on map</button>
      </div>
    </div>
    <div id="td-fields-sound" style="${trigger.type!=='sound'?'display:none':''}">
      <label style="font-size:12px;display:block;margin-bottom:4px">Audio file</label>
      <input id="td-soundfile" type="file" accept="audio/*" style="font-size:12px;margin-bottom:10px">
      ${trigger.fileId ? `<div style="font-size:11px;color:var(--dnd-muted,#64748b);margin-bottom:10px">Current file ID: ${esc(trigger.fileId)}</div>` : ''}
    </div>
    <label style="font-size:12px;display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <input id="td-confirm" type="checkbox" ${trigger.requireConfirm?'checked':''}> DM must confirm before firing
    </label>
    <label style="font-size:12px;display:flex;align-items:center;gap:6px;margin-bottom:12px">
      <input id="td-oneshot" type="checkbox" ${trigger.oneShot?'checked':''}> One-shot (disable after firing)
    </label>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('trigger-dialog').remove()" style="background:transparent;border:1px solid var(--lk-line);color:inherit;padding:6px 14px;border-radius:6px;cursor:pointer">Cancel</button>
      <button id="td-save" style="background:var(--dnd-primary,#6366f1);border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600">Save</button>
    </div>`;
  document.body.appendChild(d);

  // 📍 Pick on map: the dialog steps aside while the DM clicks a square, then comes back with it filled in.
  const at = { cx: trigger.cx, cy: trigger.cy };
  const pick = async prompt => {
    d.style.display = 'none';
    const c = await pickCell(prompt);
    d.style.display = '';
    return c;
  };
  d.querySelector('#td-pick-at').onclick = async () => {
    const c = await pick('Click the square that sets it off');
    if (!c) return;
    Object.assign(at, c);
    d.querySelector('#td-at').textContent = `${c.cx}, ${c.cy}`;
  };
  d.querySelector('#td-pick-dest').onclick = async () => {
    const c = await pick('Click the square it sends them to');
    if (!c) return;
    d.querySelector('#td-destcx').value = c.cx;
    d.querySelector('#td-destcy').value = c.cy;
  };

  window._triggerDialogTypeChange = () => {
    const v = document.getElementById('td-type').value;
    ['message','trap','teleport','sound'].forEach(t => {
      document.getElementById('td-fields-' + t).style.display = (t === v) ? '' : 'none';
    });
    // A teleporter needs somewhere to send people: ask for it straight away (owner, 2026-10-05).
    if (v === 'teleport' && !d.querySelector('#td-destcx').value) d.querySelector('#td-pick-dest').click();
  };

  document.getElementById('td-save').onclick = async () => {
    const type     = document.getElementById('td-type').value;
    const label    = document.getElementById('td-label').value.trim() || 'Trigger';
    const confirm  = document.getElementById('td-confirm').checked;
    const oneShot  = document.getElementById('td-oneshot').checked;
    const message  = document.getElementById('td-message')?.value || '';
    const dmgExpr  = document.getElementById('td-damage')?.value || '1d6';
    const saveAbility = document.getElementById('td-save-ability')?.value || '';
    const saveDC   = parseInt(document.getElementById('td-save-dc')?.value) || null;
    const spotDC   = parseInt(document.getElementById('td-spot-dc')?.value) || null;
    const cellNo   = id => { const v = parseInt(document.getElementById(id)?.value); return Number.isFinite(v) ? v : null; };
    const destCx   = cellNo('td-destcx'); // square 0 is a square (`|| null` dropped it)
    const destCy   = cellNo('td-destcy');

    let fileId = trigger.fileId;
    const soundFileEl = document.getElementById('td-soundfile');
    if (soundFileEl?.files[0]) {
      const file = soundFileEl.files[0];
      const buf  = await file.arrayBuffer();
      try {
        const res = await guarded(request)('files:upload', { data: buf, name: file.name, mime: file.type });
        fileId = res?.id || null;
      } catch (e) {
        console.error('Trigger sound upload failed', e);
        if (!e?.shown) alert(`That sound could not be uploaded (${e.message || e}).`);
        return;
      }
    }

    const updated = {
      ...trigger, cx: at.cx, cy: at.cy,
      type, label, requireConfirm: confirm, oneShot,
      message, damageExpr: dmgExpr, destCx, destCy, fileId, saveAbility, saveDC, spotDC,
    };

    if (!MAP.mapData.triggers) MAP.mapData.triggers = [];
    const idx = MAP.mapData.triggers.findIndex(t => t.id === trigger.id);
    if (idx >= 0) MAP.mapData.triggers[idx] = updated;
    else          MAP.mapData.triggers.push(updated);

    d.remove();
    await saveTriggersAndBroadcast();
  };
}
