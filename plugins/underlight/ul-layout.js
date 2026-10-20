// ul-layout.js — where a level's chunks go (spec §6): a grid of cells, a path from an entrance on the top row to the
// stairs on the bottom row (Spelunky's walk: sideways or down, never up), side rooms hung off the path as dead ends,
// and an enemy budget for each cell from the biome's pacing curve (danger rising, a quiet break, a peak at the end).
import { OPPOSITE } from './ul-chunk.js';

const randInt = (r, a, b) => a + Math.floor(r() * (b - a + 1));

/**
 * plan: { grid: [cols, rows], path: [min, max] cells, sides: [min, max], pacing: [budget…], sideBudget }.
 * Returns { cols, rows, cells: [{ c, r, role, need: Set<side>, budget, at }] } where role is entrance | path | exit |
 * side, and at is the cell's place along the path (sides take their path cell's).
 */
export function makeLayout(plan, r) {
  const [cols, rows] = plan.grid;
  for (let tries = 0; tries < 500; tries++) {
    const path = walk(cols, rows, r);
    if (path.length < plan.path[0] || path.length > plan.path[1]) continue;
    return dress(plan, path, cols, rows, r);
  }
  throw new Error(`no path of ${plan.path[0]}–${plan.path[1]} cells fits a ${cols}x${rows} grid`);
}

function walk(cols, rows, r) {
  let c = Math.floor(r() * cols), row = 0, dir = r() < 0.5 ? -1 : 1;
  const path = [{ c, r: 0 }];
  for (;;) {
    const sideways = r() < 0.65 && c + dir >= 0 && c + dir < cols;
    if (sideways) c += dir;
    else {
      if (row === rows - 1) return path; // going down from the bottom row: this cell holds the stairs
      row++; dir = r() < 0.5 ? -1 : 1;
    }
    path.push({ c, r: row });
  }
}

function dress(plan, path, cols, rows, r) {
  const cells = path.map((p, i) => ({ ...p, role: i === 0 ? 'entrance' : i === path.length - 1 ? 'exit' : 'path', need: new Set(), at: i }));
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    const side = b.r > a.r ? 'D' : b.c > a.c ? 'R' : 'L';
    a.need.add(side); b.need.add(OPPOSITE[side]);
  }
  const taken = new Set(cells.map((x) => `${x.c},${x.r}`));
  const wanted = randInt(r, plan.sides[0], plan.sides[1]);
  for (let n = 0, guard = 0; n < wanted && guard < 100; guard++) {
    const host = cells[1 + Math.floor(r() * (cells.length - 2))];
    if (!host || host.role !== 'path') continue;
    const side = r() < 0.5 ? 'L' : 'R', c = host.c + (side === 'R' ? 1 : -1);
    if (c < 0 || c >= cols || taken.has(`${c},${host.r}`)) continue;
    taken.add(`${c},${host.r}`);
    host.need.add(side);
    cells.push({ c, r: host.r, role: 'side', need: new Set([OPPOSITE[side]]), at: host.at });
    n++;
  }
  const last = path.length - 1, curve = plan.pacing;
  for (const cell of cells) {
    cell.budget = cell.role === 'entrance' ? 0 : cell.role === 'side' ? plan.sideBudget
      : curve[Math.round((cell.at / last) * (curve.length - 1))];
  }
  return { cols, rows, cells };
}
