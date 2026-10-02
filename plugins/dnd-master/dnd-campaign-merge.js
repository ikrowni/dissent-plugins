// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/dnd-campaign-merge.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../dnd-campaign-merge.js' directly would make the plugin unmirrorable.

// plugins/dnd-campaign-merge.js
//
// Three-way merge for one campaign object: base (what this client last read or wrote),
// local (base plus this client's edits), remote (what storage holds right now).
//
// WHY: every D&D client used to write the WHOLE campaign it had in memory, so any edit
// made elsewhere since this client loaded was silently reverted: a player's move erased
// by the DM's next light tweak, two simultaneous joins leaving one player out. Plugin
// storage has no compare-and-swap for in-app plugins, so each save re-reads and merges
// instead. A change survives unless the SAME leaf was changed on both sides, and then
// the writer (local) wins, which is what "last edit wins" means to a user.
//
// Rules:
//  - unchanged locally  → take remote;  unchanged remotely → take local
//  - both changed, both plain objects  → merge key by key (missing = deleted)
//  - both changed, both arrays of primitives → set merge: remote + our adds − our removals
//  - both changed, both arrays of {id} objects → merge by id, remote order first
//  - anything else → local wins
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isPrimArr = a => Array.isArray(a) && a.every(v => v === null || typeof v !== 'object');
const isIdArr = a => Array.isArray(a) && a.length > 0 && a.every(v => isObj(v) && v.id != null);

function mergeValue(base, local, remote) {
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(local), ...Object.keys(remote)])) {
      const v = mergeValue(b[k], local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (isPrimArr(local) && isPrimArr(remote) && (base === undefined || isPrimArr(base))) {
    const b = base || [];
    const added = local.filter(v => !b.includes(v));
    const removed = new Set(b.filter(v => !local.includes(v)));
    const out = remote.filter(v => !removed.has(v));
    for (const v of added) if (!out.includes(v)) out.push(v);
    return out;
  }
  const idLike = a => a === undefined || (Array.isArray(a) && (a.length === 0 || isIdArr(a)));
  if (Array.isArray(local) && Array.isArray(remote) && idLike(base) && idLike(local) && idLike(remote)) {
    const byId = a => Object.fromEntries((a || []).map(v => [String(v.id), v]));
    const merged = mergeValue(byId(base), byId(local), byId(remote));
    const order = [...remote.map(v => String(v.id)), ...local.map(v => String(v.id))];
    const seen = new Set();
    return order.filter(id => !seen.has(id) && seen.add(id) && merged[id] !== undefined).map(id => merged[id]);
  }
  return local;
}

export function mergeCampaign(base, local, remote) {
  if (remote === null || remote === undefined) return local;
  if (base === undefined) return local;
  return JSON.parse(JSON.stringify(mergeValue(base, local, remote)));
}
