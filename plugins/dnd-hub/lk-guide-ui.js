// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-guide-ui.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-guide-ui.js' directly would make the plugin unmirrorable.

// lk-guide-ui.js — draws a guide tip (lk-guides.js): a small lantern-lit card, and a soft pulsing ring around what it
// talks about. ⚠️ SOURCE; vendored into dnd-hub and dnd-player (scripts/vendor-shared.mjs).
//
// `initGuides({ get, set })` once: get/set read and write the person's { on, seen } (dnd-hub user data, key
// 'guides'; the sheet reaches it as companion data). Saves merge the seen lists with what is stored, so the Hub and
// the sheet (two frames) never undo each other. `guide(trigger)` shows that trigger's tip if it is due.
import { tipFor, markSeen, guidesDefault } from './lk-guides.js';

let _io = null, _g = null, _loading = null, _loadedAt = 0, _queue = [], _open = null, _pendingOn = null;

/** Connect storage. A setGuidesOn made before this (the frame was still starting) is saved now, not lost. */
export function initGuides(io) {
  _io = io; _g = null; _loading = null;
  if (_pendingOn !== null) { const on = _pendingOn; _pendingOn = null; setGuidesOn(on); }
}

// Re-read when older than 15 s: the Hub and the sheet are two frames, and either may have switched guides off.
async function state() {
  if (_g && Date.now() - _loadedAt < 15000) return _g;
  _loading ||= (async () => {
    try { _g = (await _io?.get()) || guidesDefault(); } catch { _g ||= guidesDefault(); }
    _loadedAt = Date.now(); _loading = null;
    return _g;
  })();
  return _loading;
}
async function save() {
  if (!_io) return;
  try {
    const stored = (await _io.get()) || {};
    const seen = [...new Set([...(Array.isArray(stored.seen) ? stored.seen : []), ..._g.seen])];
    _g = { on: _g.on, seen: _g.on ? seen : _g.seen };
    await _io.set(_g);
  } catch { /* a guide is never worth an error */ }
}

export async function guidesOn() { return (await state()).on !== false; }

/** Turn guides on (every tip starts over) or off. */
export async function setGuidesOn(on) {
  if (!_io) { _pendingOn = on; _g = on ? { on: true, seen: [] } : { on: false, seen: [] }; _loadedAt = Date.now(); if (!on) close(); return; }
  await state();
  _g = on ? { on: true, seen: [] } : { ..._g, on: false };
  _loadedAt = Date.now();
  if (_io) { try { await _io.set(_g); } catch { /* ignore */ } }
  if (!on) close();
}

/** Show `trigger`'s tip if it is due (guides on, never seen). Tips arriving while one is open wait their turn. */
export async function guide(trigger) {
  const g = await state();
  if (!tipFor(trigger, g) || _queue.includes(trigger) || _open === trigger) return;
  _queue.push(trigger);
  if (!_open) next();
}

function next() {
  const trigger = _queue.shift();
  const tip = trigger && tipFor(trigger, _g);
  if (!tip) { _open = null; if (_queue.length) next(); return; }
  _open = trigger;
  draw(tip);
}

function close() {
  document.getElementById('lk-tip')?.remove();
  document.getElementById('lk-tip-ring')?.remove();
  _open = null;
}

const LANTERN = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M12 3v2M8 8h8l-1 11H9z"/><path d="M7 8l1-3h8l1 3"/><path d="M12 11c1.2 1.4 1.2 2.8 0 4.2-1.2-1.4-1.2-2.8 0-4.2z" fill="currentColor"/><path d="M8 19h8"/></svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function draw(tip) {
  ensureStyle();
  close(); _open = tip.id;
  const anchor = tip.anchor ? document.querySelector(tip.anchor) : null;
  const r = anchor && anchor.getClientRects().length ? anchor.getBoundingClientRect() : null;
  if (r && r.width && r.height) {
    const ring = document.createElement('div');
    ring.id = 'lk-tip-ring';
    Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    document.body.appendChild(ring);
  }
  const card = document.createElement('div');
  card.id = 'lk-tip'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', tip.title);
  card.innerHTML = `<div class="lk-tip-lamp">${LANTERN}</div><div class="lk-tip-body"><b>${esc(tip.title)}</b><p>${esc(tip.text)}</p>
    <div class="lk-tip-actions"><button class="lk-tip-ok">Got it</button><button class="lk-tip-off">Turn guides off</button></div></div>`;
  document.body.appendChild(card);
  // Beside what it points at when there is room; otherwise the lower left corner.
  const w = card.offsetWidth, h = card.offsetHeight, vw = innerWidth, vh = innerHeight;
  let left = 14, top = vh - h - 14;
  if (r) {
    left = Math.min(Math.max(10, r.left), vw - w - 10);
    top = r.bottom + 12 + h < vh ? r.bottom + 12 : Math.max(10, r.top - h - 12);
  }
  Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  card.querySelector('.lk-tip-ok').onclick = () => { _g = markSeen(_g, tip.id); save(); close(); setTimeout(next, 250); };
  card.querySelector('.lk-tip-off').onclick = () => { _queue = []; setGuidesOn(false); };
  card.querySelector('.lk-tip-ok').focus({ preventScroll: true });
}

const CSS = `
#lk-tip{position:fixed;z-index:10050;display:flex;gap:10px;max-width:min(340px,calc(100vw - 24px));padding:12px 14px;border-radius:12px;
  border:1px solid color-mix(in srgb,var(--lk-gold,#e0b552) 60%,transparent);background:linear-gradient(160deg,rgba(40,29,16,.98),rgba(16,11,6,.98));
  color:var(--lk-text,#e8dcc0);box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 30px rgba(224,181,82,.18);animation:lk-tip-in .45s cubic-bezier(.2,.9,.3,1.2) both;font-family:system-ui,sans-serif}
#lk-tip .lk-tip-lamp{color:var(--lk-gold,#e0b552);animation:lk-tip-flicker 3s ease-in-out infinite;flex-shrink:0;margin-top:2px}
#lk-tip b{font-family:var(--lk-title,serif);color:#f3e3b5;font-size:14px;letter-spacing:.04em;font-weight:600}
#lk-tip p{margin:4px 0 8px;font-size:12.5px;line-height:1.5;color:var(--lk-text,#e8dcc0)}
#lk-tip .lk-tip-actions{display:flex;gap:8px;align-items:center}
#lk-tip button{font:inherit;font-size:12px;border-radius:7px;cursor:pointer}
#lk-tip .lk-tip-ok{background:var(--lk-gold,#e0b552);color:#1a0f05;border:0;padding:5px 14px;font-weight:700}
#lk-tip .lk-tip-off{background:none;border:0;color:var(--lk-muted,#a8977a);text-decoration:underline;padding:0}
#lk-tip-ring{position:fixed;z-index:10049;pointer-events:none;border-radius:10px;border:2px solid var(--lk-gold,#e0b552);animation:lk-tip-ring 1.8s ease-out infinite}
@keyframes lk-tip-in{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}
@keyframes lk-tip-ring{0%{box-shadow:0 0 0 0 rgba(224,181,82,.55);opacity:1}100%{box-shadow:0 0 0 14px rgba(224,181,82,0);opacity:.6}}
@keyframes lk-tip-flicker{0%,100%{filter:drop-shadow(0 0 3px rgba(255,190,90,.5))}50%{filter:drop-shadow(0 0 9px rgba(255,190,90,.9))}}
@media (prefers-reduced-motion:reduce){#lk-tip,#lk-tip .lk-tip-lamp,#lk-tip-ring{animation:none}}`;
function ensureStyle() {
  if (document.getElementById('lk-tip-style')) return;
  const s = document.createElement('style'); s.id = 'lk-tip-style'; s.textContent = CSS; document.head.appendChild(s);
}
