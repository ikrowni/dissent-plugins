// ul-settings-card.js — the settings card: every action's key (click Change, press a key), volume, reset. It draws
// into the card element and hands each change back; ul-settings.js holds the rules (swaps, reserved keys).
import { ACTIONS, keysOf, keyLabel, rebind, withVolume, DEFAULT_SETTINGS } from './ul-settings.js';

/** opts: { onChange(settings), onDone() }. Keys pressed while choosing never reach the game. */
export function showSettings(card, settings, opts) {
  let current = settings, listening = null, note = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const onKey = (e) => {
    if (!listening) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const k = e.key.toLowerCase(), action = listening;
    listening = null;
    if (k === 'escape') { note = ''; draw(); return; }
    const r = rebind(current, action, k);
    if (r.error) note = r.error; else { current = r.settings; note = ''; opts.onChange(current); }
    draw();
  };
  addEventListener('keydown', onKey, true);
  function done() { removeEventListener('keydown', onKey, true); opts.onDone(); }
  function draw() {
    card.replaceChildren();
    const box = el('div', 'box settings');
    box.append(el('h3', null, 'Settings'));
    const list = el('div', 'keys-list');
    for (const [action, label] of ACTIONS) {
      const row = el('div', 'key-row');
      row.append(el('span', 'key-name', label));
      row.append(el('kbd', null, listening === action ? 'press a key…' : keysOf(current, action).map(keyLabel).join(' / ')));
      const b = el('button', null, 'Change'); b.onclick = () => { listening = action; note = 'Press a key, or Escape to keep it.'; draw(); };
      row.append(b); list.append(row);
    }
    box.append(list);
    box.append(el('p', 'small', 'Left click attacks and right click blocks; a controller keeps its buttons.'));
    const vol = el('label', 'vol', 'Volume ');
    const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.value = String(Math.round(current.volume * 100));
    range.oninput = () => { current = withVolume(current, Number(range.value) / 100); opts.onChange(current); };
    vol.append(range); box.append(vol);
    if (note) box.append(el('p', 'note', note));
    const row = el('div', 'row');
    const reset = el('button', null, 'Reset to defaults'); reset.onclick = () => { current = DEFAULT_SETTINGS; note = ''; opts.onChange(current); draw(); };
    const ok = el('button', 'pri', 'Done'); ok.onclick = done;
    row.append(ok, reset); box.append(row);
    card.append(box); card.classList.add('show');
    if (!listening) ok.focus();
  }
  draw();
}

/** The keys hint in the corner, from your bindings. */
export function keysHint(settings) {
  const k = (a) => keysOf(settings, a).map(keyLabel).join('/');
  return `${k('left')} ${k('right')} move · ${k('jump')} jump · ${k('down')}+jump drop · Left click / ${k('attack')} attack · Right click / ${k('block')} block\n`
    + `${k('roll')} roll · ${k('throwL')} throw / call back the lantern · ${k('flask')} flask · P pause · M mute`;
}
