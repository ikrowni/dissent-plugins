// dnd-hub-fx-combat.js — combat you can feel (owner, 2026-10-04: "more eye candy"): a number floats up from a token
// when its hit points change (red for damage, green for healing, a flash on a big hit), and a banner sweeps across
// the map when the turn changes ("Your turn!" in gold for the player whose turn it is). Page elements over the
// map, positioned from its pan and zoom; nothing here touches the map's state. Off under reduced motion, where a
// quiet version shows instead.
import { MAP, userId } from './dnd-hub-state.js?v=20261014q';

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

function screenPoint(tok) {
  const cv = MAP.app?.canvas;
  if (!cv || !tok) return null;
  const r = cv.getBoundingClientRect();
  return { x: r.left + MAP.panX + tok.x * MAP.zoom, y: r.top + MAP.panY + tok.y * MAP.zoom, r };
}

/** A token's hit points went from `before` to `after`: float the difference up from it. */
export function floatHp(tokenId, before, after) {
  if (before == null || after == null || before === after) return;
  const tok = MAP.mapData?.tokens?.[tokenId];
  if (!tok || (tok.visible === false && !MAP.isDM)) return;
  const p = screenPoint(tok);
  if (!p || p.x < p.r.left || p.x > p.r.right || p.y < p.r.top || p.y > p.r.bottom) return;
  ensureStyle();
  const d = after - before;
  const el = document.createElement('div');
  const big = d < 0 && tok.hpMax && -d >= tok.hpMax * 0.35;
  el.className = `lk-float ${d < 0 ? 'hurt' : 'heal'}${big ? ' big' : ''}${after <= 0 ? ' down' : ''}`;
  el.textContent = after <= 0 && d < 0 ? `${d}  ✝` : (d > 0 ? `+${d}` : String(d));
  el.style.left = `${p.x}px`; el.style.top = `${p.y - 20 * MAP.zoom}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), still() ? 1400 : 1600);
  if (d < 0 && !still()) {
    const ring = document.createElement('div');
    ring.className = `lk-hit${big ? ' big' : ''}`;
    const size = Math.max(40, 60 * MAP.zoom);
    Object.assign(ring.style, { left: `${p.x - size / 2}px`, top: `${p.y - size / 2}px`, width: `${size}px`, height: `${size}px` });
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 600);
  }
}

let _lastTurn = undefined;
/** The turn moved to `tokenId` (null: no fight). The first call only remembers it (a reload is not a new turn). */
export function turnChanged(tokenId) {
  const first = _lastTurn === undefined;
  if (tokenId === _lastTurn) return;
  _lastTurn = tokenId;
  if (first || !tokenId) return;
  const tok = MAP.mapData?.tokens?.[tokenId];
  if (!tok || (tok.visible === false && !MAP.isDM)) return;
  const mine = tokenId === `player_${userId}`;
  const wrap = document.getElementById('map-canvas-wrap');
  if (!wrap) return;
  ensureStyle();
  document.getElementById('lk-turn-banner')?.remove();
  const el = document.createElement('div');
  el.id = 'lk-turn-banner';
  el.className = mine ? 'mine' : '';
  el.innerHTML = `<span>${mine ? 'Your turn!' : `${esc(tok.name || 'Next')}'s turn`}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), still() ? 1800 : 2300);
}
/** The DM rolled in secret: the table sees dice rattle behind the DM's screen, never the number. */
export function secretRoll() {
  const wrap = document.getElementById('map-canvas-wrap');
  if (!wrap) return;
  ensureStyle();
  document.getElementById('lk-secret-roll')?.remove();
  const el = document.createElement('div');
  el.id = 'lk-secret-roll';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="lk-sr-stage" aria-hidden="true"><span class="d d1"></span><span class="d d2"></span><span class="d d3"></span>
    <svg class="lk-sr-screen" viewBox="0 0 64 36"><path d="M2 34 L10 4 L32 8 L54 4 L62 34 Z" fill="#3a2716" stroke="#e0b552" stroke-width="1.5"/><path d="M10 4 L14 34 M32 8 L32 34 M54 4 L50 34" stroke="#e0b552" stroke-opacity=".5"/></svg></div>
    <span>The DM rolls behind the screen…</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
.lk-float{position:fixed;z-index:60;transform:translate(-50%,-50%);pointer-events:none;font:800 22px/1 var(--lk-title,serif);letter-spacing:.02em;
  text-shadow:0 2px 0 rgba(0,0,0,.7),0 0 12px currentColor;animation:lk-float 1.6s cubic-bezier(.2,.8,.2,1) forwards;white-space:pre}
.lk-float.hurt{color:#ff5a4a}.lk-float.heal{color:#5ee08a}.lk-float.big{font-size:30px}.lk-float.down{color:#ff3b30}
@keyframes lk-float{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}15%{opacity:1;transform:translate(-50%,-60%) scale(1.15)}30%{transform:translate(-50%,-70%) scale(1)}100%{opacity:0;transform:translate(-50%,-190%) scale(.95)}}
.lk-hit{position:fixed;z-index:59;pointer-events:none;border-radius:50%;border:3px solid rgba(255,80,60,.9);animation:lk-hit .6s ease-out forwards}
.lk-hit.big{border-color:#fff;box-shadow:0 0 30px rgba(255,90,60,.9)}
@keyframes lk-hit{from{opacity:1;transform:scale(.5)}to{opacity:0;transform:scale(1.6)}}
#lk-turn-banner{position:absolute;left:0;right:0;top:34%;z-index:55;pointer-events:none;display:flex;justify-content:center;overflow:hidden}
#lk-turn-banner span{display:block;padding:10px 60px;font:600 28px/1.2 var(--lk-title,serif);letter-spacing:.12em;text-transform:uppercase;color:#f3e3b5;
  background:linear-gradient(90deg,transparent,rgba(10,7,4,.88) 18%,rgba(10,7,4,.88) 82%,transparent);border-top:1px solid rgba(224,181,82,.5);border-bottom:1px solid rgba(224,181,82,.5);
  text-shadow:0 0 18px rgba(224,181,82,.55);animation:lk-banner 2.3s cubic-bezier(.2,.8,.2,1) forwards}
#lk-turn-banner.mine span{color:#1a0f05;background:linear-gradient(90deg,transparent,#e0b552 18%,#f3d58a 50%,#e0b552 82%,transparent);text-shadow:none;font-size:34px}
@keyframes lk-banner{0%{opacity:0;transform:translateX(-40%) skewX(-12deg)}14%{opacity:1;transform:translateX(0) skewX(0)}80%{opacity:1;transform:translateX(0)}100%{opacity:0;transform:translateX(30%)}}
#lk-secret-roll{position:absolute;top:56px;left:50%;transform:translateX(-50%);z-index:56;pointer-events:none;display:flex;align-items:center;gap:10px;
  padding:8px 14px 8px 10px;border-radius:999px;border:1px solid rgba(224,181,82,.45);background:rgba(14,10,6,.92);color:#f3e3b5;
  font:600 13px/1.2 var(--lk-title,serif);letter-spacing:.04em;box-shadow:0 8px 24px rgba(0,0,0,.5);animation:lk-sr-in 2.6s ease forwards}
.lk-sr-stage{position:relative;width:52px;height:30px}
.lk-sr-screen{position:absolute;inset:0;width:100%;height:100%}
#lk-secret-roll .d{position:absolute;bottom:14px;width:9px;height:9px;border-radius:2px;background:#f3e3b5;box-shadow:0 0 6px rgba(255,220,150,.8);animation:lk-sr-hop .5s ease-in-out infinite}
#lk-secret-roll .d1{left:10px}#lk-secret-roll .d2{left:22px;animation-delay:.15s}#lk-secret-roll .d3{left:34px;animation-delay:.3s}
@keyframes lk-sr-hop{0%,100%{transform:translateY(4px) rotate(0)}50%{transform:translateY(-9px) rotate(140deg)}}
@keyframes lk-sr-in{0%{opacity:0;transform:translate(-50%,-10px)}12%{opacity:1;transform:translate(-50%,0)}85%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){#lk-secret-roll,#lk-secret-roll .d{animation:none}}
@media (prefers-reduced-motion:reduce){.lk-float{animation:lk-fade 1.4s forwards}#lk-turn-banner span{animation:lk-fade 1.8s forwards}
  @keyframes lk-fade{0%,70%{opacity:1}100%{opacity:0}}}`;
function ensureStyle() {
  if (document.getElementById('lk-fx-combat-style')) return;
  const s = document.createElement('style'); s.id = 'lk-fx-combat-style'; s.textContent = CSS; document.head.appendChild(s);
}
