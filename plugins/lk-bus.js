// lk-bus.js — how the three LanternKeep plugins tell each other things.
//
// ⚠️ SOURCE; vendored into dnd-hub, dnd-master and dnd-player (scripts/vendor-shared.mjs).
//
// 🔴 A plain realtimePublish reaches only the SAME plugin on other screens: the node fans an event out
// to one plugin install (plugin_install_id), and every frame drops events of other installs. So the DM
// sidebar's "load scene", "push handout" and HP edits never reached the Hub or the player sheet (audit N).
// `publishTo` sends to this plugin's peers AND to each named sibling, stamping an id so a receiver can
// drop a copy it has already handled (`isRepeat`).
import { realtimePublish, realtimePublishCompanion } from './plugin-sdk.js';

const PLUGIN = { hub: 'dnd-hub', master: 'dnd-master', player: 'dnd-player' };

let _n = 0;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${(_n++).toString(36)}`;

/** Send `event` with `data` to this plugin's other screens and to the sibling plugins in `to`. */
export async function publishTo(to, event, data) {
  const payload = { ...data, type: data?.type ?? event, eid: data?.eid ?? newId() };
  await Promise.all([
    realtimePublish(event, payload),
    ...to.map(t => realtimePublishCompanion(PLUGIN[t] || t, event, payload)),
  ]);
  return payload;
}

const _seen = new Map();
/** True when this event id was already handled here; remembers it otherwise. Events without an id pass. */
export function isRepeat(data) {
  const id = data?.eid;
  if (!id) return false;
  if (_seen.has(id)) return true;
  _seen.set(id, Date.now());
  if (_seen.size > 500) for (const [k] of [..._seen].slice(0, 250)) _seen.delete(k);
  return false;
}
