// dnd-hub-turn-move.js — this turn's walked path: where it began, how far it has gone, and drawing it.
// The rules are pure in dnd-hub-movement.js; this file holds MAP state, storage and PIXI.
//
// 🔴 The trail is drawn UNDER the fog layer. Another player's path through fog must not show
// them the shape of rooms they have not seen.
import { MAP, serverData, userId, effectiveGs } from './dnd-hub-state.js?v=20261014r';
import { wouldCrossWall } from './dnd-hub-walls.js?v=20261014r';
import { activeTokenId } from './dnd-hub-rules.js';
import { guide } from './lk-guide-ui.js';
import { turnChanged } from './dnd-hub-fx-combat.js';
import { cellAt, cellCentre, turnKey, moveMode, pathFeet, speedOf, checkReportedPath } from './dnd-hub-movement.js';

const STORE = id => `lk-turnmove:${id}`;

/** { ox, oy, gs } — the grid as tokens snap to it. */
export function grid() {
  const gs = effectiveGs(MAP.mapData);
  return {
    gs,
    ox: (MAP._bgOffset?.x ?? 0) + (MAP.mapData?.gridOffsetX ?? 0),
    oy: (MAP._bgOffset?.y ?? 0) + (MAP.mapData?.gridOffsetY ?? 0),
  };
}
export const toCell = (x, y) => { const g = grid(); return cellAt(x, y, g.ox, g.oy, g.gs); };
export const toPoint = c => { const g = grid(); return cellCentre(c, g.ox, g.oy, g.gs); };
export const cellBlocked = (a, b) => {
  const p = toPoint(a), q = toPoint(b);
  return wouldCrossWall(p.x, p.y, q.x, q.y);
};

/** Inside the map image (world frame: the map at native size from the origin). True while its size is unknown. */
export function onMap(x, y) {
  const w = MAP._bgImgW, h = MAP._bgImgH;
  if (!w || !h) return true;
  return x >= 0 && y >= 0 && x <= w && y <= h;
}

/** A point pulled back inside the map image. */
export function clampToMap(p) {
  const w = MAP._bgImgW, h = MAP._bgImgH;
  if (!w || !h) return p;
  return { x: Math.min(w - 1, Math.max(1, p.x)), y: Math.min(h - 1, Math.max(1, p.y)) };
}

/**
 * The token whose turn limits movement: only while a fight is on. The DM's "Set as Active Turn" outside a fight
 * highlights a token but limits nobody — it used to give every player a speed limit until the next fight
 * (owner, 2026-10-05: "player movement shouldn't be tracked unless they are in combat").
 */
export const limitingTurnId = () => (MAP.turnIsFight ? MAP.activeTurnTokenId : null);
export const modeFor = tokenId => moveMode({ isDM: MAP.isDM, activeTurnTokenId: limitingTurnId(), tokenId });

export function speedFor(tokenId) {
  const tok = MAP.mapData?.tokens?.[tokenId];
  const uid = tok?.userId || (tokenId.startsWith('player_') ? tokenId.slice(7) : null);
  return speedOf(tok, uid ? serverData?.campaigns?.[MAP.campaignId]?.characterSummaries?.[uid] : null);
}

/** This turn's record for `tokenId`, its path started at the token if empty. Null when it is not its turn. */
export function turnFor(tokenId) {
  const t = MAP.turnMove;
  if (!t || t.tokenId !== tokenId) return null;
  if (!t.path.length) {
    const tok = MAP.mapData?.tokens?.[tokenId];
    if (tok) t.path = [toCell(tok.x, tok.y)];
  }
  return t;
}

/** Follow the DM's tracker: a new turn starts a new path at the token. Restores my own path after a reload. */
export function syncTurn(init, manualTokenId = null) {
  const active = manualTokenId || activeTokenId(init);
  MAP.activeTurnTokenId = active;
  const fight = serverData?.campaigns?.[MAP.campaignId]?.initiative;
  MAP.turnIsFight = !!active && (manualTokenId ? !!fight?.active && !fight?.waiting : true);
  const key = !MAP.turnIsFight ? null : manualTokenId ? `manual:${manualTokenId}:${init?.ts ?? ''}` : turnKey(init, active);
  if (key !== MAP.turnMove?.key) {
    MAP.turnMove = key ? (_restore(key) || { key, tokenId: active, path: [] }) : null;
    turnFor(active);
  }
  MAP.activeTurnTokenSpeed = active ? speedFor(active) : 30;
  if (active && active === `player_${userId}` && !MAP.isDM) guide('player:turn');
  turnChanged(active || null);
  renderTrail();
}

/** Keep a path (after a finished move, or one the DM's screen sent). */
export function commitPath(path) {
  if (!MAP.turnMove) return;
  MAP.turnMove.path = path;
  const tok = MAP.mapData?.tokens?.[MAP.turnMove.tokenId];
  if (tok?.userId === userId) {
    try { localStorage.setItem(STORE(MAP.campaignId), JSON.stringify(MAP.turnMove)); } catch { /* private window */ }
  }
  renderTrail();
}

function _restore(key) {
  try {
    const t = JSON.parse(localStorage.getItem(STORE(MAP.campaignId)) || 'null');
    return t?.key === key && Array.isArray(t.path) ? t : null;
  } catch { return null; }
}

export const remainingFt = tokenId => Math.max(0, speedFor(tokenId) - pathFeet(turnFor(tokenId)?.path));

// ── Drawing ───────────────────────────────────────────────────────────────────

let _g = null, _label = null, _start = null, _tick = null;

/** Draw the start marker and the walked path (plus a drag preview, if given) for the active token. */
export function renderTrail(preview = null) {
  const layer = MAP.layers?.trail;
  if (!layer) return;
  const t = MAP.turnMove;
  const path = preview || t?.path;
  if (!t || !path?.length || !MAP.mapData?.tokens?.[t.tokenId]) { _clear(); return; }
  if (!_g) {
    _g = new PIXI.Graphics(); _start = new PIXI.Graphics();
    _label = new PIXI.Text({ text: '', style: new PIXI.TextStyle({
      fill: 0xf3d27a, fontSize: 12, fontWeight: 'bold', fontFamily: 'Georgia, serif',
      stroke: { color: 0x000000, width: 4 } }) });
    _label.anchor.set(0.5, 1);
    layer.addChild(_g, _start, _label);
    _tick = () => { if (_start) _start.alpha = 0.6 + 0.4 * Math.sin(Date.now() * 0.005); };
    MAP.app?.ticker.add(_tick);
  }
  const { gs } = grid();
  const speed = speedFor(t.tokenId);
  const used = pathFeet(path);
  const spent = used >= speed;
  const colour = spent ? 0xe0603a : 0xd4af37;
  const pts = path.map(toPoint);

  _g.clear();
  for (const p of pts.slice(1)) _g.rect(p.x - gs / 2, p.y - gs / 2, gs, gs).fill({ color: colour, alpha: 0.10 });
  if (pts.length > 1) {
    const line = g => { g.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) g.lineTo(p.x, p.y); };
    line(_g); _g.stroke({ color: colour, width: gs * 0.32, alpha: 0.16, cap: 'round', join: 'round' });
    line(_g); _g.stroke({ color: colour, width: gs * 0.12, alpha: 0.35, cap: 'round', join: 'round' });
    line(_g); _g.stroke({ color: 0xfff1c1, width: 2, alpha: 0.9, cap: 'round', join: 'round' });
    for (const p of pts.slice(1, -1)) _g.circle(p.x, p.y, gs * 0.07).fill({ color: 0xfff1c1, alpha: 0.9 });
  }

  // Where the turn began: a ring with four ticks, pulsing.
  const s = pts[0], r = gs * 0.42;
  _start.clear();
  _start.circle(s.x, s.y, r).stroke({ color: 0xd4af37, width: 2.5, alpha: 0.95 });
  _start.circle(s.x, s.y, r * 0.55).stroke({ color: 0xd4af37, width: 1.5, alpha: 0.6 });
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    _start.moveTo(s.x + dx * r * 0.8, s.y + dy * r * 0.8).lineTo(s.x + dx * r * 1.25, s.y + dy * r * 1.25);
  }
  _start.stroke({ color: 0xd4af37, width: 2, alpha: 0.95 });

  const end = pts[pts.length - 1];
  _label.text = spent ? `${used} / ${speed} ft · no movement left` : `${used} / ${speed} ft`;
  _label.style.fill = spent ? 0xff9b7a : 0xf3d27a;
  _label.x = end.x; _label.y = end.y - gs * 0.62;
}

function _clear() {
  if (_tick && MAP.app) MAP.app.ticker.remove(_tick);
  for (const o of [_g, _start, _label]) if (o) { o.parent?.removeChild(o); o.destroy(); }
  _g = _start = _label = _tick = null;
}

/** The map screen was rebuilt: its PIXI objects are gone with the old app. */
export function resetTrailGraphics() { _g = _start = _label = _tick = null; }

/** Amber toast at the bottom of the map. One at a time. */
export function moveToast(text) {
  document.getElementById('lk-move-toast')?.remove();
  const el = document.createElement('div');
  el.id = 'lk-move-toast';
  el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--lk-panel);border:1px solid #f59e0b;color:#fbbf24;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5)';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/** Why a player's token will not move, or null. */
export function refusal(tokenId) {
  if (MAP.mapData?.tokens?.[tokenId]?.waiting) return 'Waiting for the DM to place you on the map.';
  const mode = modeFor(tokenId);
  if (mode === 'locked') return 'It is not your turn — you can move on your turn.';
  if (mode === 'budget' && remainingFt(tokenId) <= 0) {
    return speedFor(tokenId) === 0 ? 'You cannot move right now (your speed is 0).' : 'You have no movement left this turn.';
  }
  return null;
}

/**
 * The DM's screen referees a player's move: 'ok' (apply it), 'wait' (a live drag frame during a fight —
 * apply only the finished move), or 'bounce' (out of turn, off its path, or past its speed: send it back).
 * An honest player's screen never sends a bad move; this catches one that does.
 */
export function refereeMove(p) {
  const mode = moveMode({ isDM: false, activeTurnTokenId: limitingTurnId(), tokenId: p.tokenId });
  if (mode === 'free') return 'ok';
  if (!p.final) return 'wait';
  if (mode === 'locked') return 'bounce';
  const turn = turnFor(p.tokenId);
  if (!turn || p.turnKey !== turn.key) return 'bounce';
  const r = checkReportedPath(turn, p.turnPath, speedFor(p.tokenId), cellBlocked);
  const end = r.path[r.path.length - 1], at = toCell(p.x, p.y);
  return r.ok && end && end.cx === at.cx && end.cy === at.cy ? 'ok' : 'bounce';
}
