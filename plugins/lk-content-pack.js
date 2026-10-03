// lk-content-pack.js — LanternKeep content packs: the format the sample adventure ships in and the PDF import
// will write (spec 2026-10-03 §3; PDF import spec §3). ⚠️ SOURCE; vendored by scripts/vendor-shared.mjs.
// Maps are authored in grid CELLS; compileMap turns them into the map record the Hub draws (image pixels).

export const PACK_FORMAT_VERSION = 1;

const key = (x1, y1, x2, y2) => (x1 < x2 || (x1 === x2 && y1 < y2)) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;

/** Every unit edge (one cell long) of a rectangle, as keys. */
function roomEdges(r) {
  const out = [];
  for (let x = r.x; x < r.x + r.w; x++) { out.push(key(x, r.y, x + 1, r.y)); out.push(key(x, r.y + r.h, x + 1, r.y + r.h)); }
  for (let y = r.y; y < r.y + r.h; y++) { out.push(key(r.x, y, r.x, y + 1)); out.push(key(r.x + r.w, y, r.x + r.w, y + 1)); }
  return out;
}
/** Unit edges covered by a straight segment (cells), as keys. */
function segEdges(s) {
  const out = [];
  if (s.x1 === s.x2) for (let y = Math.min(s.y1, s.y2); y < Math.max(s.y1, s.y2); y++) out.push(key(s.x1, y, s.x1, y + 1));
  else for (let x = Math.min(s.x1, s.x2); x < Math.max(s.x1, s.x2); x++) out.push(key(x, s.y1, x + 1, s.y1));
  return out;
}

/** The pack map as the Hub's map record: walls, doors, lights (px), traps as triggers, start cell. */
export function compileMap(m) {
  const gs = m.gridSize || 50;
  const gaps = new Set([...(m.doors || []), ...(m.openings || [])].flatMap(segEdges));
  const units = new Set(m.rooms.flatMap(roomEdges).filter(k => !gaps.has(k)));
  // Merge collinear neighbours into long walls.
  const horiz = {}, vert = {};
  for (const k of units) {
    const [x1, y1, x2, y2] = k.split(',').map(Number);
    if (y1 === y2) (horiz[y1] ||= []).push(x1); else (vert[x1] ||= []).push(y1);
  }
  const walls = [];
  let n = 0;
  const run = (starts, emit) => {
    const s = [...starts].sort((a, b) => a - b);
    let a = s[0], b = s[0] + 1;
    for (let i = 1; i <= s.length; i++) {
      if (i < s.length && s[i] === b) { b++; continue; }
      emit(a, b); a = s[i]; b = s[i] + 1;
    }
  };
  for (const [y, xs] of Object.entries(horiz)) run(xs, (a, b) => walls.push({ id: `w${n++}`, x1: a * gs, y1: +y * gs, x2: b * gs, y2: +y * gs }));
  for (const [x, ys] of Object.entries(vert)) run(ys, (a, b) => walls.push({ id: `w${n++}`, x1: +x * gs, y1: a * gs, x2: +x * gs, y2: b * gs }));
  const doors = Object.fromEntries((m.doors || []).map(d => [d.id, {
    id: d.id, x1: d.x1 * gs, y1: d.y1 * gs, x2: d.x2 * gs, y2: d.y2 * gs, state: d.state || 'closed' }]));
  const lights = (m.lights || []).map((l, i) => ({
    id: `light_${m.id}_${i}`, x: (l.cx + 0.5) * gs, y: (l.cy + 0.5) * gs, radius: (l.feet / 5) * gs,
    color: l.color ?? 0xffcc66, intensity: l.intensity ?? 1, flicker: !!l.flicker, tokenId: null }));
  const triggers = (m.traps || []).map((t, i) => ({
    id: `trap_${m.id}_${i}`, cx: t.cx, cy: t.cy, type: 'trap', label: t.label || 'Trap', message: '',
    damageExpr: t.damage, saveAbility: t.saveAbility || '', saveDC: t.saveDC || null, spotDC: t.spotDC || null,
    destCx: null, destCy: null, fileId: null, requireConfirm: false, oneShot: true, disabled: false }));
  return { width: m.cols * gs, height: m.rows * gs, gridSize: gs, coordFrame: 'image', gridType: 'square',
    gridEnabled: true, gridOffsetX: 0, gridOffsetY: 0, gridColor: '#ffffff', gridAlpha: 0.06,
    walls, doors, lights, triggers, audioZones: [], tokens: {}, fogState: {},
    startCell: m.startCell || { cx: 1, cy: 1 } };
}

/** Problems with a pack, as readable strings; [] when sound. `srd` (optional) checks monster and item ids. */
export function validatePack(p, srd = null) {
  const out = [];
  if (p?.formatVersion !== PACK_FORMAT_VERSION) out.push(`formatVersion must be ${PACK_FORMAT_VERSION}`);
  for (const m of p?.maps || []) {
    const edges = new Set(m.rooms.flatMap(roomEdges));
    for (const d of [...(m.doors || []), ...(m.openings || [])]) {
      if (!segEdges(d).every(k => edges.has(k))) out.push(`map ${m.id}: door ${d.id || '(opening)'} is not on a room edge`);
    }
    // Reachability from the start cell through doors and openings.
    const inRoom = (r, cx, cy) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
    const sc = m.startCell || { cx: m.rooms[0].x, cy: m.rooms[0].y };
    const start = m.rooms.find(r => inRoom(r, sc.cx, sc.cy));
    if (!start) { out.push(`map ${m.id}: start cell is in no room`); continue; }
    const links = (m.doors || []).map(d => m.rooms.filter(r => segEdges(d).some(k => roomEdges(r).includes(k))).map(r => r.id));
    const seen = new Set([start.id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const l of links) if (l.some(id => seen.has(id)) && l.some(id => !seen.has(id))) { l.forEach(id => seen.add(id)); changed = true; }
    }
    for (const r of m.rooms) if (!seen.has(r.id)) out.push(`map ${m.id}: room ${r.id} (${r.name}) cannot be reached`);
  }
  if (srd) {
    const mons = new Set((srd.monsters || []).map(x => x.id));
    for (const e of p.encounters || []) for (const it of e.items || []) if (!mons.has(it.id)) out.push(`encounter ${e.id}: unknown monster ${it.id}`);
    const magic = new Set((srd.magicItems || []).map(x => x.id));
    for (const it of p.items || []) if (it.srdId && !magic.has(it.srdId)) out.push(`item ${it.id}: unknown SRD item ${it.srdId}`);
  }
  return out;
}
