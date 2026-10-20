// ul-chunk.js — the pieces levels are built from (spec §6). Every chunk is one screen, 32 x 18 tiles, and its
// openings sit in fixed slots, so any two chunks line up: a 4-tall doorway at floor height on the left and right,
// a 4-wide shaft at the top and bottom. Everything else on the border is stone.
//
// Inside a chunk, besides the room tiles ('#', '^', '-', ' ') and fixed spawns (P start, X stairs down, S sconce,
// o oil cache), the builder's slots: g ground enemy, a air enemy, ? maybe a sconce, * maybe stone.
export const CW = 32, CH = 18;
export const DOOR_ROWS = [12, 13, 14, 15];      // left and right doorways; the floor under them is row 16
export const SHAFT_COLS = [14, 15, 16, 17];     // top and bottom shafts
export const SIDES = ['L', 'R', 'U', 'D'];
export const OPPOSITE = { L: 'R', R: 'L', U: 'D', D: 'U' };
export const CHUNK_LETTERS = '#^- PXSoga?*';

/** The border tiles of one side's slot, as [col, row] pairs. */
export function slotTiles(side) {
  if (side === 'L') return DOOR_ROWS.map((r) => [0, r]);
  if (side === 'R') return DOOR_ROWS.map((r) => [CW - 1, r]);
  if (side === 'U') return SHAFT_COLS.map((c) => [c, 0]);
  return SHAFT_COLS.map((c) => [c, CH - 1]);
}
const isSlot = (c, r) => SIDES.some((s) => slotTiles(s).some(([sc, sr]) => sc === c && sr === r));

/** Which sides are open (their slot is all air). */
export function openings(rows) {
  return new Set(SIDES.filter((s) => slotTiles(s).every(([c, r]) => rows[r][c] === ' ')));
}

/** Everything wrong with a chunk, as sentences. Empty when it is fine. */
export function chunkErrors(chunk) {
  const { id, rows } = chunk, errs = [];
  if (rows.length !== CH) errs.push(`${id}: ${rows.length} rows, not ${CH}`);
  rows.forEach((row, r) => { if (row.length !== CW) errs.push(`${id}: row ${r} is ${row.length} wide, not ${CW}`); });
  if (errs.length) return errs;
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (!CHUNK_LETTERS.includes(ch)) errs.push(`${id}: row ${r} col ${c}: unknown "${ch}"`); }));
  for (let r = 0; r < CH; r++) for (let c = 0; c < CW; c++) {
    const border = r === 0 || r === CH - 1 || c === 0 || c === CW - 1;
    if (border && !isSlot(c, r) && rows[r][c] !== '#') errs.push(`${id}: border at row ${r} col ${c} must be stone`);
  }
  for (const s of SIDES) {
    const t = slotTiles(s).map(([c, r]) => rows[r][c]);
    if (!t.every((x) => x === ' ') && !t.every((x) => x === '#')) errs.push(`${id}: the ${s} slot must be all air or all stone`);
  }
  for (const s of ['L', 'R']) { // a doorway needs floor under it, so walking across the seam works
    const c = s === 'L' ? 0 : CW - 1;
    if (openings(rows).has(s) && rows[16][c] !== '#') errs.push(`${id}: no floor under the ${s} doorway`);
  }
  const count = (ch) => rows.join('').split(ch).length - 1;
  if (chunk.role === 'entrance' && count('P') !== 1) errs.push(`${id}: an entrance needs exactly one P`);
  if (chunk.role !== 'entrance' && chunk.role !== 'lamppost' && count('P')) errs.push(`${id}: only an entrance has a P`);
  if ((chunk.role === 'exit' || chunk.role === 'lamppost') && count('X') !== 1) errs.push(`${id}: needs exactly one X`);
  if (chunk.role !== 'exit' && chunk.role !== 'lamppost' && count('X')) errs.push(`${id}: only an exit has an X`);
  return errs;
}

/** A copy of the chunk with these sides sealed with stone. */
export function seal(rows, sides) {
  const g = rows.map((r) => [...r]);
  for (const s of sides) for (const [c, r] of slotTiles(s)) g[r][c] = '#';
  return g.map((r) => r.join(''));
}
