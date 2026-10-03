// dnd-hub-movement.js — who may move a token, and how far, during a fight. Pure: no PIXI, no MAP.
//
// Owner decisions (2026-10-03): outside a fight tokens move freely (5e has no turns there). During a
// fight a player moves only their own token, only on its turn, and only as far as its speed; the
// path walked this turn is what counts, not the straight line. These are fog-safety rules, so no
// Table rules preset turns them off. The DM moves anything, any time.

/** One cell of the grid, by its column and row. */
export const cellAt = (x, y, ox, oy, gs) => ({ cx: Math.floor((x - ox) / gs), cy: Math.floor((y - oy) / gs) });
export const cellCentre = (c, ox, oy, gs) => ({ x: ox + c.cx * gs + gs / 2, y: oy + c.cy * gs + gs / 2 });
const same = (a, b) => !!a && !!b && a.cx === b.cx && a.cy === b.cy;
const adjacent = (a, b) => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy)) <= 1;

/** A fight is on and this token's turn identifies it: the same key on every screen. Null outside a fight. */
export function turnKey(init, activeId) {
  if (!activeId) return null;
  return `${init?.round ?? 1}:${init?.currentIndex ?? 0}:${activeId}`;
}

/**
 * 'free' (no fight, or the DM), 'locked' (a fight is on and it is not this token's turn), or 'budget'
 * (this token's turn: it may walk up to its speed).
 */
export function moveMode({ isDM, activeTurnTokenId, tokenId }) {
  if (isDM || !activeTurnTokenId) return 'free';
  return activeTurnTokenId === tokenId ? 'budget' : 'locked';
}

/** Feet walked along a path of adjacent cells: every step is 5 ft, diagonals included (the 5e default). */
export const pathFeet = path => Math.max(0, (path?.length || 0) - 1) * 5;

/** The cells a straight line passes through from a to b, b included and a not (a pointer can skip cells). */
export function cellsBetween(a, b) {
  const out = [];
  const n = Math.max(Math.abs(b.cx - a.cx), Math.abs(b.cy - a.cy));
  for (let i = 1; i <= n; i++) {
    out.push({ cx: a.cx + Math.round((b.cx - a.cx) * i / n), cy: a.cy + Math.round((b.cy - a.cy) * i / n) });
  }
  return out;
}

/**
 * Walk the path toward `cell`, one adjacent cell at a time. Steps back over cells not yet committed
 * (`committed` = how many cells of the path are already spent; a drag can retrace itself before the
 * drop, a finished move cannot be taken back). Stops at a wall (`blocked(from, to)`) or when the next
 * step would pass `speedFt`. Returns { path, stopped } — a new array; the input is not changed.
 */
export function extendPath(path, cell, { committed = 1, speedFt = Infinity, blocked = () => false } = {}) {
  const p = path.slice();
  let stopped = null;
  for (const next of cellsBetween(p[p.length - 1], cell)) {
    if (p.length > committed && same(next, p[p.length - 2])) { p.pop(); continue; }
    if (same(next, p[p.length - 1])) continue;
    if (blocked(p[p.length - 1], next)) { stopped = 'wall'; break; }
    if (pathFeet(p) + 5 > speedFt) { stopped = 'speed'; break; }
    p.push(next);
  }
  return { path: p, stopped };
}

/**
 * The DM's screen checks a player's finished move. `turn` is what the DM's screen holds for this
 * token's turn ({ path }); `reported` is the path the player's screen sent. Legal when it continues the
 * turn's path cell by cell, never crosses a wall, and stays within speed. Returns the path to keep.
 */
export function checkReportedPath(turn, reported, speedFt, blocked = () => false) {
  const have = turn?.path || [];
  if (!Array.isArray(reported) || reported.length < have.length) return { ok: false, path: have };
  for (let i = 0; i < have.length; i++) if (!same(have[i], reported[i])) return { ok: false, path: have };
  for (let i = Math.max(1, have.length); i < reported.length; i++) {
    const a = reported[i - 1], b = reported[i];
    if (!adjacent(a, b) || blocked(a, b)) return { ok: false, path: have };
  }
  if (pathFeet(reported) > speedFt) return { ok: false, path: have };
  return { ok: true, path: reported };
}

/** Conditions that make a creature's speed 0 (SRD 5.1 appendix A). */
const STOPPED = ['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'];

/** Feet this token may walk on its turn: its own speed, else its character's, else 30; 0 while held. */
export function speedOf(token, summary) {
  if ((token?.conditions || []).some(c => STOPPED.includes(c))) return 0;
  return Number(token?.speed) || Number(summary?.speed) || 30;
}

/**
 * Where a player may put their own token the first time: only on ground the party has already seen,
 * so placing it cannot open the fog anywhere new. 'nothing-revealed' means the DM has revealed
 * nothing yet; the caller then uses the map's start cell.
 */
export function placeVerdict(fogState, cell) {
  const seen = s => s === 'visible' || s === 'explored';
  if (seen(fogState?.[`${cell.cx},${cell.cy}`])) return 'ok';
  return Object.values(fogState || {}).some(seen) ? 'fogged' : 'nothing-revealed';
}
