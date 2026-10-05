// dnd-hub-trigger-pick.js — the DM clicks a square on the map to choose where a trigger sits or where a
// teleporter sends people (owner, 2026-10-05: typing cell numbers was the only way).
import { MAP, effectiveGs } from './dnd-hub-state.js?v=20261014k';

let _cancel = null;

/** The grid square under a mouse event on the map canvas. */
function cellOf(e) {
  const rect = MAP.app.canvas.getBoundingClientRect();
  const wx = (e.clientX - rect.left - MAP.panX) / MAP.zoom;
  const wy = (e.clientY - rect.top - MAP.panY) / MAP.zoom;
  const gs = effectiveGs(MAP.mapData);
  const ox = (MAP._bgOffset?.x ?? 0) + (MAP.mapData?.gridOffsetX || 0);
  const oy = (MAP._bgOffset?.y ?? 0) + (MAP.mapData?.gridOffsetY || 0);
  return { cx: Math.floor((wx - ox) / gs), cy: Math.floor((wy - oy) / gs), gs, ox, oy };
}

/**
 * Wait for the DM to click a square. Resolves { cx, cy }, or null on Escape. The click goes to nobody else:
 * the trap tool would otherwise open a new trigger there. Middle-drag still pans and the wheel still zooms.
 */
export function pickCell(prompt, colour = 0xa855f7) {
  _cancel?.();
  const canvas = MAP.app?.canvas;
  if (!canvas || !MAP.mapData) return Promise.resolve(null);
  return new Promise(resolve => {
    const banner = document.createElement('div');
    banner.id = 'lk-pick-banner';
    banner.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:var(--lk-panel);border:1px solid #a855f7;color:var(--lk-text);padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5)';
    banner.textContent = `${prompt} — Esc to cancel`;
    document.body.appendChild(banner);
    const hover = new PIXI.Graphics();
    hover.eventMode = 'none';
    MAP.layers?.ui?.addChild(hover);
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    const move = e => {
      const c = cellOf(e);
      hover.clear();
      hover.rect(c.ox + c.cx * c.gs, c.oy + c.cy * c.gs, c.gs, c.gs).fill({ color: colour, alpha: 0.3 }).stroke({ color: colour, width: 2 });
    };
    const down = e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const { cx, cy } = cellOf(e);
      done({ cx, cy });
    };
    const key = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); done(null); } };
    function done(result) {
      canvas.removeEventListener('mousemove', move);
      canvas.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      canvas.style.cursor = prevCursor;
      hover.destroy();
      banner.remove();
      _cancel = null;
      resolve(result);
    }
    _cancel = () => done(null);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('pointerdown', down, true); // capture, and pointer not mouse: PIXI (tokens) and the map's tools never see it
    window.addEventListener('keydown', key, true);
  });
}
