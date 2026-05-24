// dnd-hub-initiative.js — initiative HUD and roll toast
import { MAP, serverData } from './dnd-hub-state.js?v=20260502p4';
import { esc } from '../plugin-sdk.js';

export function renderInitiativeHUD(initiative) {
  const init = initiative ?? serverData?.campaigns?.[MAP.campaignId]?.initiative;
  const el = document.getElementById('initiative-hud');
  if (!el) return;

  if (!init?.active || !init.order?.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const cur = init.currentIndex ?? 0;
  el.innerHTML = `
    <div style="font-size:10px;font-weight:700;color:var(--dnd-gold);margin-bottom:5px;letter-spacing:.04em">
      INITIATIVE · Round ${Number(init.round) || 0}
    </div>
    ${init.order.map((c, i) => {
      const isCur = i === cur;
      const dot = c.type === 'player' ? '#3b82f6' : '#ef4444';
      return `
        <div class="init-hud-row ${isCur ? 'current-turn' : ''}">
          <div class="init-hud-dot" style="background:${dot}"></div>
          <span style="font-size:10px;${isCur ? 'font-weight:800;color:var(--dnd-gold)' : 'color:var(--dnd-text)'};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(c.name)}
          </span>
          <span style="font-size:9px;color:var(--dnd-muted)">${Number(c.roll) || ''}</span>
        </div>
      `;
    }).join('')}
  `;
}

export function showMapRollToast(p) {
  const el = document.getElementById('roll-toast');
  if (!el) return;
  el.textContent = `🎲 ${p.label || p.expression || '?'}: ${p.result}`;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}
