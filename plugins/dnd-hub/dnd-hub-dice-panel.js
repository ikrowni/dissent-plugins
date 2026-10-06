// dnd-hub-dice-panel.js — the map toolbar's Dice panel: pick a skin or mix your own colours and finish, and roll a
// test die (only on your screen). The look itself lives in dnd-hub-dice-look.js and rides along with your rolls.
import { esc } from '../plugin-sdk.js';
import { PRESETS, FINISHES, FINISH_LABELS, myLook, setMyLook, presetOf } from './dnd-hub-dice-look.js';
import { animateDiceFree } from './dnd-hub-dice.js?v=20261014s';

function panelHtml() {
  const l = myLook(), on = presetOf(l);
  const swatch = p => `<span class="lk-dice-swatch" style="background:${p.body};border-color:${p.edge};color:${p.ink}">20</span>`;
  const colour = (k, label) => `<label class="lk-pop-row">${label} <input type="color" value="${l[k]}" onchange="diceLookColor('${k}', this.value)"></label>`;
  return `<div class="lk-pop-title">Your dice</div>
    <div class="lk-chips lk-dice-presets">${PRESETS.map(p =>
      `<button aria-pressed="${on === p.id}" onclick="diceLookPreset('${p.id}')">${swatch(p)}${esc(p.name)}</button>`).join('')}</div>
    ${colour('body', 'Dice')}${colour('ink', 'Numbers')}${colour('edge', 'Edges')}
    <div class="lk-chips">${FINISHES.map(f => `<button aria-pressed="${l.finish === f}" onclick="diceLookFinish('${f}')">${FINISH_LABELS[f]}</button>`).join('')}</div>
    <button class="lk-dice-try" onclick="diceLookTry()">Roll a test die</button>
    <div class="lk-pop-note">Everyone at the table sees your rolls in these colours. A test die is only on your screen.</div>`;
}

const redraw = () => { const el = document.getElementById('dice-panel'); if (el) el.innerHTML = panelHtml(); };

export function toggleDicePanel() {
  const old = document.getElementById('dice-panel');
  if (old) { old.remove(); return; }
  const el = document.createElement('div');
  el.id = 'dice-panel'; el.className = 'lk-pop lk-dice-panel';
  el.innerHTML = panelHtml();
  document.getElementById('map-root')?.appendChild(el);
}

export function diceLookPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  if (p) { setMyLook({ body: p.body, ink: p.ink, edge: p.edge, finish: p.finish }); redraw(); }
}
export function diceLookColor(k, v) { if (['body', 'ink', 'edge'].includes(k)) { setMyLook({ [k]: v }); redraw(); } }
export function diceLookFinish(f) { setMyLook({ finish: f }); redraw(); }
export function diceLookTry() { animateDiceFree(20, 1, myLook()).catch?.(() => {}); }
