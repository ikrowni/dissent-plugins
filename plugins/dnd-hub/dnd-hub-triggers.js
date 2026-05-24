// dnd-hub-triggers.js — trigger tile rendering, placement, and activation (Phase 7)
import { MAP, serverData, userId, effectiveGs, HUB_DM_KEY } from './dnd-hub-state.js?v=20260502p4';
import { storageSet, realtimePublish, genId, esc, request } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';

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
  }
}

// ── Persistence ────────────────────────────────────────────────────────────────

export async function saveTriggersAndBroadcast() {
  await storageSet(HUB_DM_KEY, serverData);
  renderTriggers();
}

// ── Token entry check (DM-only) ────────────────────────────────────────────────

export async function checkTriggers(tokenId, wx, wy) {
  if (!MAP.mapData?.triggers?.length) return;

  const { cx, cy } = worldToCell(wx, wy);
  const hit = MAP.mapData.triggers.filter(t => t.cx === cx && t.cy === cy && !t.disabled);
  if (!hit.length) return;

  if (MAP.isDM) {
    // DM hub: fire directly
    for (const trig of hit) {
      if (trig.requireConfirm) {
        await realtimePublish(EV.TRIGGER_PENDING, {
          campaignId: MAP.campaignId,
          triggerId: trig.id,
          tokenId,
          cx, cy,
          label: trig.label || trig.type,
        });
      } else {
        await fireTrigger(trig, tokenId);
      }
    }
  } else {
    // Player hub: ask DM to process the trigger
    for (const trig of hit) {
      await realtimePublish(EV.TRIGGER_PENDING, {
        campaignId: MAP.campaignId,
        triggerId: trig.id,
        tokenId,
        cx, cy,
        label: trig.label || trig.type,
        autoFire: !trig.requireConfirm,
      });
    }
  }
}

// ── Fire a trigger ─────────────────────────────────────────────────────────────

export async function fireTrigger(trigger, tokenId) {
  const type = trigger.type || 'message';

  if (type === 'message') {
    await realtimePublish(EV.TRIGGER_FIRED, {
      campaignId: MAP.campaignId,
      triggerId: trigger.id,
      tokenId,
      action: 'send-message',
      message: trigger.message || '',
    });
  }

  if (type === 'trap') {
    const dmg = rollDiceExpr(trigger.damageExpr || '1d6');
    await realtimePublish(EV.TRIGGER_FIRED, {
      campaignId: MAP.campaignId,
      triggerId: trigger.id,
      tokenId,
      action: 'trap',
      damage: dmg,
      message: (trigger.label || 'Trap') + ' deals ' + dmg + ' damage!',
    });
  }

  if (type === 'teleport' && trigger.destCx != null) {
    await realtimePublish(EV.TRIGGER_FIRED, {
      campaignId: MAP.campaignId,
      triggerId: trigger.id,
      tokenId,
      action: 'teleport',
      destCx: trigger.destCx,
      destCy: trigger.destCy,
    });
  }

  if (type === 'sound' && trigger.fileId) {
    await realtimePublish(EV.TRIGGER_FIRED, {
      campaignId: MAP.campaignId,
      triggerId: trigger.id,
      tokenId,
      action: 'sound',
      fileId: trigger.fileId,
    });
  }

  if (trigger.oneShot) {
    trigger.disabled = true;
    await saveTriggersAndBroadcast();
  }
}

// ── Toast notification ─────────────────────────────────────────────────────────

export function showTriggerToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid #ef4444;color:#f87171;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
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
  d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--dnd-surface,#1e1e2e);border:1px solid var(--dnd-border,#3f3f5a);border-radius:12px;padding:20px;z-index:9999;min-width:300px;color:var(--dnd-text,#e2e8f0);box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  d.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:12px">🪤 ${existingTrigger ? 'Edit' : 'New'} Trigger (Cell ${cx},${cy})</div>
    <label style="font-size:12px;display:block;margin-bottom:4px">Label</label>
    <input id="td-label" value="${esc(trigger.label)}" style="width:100%;box-sizing:border-box;background:var(--dnd-bg,#13131f);border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px">
    <label style="font-size:12px;display:block;margin-bottom:4px">Type</label>
    <select id="td-type" style="width:100%;background:var(--dnd-bg,#13131f);border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px" onchange="window._triggerDialogTypeChange()">
      <option value="message" ${trigger.type==='message'?'selected':''}>💬 Message</option>
      <option value="trap"    ${trigger.type==='trap'   ?'selected':''}>🪤 Trap (damage)</option>
      <option value="teleport"${trigger.type==='teleport'?'selected':''}>🌀 Teleport</option>
      <option value="sound"   ${trigger.type==='sound'  ?'selected':''}>🔔 Play sound</option>
    </select>
    <div id="td-fields-message" style="${trigger.type!=='message'?'display:none':''}">
      <label style="font-size:12px;display:block;margin-bottom:4px">Message text</label>
      <textarea id="td-message" style="width:100%;box-sizing:border-box;background:var(--dnd-bg,#13131f);border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 8px;border-radius:6px;min-height:60px;margin-bottom:10px">${esc(trigger.message)}</textarea>
    </div>
    <div id="td-fields-trap" style="${trigger.type!=='trap'?'display:none':''}">
      <label style="font-size:12px;display:block;margin-bottom:4px">Damage expression (e.g. 2d6+2)</label>
      <input id="td-damage" value="${esc(trigger.damageExpr)}" style="width:100%;box-sizing:border-box;background:var(--dnd-bg,#13131f);border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px">
    </div>
    <div id="td-fields-teleport" style="${trigger.type!=='teleport'?'display:none':''}">
      <label style="font-size:12px;display:block;margin-bottom:4px">Destination cell X</label>
      <input id="td-destcx" type="number" value="${trigger.destCx ?? ''}" style="width:100%;box-sizing:border-box;background:var(--dnd-bg,#13131f);border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px">
      <label style="font-size:12px;display:block;margin-bottom:4px">Destination cell Y</label>
      <input id="td-destcy" type="number" value="${trigger.destCy ?? ''}" style="width:100%;box-sizing:border-box;background:var(--dnd-bg,#13131f);border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 8px;border-radius:6px;margin-bottom:10px">
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
      <button onclick="document.getElementById('trigger-dialog').remove()" style="background:transparent;border:1px solid var(--dnd-border,#3f3f5a);color:inherit;padding:6px 14px;border-radius:6px;cursor:pointer">Cancel</button>
      <button id="td-save" style="background:var(--dnd-primary,#6366f1);border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600">Save</button>
    </div>`;
  document.body.appendChild(d);

  window._triggerDialogTypeChange = () => {
    const v = document.getElementById('td-type').value;
    ['message','trap','teleport','sound'].forEach(t => {
      document.getElementById('td-fields-' + t).style.display = (t === v) ? '' : 'none';
    });
  };

  document.getElementById('td-save').onclick = async () => {
    const type     = document.getElementById('td-type').value;
    const label    = document.getElementById('td-label').value.trim() || 'Trigger';
    const confirm  = document.getElementById('td-confirm').checked;
    const oneShot  = document.getElementById('td-oneshot').checked;
    const message  = document.getElementById('td-message')?.value || '';
    const dmgExpr  = document.getElementById('td-damage')?.value || '1d6';
    const destCx   = parseInt(document.getElementById('td-destcx')?.value) || null;
    const destCy   = parseInt(document.getElementById('td-destcy')?.value) || null;

    let fileId = trigger.fileId;
    const soundFileEl = document.getElementById('td-soundfile');
    if (soundFileEl?.files[0]) {
      const file = soundFileEl.files[0];
      const buf  = await file.arrayBuffer();
      try {
        const res = await request('files:upload', { data: buf, name: file.name, mime: file.type });
        fileId = res?.id || null;
      } catch (e) { console.error('Trigger sound upload failed', e); }
    }

    const updated = {
      ...trigger,
      type, label, requireConfirm: confirm, oneShot,
      message, damageExpr: dmgExpr, destCx, destCy, fileId,
    };

    if (!MAP.mapData.triggers) MAP.mapData.triggers = [];
    const idx = MAP.mapData.triggers.findIndex(t => t.id === trigger.id);
    if (idx >= 0) MAP.mapData.triggers[idx] = updated;
    else          MAP.mapData.triggers.push(updated);

    d.remove();
    await saveTriggersAndBroadcast();
  };
}
