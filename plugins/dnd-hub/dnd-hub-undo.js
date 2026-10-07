// dnd-hub-undo.js — Ctrl+Z / Ctrl+Y for the DM's map tools (owner request 2026-10-04): walls, doors, lights, pins,
// sound zones, traps, pinned pictures and the fog brushes. Never tokens, HP, dice or combat: those belong to players too, and
// undoing one could overwrite what someone else did.
//
// How: this screen keeps the last saved copy of each of those parts of the open map. Every save the DM makes on this
// screen (saveHubDm) is compared with it; a part that changed is one undo step, holding the part as it was. Changes
// that arrive from elsewhere (another screen, the DM sidebar) only move the copy forward (`whileRemote`). Fog is
// recorded around each brush stroke and reset instead, because players' sight changes it all the time.
// An undo puts the part back and sends it the way its own tool does.
import { MAP } from './dnd-hub-state.js?v=20261015d';

export const PARTS = ['walls', 'doors', 'lights', 'pins', 'audioZones', 'triggers', 'pictures'];
const WORDS = { walls: 'walls', doors: 'doors', lights: 'lights', pins: 'pins', audioZones: 'sound zones', triggers: 'traps', pictures: 'pictures', fogState: 'fog' };
const LIMIT = 30;

/** The pure part: a history of `{ parts: { name: before } }` steps over a map's state. */
export function createHistory(limit = LIMIT) {
  let base = null, undo = [], redo = [];
  const pick = (md, names) => Object.fromEntries(names.map(n => [n, clone(md?.[n])]));
  return {
    /** Start over on a map (another map opened, or a reload). */
    reset(md) { base = pick(md, PARTS); undo = []; redo = []; },
    /** Take `md` as it is now without making a step (a change from elsewhere). */
    rebase(md) { base = pick(md, PARTS); },
    /** A save happened: the changed parts become one step. Returns the step's names (none: nothing changed). */
    record(md) {
      if (!base) { this.reset(md); return []; }
      const now = pick(md, PARTS);
      const changed = PARTS.filter(n => JSON.stringify(now[n] ?? null) !== JSON.stringify(base[n] ?? null));
      if (changed.length) this.push(Object.fromEntries(changed.map(n => [n, base[n]])));
      base = now;
      return changed;
    },
    /** A step made outside `record` (the fog brush): `parts` = { name: before }. */
    push(parts) { undo.push({ parts }); if (undo.length > limit) undo.shift(); redo = []; },
    /** Take the last step back: returns `{ name: value to restore }` and keeps the present for redo. */
    undo(md) { return flip(undo, redo, md); },
    redo(md) { return flip(redo, undo, md); },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
  };
  function flip(from, to, md) {
    const step = from.pop();
    if (!step) return null;
    to.push({ parts: Object.fromEntries(Object.keys(step.parts).map(n => [n, clone(md?.[n])])) });
    for (const [n, v] of Object.entries(step.parts)) if (base && n in base) base[n] = clone(v);
    return step.parts;
  }
}

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/** Fog cells to send so every screen ends up at `target`: keys it lacks are sent as unexplored. */
export function fogCells(target = {}, current = {}) {
  const keys = new Set([...Object.keys(target || {}), ...Object.keys(current || {})]);
  return [...keys].map(k => [k, target?.[k] || 'unexplored']);
}

export const describe = names => names.map(n => WORDS[n] || n).join(', ');

// ── This screen ───────────────────────────────────────────────────────────────────────────────────────────────────
const _h = createHistory();
let _mapKey = null, _remote = 0, _restoring = false, _fogBefore = null;
let _apply = null; // { name: async () => void } from dnd-hub-undo-apply.js: put a part back on every screen

export function setUndoAppliers(fns) { _apply = fns; }
const mapKey = () => MAP.campaignId + '/' + MAP.mapId;
function sameMap() {
  if (_mapKey !== mapKey()) { _mapKey = mapKey(); _h.reset(MAP.mapData); return false; }
  return true;
}

/** Called at the start of every saveHubDm on this screen. */
export function noteSave() {
  if (!MAP.isDM || !MAP.mapData || _restoring) return;
  if (!sameMap()) return;
  if (_remote) _h.rebase(MAP.mapData); else _h.record(MAP.mapData);
  refreshUndoButtons();
}

/** Run `fn` (an incoming event) so that what it changes is not taken for the DM's own edit. */
export async function whileRemote(fn) {
  _remote++;
  try { return await fn(); } finally {
    _remote--;
    if (MAP.isDM && MAP.mapData && sameMap()) _h.rebase(MAP.mapData);
  }
}

/** The fog brush: before a stroke, and after it (or after Reset fog). */
export function fogBefore() { if (MAP.isDM && MAP.mapData) { sameMap(); _fogBefore = clone(MAP.mapData.fogState || {}); } }
export function fogAfter() {
  if (!_fogBefore || !MAP.mapData) return;
  if (JSON.stringify(_fogBefore) !== JSON.stringify(MAP.mapData.fogState || {})) _h.push({ fogState: _fogBefore });
  _fogBefore = null;
  refreshUndoButtons();
}

export const undoMap = () => step('undo');
export const redoMap = () => step('redo');

async function step(which) {
  if (!MAP.isDM || !MAP.mapData || _restoring || !_apply) return;
  sameMap();
  const parts = _h[which](MAP.mapData);
  if (!parts) { undoNotice(which === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.'); return; }
  _restoring = true;
  try {
    for (const [n, v] of Object.entries(parts)) {
      const previous = clone(MAP.mapData[n]);
      MAP.mapData[n] = v === undefined ? (n === 'doors' || n === 'fogState' ? {} : []) : v;
      await _apply[n]?.(previous);
    }
  } finally { _restoring = false; }
  undoNotice((which === 'undo' ? 'Undone: ' : 'Redone: ') + describe(Object.keys(parts)));
  refreshUndoButtons();
}

export function refreshUndoButtons() {
  const u = document.getElementById('btn-undo'), r = document.getElementById('btn-redo');
  if (u) u.disabled = !_h.canUndo;
  if (r) r.disabled = !_h.canRedo;
}

function undoNotice(text) {
  document.getElementById('lk-travel-notice')?.remove();
  const el = document.createElement('div');
  el.id = 'lk-travel-notice';
  el.className = 'lk-travel-notice';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

/** The map was replaced by a merged copy (a save met another screen's changes): take it as the new present. */
export function rebaseUndo() { if (MAP.isDM && MAP.mapData && sameMap()) _h.rebase(MAP.mapData); }
