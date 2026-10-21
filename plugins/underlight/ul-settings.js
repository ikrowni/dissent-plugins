// ul-settings.js — your keys and volume (spec §5.1: keyboard and controller, with rebinding). A rebound action has one
// key of yours instead of its default keys; mouse buttons and the controller keep theirs. A key already used by
// another action swaps with it, so two actions never share a key. Some keys can't be bound: they run the cards and
// the menus (Escape, Enter, P pause, M mute, Tab).
import { BINDINGS } from './ul-input.js';

export const SETTINGS_KEY = 'settings', SETTINGS_V = 1;
export const DEFAULT_SETTINGS = Object.freeze({ v: SETTINGS_V, volume: 1, keys: Object.freeze({}) });
export const RESERVED = ['escape', 'enter', 'p', 'm', 'tab'];
export const ACTIONS = [['left', 'Move left'], ['right', 'Move right'], ['jump', 'Jump'], ['down', 'Down (with jump: drop)'],
  ['roll', 'Roll'], ['attack', 'Attack'], ['block', 'Block / parry'], ['throwL', 'Throw / call back the lantern'], ['flask', 'Drink the flask']];

const isDevice = (k) => k.startsWith('pad:') || k.startsWith('mouse');

/** The bindings to play with: defaults, with each rebound action's keyboard keys replaced by its one key. */
export function bindingsFor(settings) {
  const out = {};
  for (const [action, keys] of Object.entries(BINDINGS)) {
    const mine = settings.keys[action];
    out[action] = mine ? [mine, ...keys.filter(isDevice)] : [...keys];
  }
  return out;
}

/** The keyboard keys an action answers to now. */
export const keysOf = (settings, action) => bindingsFor(settings)[action].filter((k) => !isDevice(k));

/** Bind `key` to `action`. Returns { settings } or { error }. A key another action uses swaps over to it. */
export function rebind(settings, action, key) {
  if (!BINDINGS[action]) return { error: `no action "${action}"` };
  if (RESERVED.includes(key)) return { error: `${keyLabel(key)} is kept for the menus` };
  const keys = { ...settings.keys };
  const b = bindingsFor(settings);
  const other = Object.keys(b).find((a) => a !== action && b[a].includes(key));
  if (other) keys[other] = keysOf(settings, action)[0]; // swap: the other action takes this one's key
  keys[action] = key;
  return { settings: { ...settings, keys } };
}

export const withVolume = (settings, volume) => ({ ...settings, volume: Math.max(0, Math.min(1, volume)) });

/** A stored value → settings, or the defaults. Unknown actions and reserved keys are dropped. */
export function readSettings(x) {
  if (!x || typeof x !== 'object' || x.v !== SETTINGS_V) return DEFAULT_SETTINGS;
  const keys = {};
  for (const [a, k] of Object.entries(x.keys ?? {})) if (BINDINGS[a] && typeof k === 'string' && k.length && !RESERVED.includes(k) && !isDevice(k)) keys[a] = k;
  const volume = typeof x.volume === 'number' && Number.isFinite(x.volume) ? Math.max(0, Math.min(1, x.volume)) : 1;
  return { v: SETTINGS_V, volume, keys };
}

const NAMES = { ' ': 'Space', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', shift: 'Shift', control: 'Ctrl', alt: 'Alt' };
export const keyLabel = (k) => NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));
