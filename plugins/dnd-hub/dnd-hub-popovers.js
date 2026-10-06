// dnd-hub-popovers.js — the map's small panels and menus close when you click anywhere else, or press Escape.
// Before, the dice, weather and grid panels closed only from the button that opened them, and the template picker
// not at all (owner, 2026-10-05).
import { templatePending, destroyTemplatePicker } from './dnd-hub-templates.js?v=20261014u';

const remove = el => el.remove();
const POPOVERS = [
  { id: 'dice-panel', opener: '#btn-dice-look' },
  { id: 'weather-panel', opener: '#btn-weather' },
  { id: 'grid-panel', opener: '#btn-grid-settings', close: el => { el.style.display = 'none'; } },
  // With a shape chosen, a press on the map is the template being placed, not a click away.
  { id: 'template-picker', opener: '[onclick^="showTemplatePicker"]', keepOnMap: templatePending, close: () => destroyTemplatePicker() },
  { id: 'picture-menu' }, { id: 'pin-menu' }, { id: 'tmpl-ctx-menu' }, { id: 'zone-ctx-menu' },
];

const open = el => el && el.style.display !== 'none';
const onMap = t => !!t?.closest?.('#map-canvas-wrap');

export function closePopovers(target = null) {
  for (const p of POPOVERS) {
    const el = document.getElementById(p.id);
    if (!open(el) || (target && el.contains(target))) continue;
    if (target && p.opener && target.closest?.(p.opener)) continue; // its own button toggles it
    if (target && p.keepOnMap?.() && onMap(target)) continue;
    (p.close || remove)(el);
  }
}

let _bound = false;
export function bindPopoverDismiss() {
  if (_bound) return;
  _bound = true;
  document.addEventListener('pointerdown', e => closePopovers(e.target), true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopovers(); });
}
