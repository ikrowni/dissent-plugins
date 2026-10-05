// dnd-hub-ruler.js — measurement ruler, map ping animation, active-turn ring
import { MAP, effectiveGs } from './dnd-hub-state.js?v=20261014l';
import { gridFeet } from './lk-rules5e.js';
import { remainingFt, limitingTurnId } from './dnd-hub-turn-move.js';

// ── Ruler ─────────────────────────────────────────────────────────────────────

let _rulerG = null;
let _rulerLabel = null;

/** Start a ruler from world coords (fromX, fromY). */
export function startRuler(fromX, fromY) {
  if (!MAP.layers?.ui) return;
  MAP.rulerActive = true;
  MAP.rulerStart = { x: fromX, y: fromY };
  clearRulerGraphics();
  _rulerG = new PIXI.Graphics();
  _rulerLabel = new PIXI.Text({
    text: '',
    style: new PIXI.TextStyle({
      fill: 0xd4af37, fontSize: 11, fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 },
    }),
  });
  _rulerLabel.anchor.set(0.5, 0.5);
  MAP.layers.ui.addChild(_rulerG, _rulerLabel);
}

/** Update ruler endpoint to world coords (toX, toY). Call on mousemove while ruler is active. */
export function updateRuler(toX, toY) {
  if (!MAP.rulerActive || !_rulerG || !MAP.rulerStart) return;
  const { x: fx, y: fy } = MAP.rulerStart;
  const gs = MAP.mapData ? effectiveGs(MAP.mapData) : 40;

  // Squares, as the 5e grid counts them: a diagonal step is 5 ft like any other (audit G5).
  const distFt  = gridFeet(toX - fx, toY - fy, gs);

  const outOfRange = MAP.selectedAttack && distFt > MAP.selectedAttack.rangeFt;
  const lineColor  = outOfRange ? 0xef4444 : 0xd4af37;
  // A hex, not var(--lk-gold): PIXI cannot read CSS variables and threw on every mouse move (owner, 2026-10-05).
  const textColor  = outOfRange ? '#ef4444' : '#d4af37';

  let label = `${distFt}ft`;
  if (limitingTurnId() && MAP.rulerStart) {
    const remaining = Math.max(0, remainingFt(limitingTurnId()) - distFt);
    label += ` (${remaining}ft left)`;
  }
  if (outOfRange) label += ' ⚠ out of range';

  _rulerLabel.style.fill = textColor;
  _rulerG.clear();
  _drawDashedLine(_rulerG, fx, fy, toX, toY, lineColor);
  _rulerLabel.text = label;
  _rulerLabel.x = (fx + toX) / 2;
  _rulerLabel.y = (fy + toY) / 2 - 14;
}

/** Hide and destroy ruler graphics. */
export function clearRuler() {
  MAP.rulerActive = false;
  MAP.rulerStart = null;
  clearRulerGraphics();
}

function clearRulerGraphics() {
  if (_rulerG)     { _rulerG.destroy();     _rulerG = null; }
  if (_rulerLabel) { _rulerLabel.destroy(); _rulerLabel = null; }
}

function _drawDashedLine(g, x1, y1, x2, y2, color = 0xd4af37, dash = 8, gap = 5) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  let pos = 0, drawing = true;
  while (pos < len) {
    const segLen = Math.min(drawing ? dash : gap, len - pos);
    if (drawing) {
      g.moveTo(x1 + ux * pos,          y1 + uy * pos)
        .lineTo(x1 + ux * (pos + segLen), y1 + uy * (pos + segLen));
    }
    pos += segLen;
    drawing = !drawing;
  }
  g.stroke({ color, width: 2 });
}

// ── Map Ping ──────────────────────────────────────────────────────────────────

/** Render an expanding gold ripple at world coords (worldX, worldY). Ephemeral, 2s. */
export function showPingAnimation(worldX, worldY) {
  if (!MAP.app || !MAP.layers?.ui) return;
  const g = new PIXI.Graphics();
  MAP.layers.ui.addChild(g);
  const start = Date.now();
  const maxR = 60;
  const tickerFn = () => {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / 2000, 1);
    g.clear();
    if (progress < 1) {
      const r = maxR * progress;
      const alpha = 1 - progress;
      g.circle(worldX, worldY, r).stroke({ color: 0xd4af37, width: 2.5, alpha });
    } else {
      MAP.app.ticker.remove(tickerFn);
      if (g.parent) MAP.layers.ui.removeChild(g);
      g.destroy();
    }
  };
  MAP.app.ticker.add(tickerFn);
}

// ── Active-Turn Ring ──────────────────────────────────────────────────────────

let _ringG = null;
let _ringTickerFn = null;

/**
 * Show or reposition the pulsing gold ring for the active-turn token.
 * Called from renderTokens() after sprites are placed.
 * @param {number} x  world x of token centre
 * @param {number} y  world y of token centre
 * @param {number} r  token circle radius in pixels
 */
export function showActiveTurnRing(x, y, r) {
  if (!MAP.app || !MAP.layers?.ui) return;
  if (!_ringG) {
    _ringG = new PIXI.Graphics();
    MAP.layers.ui.addChild(_ringG);
  }
  if (!_ringTickerFn) {
    _ringTickerFn = () => {
      if (_ringG) _ringG.alpha = 0.55 + 0.45 * Math.sin(Date.now() * 0.004);
    };
    MAP.app.ticker.add(_ringTickerFn);
  }
  _ringG.clear();
  _ringG.circle(x, y, r + 5).stroke({ color: 0xd4af37, width: 3 });
  _ringG.visible = true;
}

/** Hide the active-turn ring and remove its ticker (re-added on next showActiveTurnRing call). */
export function hideActiveTurnRing() {
  if (_ringG) _ringG.visible = false;
  if (_ringTickerFn && MAP.app) { MAP.app.ticker.remove(_ringTickerFn); _ringTickerFn = null; }
}
