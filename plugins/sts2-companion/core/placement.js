// core/placement.js — where the plugin is drawn (from dissent:init), and what an overlay panel
// does when the user opens the overlay. Pure.
//
// The overlay host (dissent-client src/overlay/pluginSurfaces.ts) sends every panel the SAME
// plugin.html with context { placement: 'overlay', surface: '<manifest surface id>', game }.
// The app page sends placement 'page' and no surface.

/** Manifest overlay surface id → the section that panel shows. manifest.test.js keeps them in step. */
export const SURFACE_SECTIONS = { wiki: 'wiki', deck: 'deck' };

export function layoutFor(context) {
  if (context?.placement !== 'overlay') return { compact: false, section: 'wiki' };
  return { compact: true, section: SURFACE_SECTIONS[context.surface] ?? 'wiki' };
}

/**
 * `answer` is overlay.context's result after an overlay.context.changed cue (null if refused).
 * ⚠️ Overlay frames never receive game.saves.changed (only the main window forwards it), so
 * opening the overlay is the Deck's cue to re-read the save.
 */
export function onPanelShown(view, answer) {
  if (answer?.panelOpen !== true) return false;
  view?.focusSearch?.();
  view?.refresh?.();
  return true;
}
