// dnd-hub-dice-look.js — each player's dice skin: body, numbers and edge colours and a finish (owner request
// 2026-10-04: custom dice skins and colours). Kept per user (Hub user storage) and sent with every roll, so the
// table sees your dice in your colours. Anything that arrives in a roll is checked here before it is drawn.
import { storageGetUser, storageSetUser } from '../plugin-sdk.js';

export const FINISHES = ['glossy', 'matte', 'metal', 'glass'];
export const FINISH_LABELS = { glossy: 'Glossy', matte: 'Matte', metal: 'Metal', glass: 'Glass' };

export const PRESETS = [
  { id: 'lantern',  name: 'Lantern gold', body: '#0d0804', ink: '#d4af37', edge: '#d4af37', finish: 'glossy' },
  { id: 'bone',     name: 'Bone',         body: '#e8dcc0', ink: '#3a2a18', edge: '#8a7458', finish: 'matte' },
  { id: 'obsidian', name: 'Obsidian',     body: '#111114', ink: '#b9c3d6', edge: '#5d6a80', finish: 'glossy' },
  { id: 'ruby',     name: 'Ruby',         body: '#6b0f1a', ink: '#f6d28a', edge: '#f6d28a', finish: 'glass' },
  { id: 'emerald',  name: 'Emerald',      body: '#0f4d2e', ink: '#f1e6c8', edge: '#9fd6b0', finish: 'glass' },
  { id: 'frost',    name: 'Frost',        body: '#cfe8f5', ink: '#1d4e6e', edge: '#ffffff', finish: 'glass' },
  { id: 'copper',   name: 'Copper',       body: '#5a2e14', ink: '#f0b27a', edge: '#f0b27a', finish: 'metal' },
  { id: 'amethyst', name: 'Amethyst',     body: '#3b1f5c', ink: '#e7d4ff', edge: '#b897e8', finish: 'glossy' },
];
export const DEFAULT_LOOK = Object.freeze({ body: '#0d0804', ink: '#d4af37', edge: '#d4af37', finish: 'glossy' });

const HEX = /^#[0-9a-f]{6}$/i;
/** A look that is safe to draw: each colour a #rrggbb, the finish one we know. Anything else takes the default. */
export function cleanLook(look) {
  const l = look && typeof look === 'object' ? look : {};
  const pick = k => (typeof l[k] === 'string' && HEX.test(l[k]) ? l[k].toLowerCase() : DEFAULT_LOOK[k]);
  return { body: pick('body'), ink: pick('ink'), edge: pick('edge'), finish: FINISHES.includes(l.finish) ? l.finish : DEFAULT_LOOK.finish };
}

/** The preset a look matches, or null (the player mixed their own). */
export function presetOf(look) {
  const l = cleanLook(look);
  return PRESETS.find(p => p.body === l.body && p.ink === l.ink && p.edge === l.edge && p.finish === l.finish)?.id || null;
}

/** A short key for caching textures and materials. */
export const lookKey = look => { const l = cleanLook(look); return `${l.body}${l.ink}${l.edge}${l.finish}`; };

// ── This player's look ─────────────────────────────────────────────────────────────────────────────────────────
const KEY = 'dice-look';
let _mine = { ...DEFAULT_LOOK };
export const myLook = () => ({ ..._mine });

export async function loadMyLook() {
  try { const v = await storageGetUser(KEY); if (v) _mine = cleanLook(v); } catch { /* the default */ }
  return myLook();
}

let _saveTimer = null;
/** Change part of this player's look (`{ body }`, a preset's fields…); saved a moment later. */
export function setMyLook(change) {
  _mine = cleanLook({ ..._mine, ...change });
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => storageSetUser(KEY, _mine).catch(() => {}), 600);
  return myLook();
}
