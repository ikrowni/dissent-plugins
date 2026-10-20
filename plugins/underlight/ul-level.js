// ul-level.js — one level from a biome and a seed (spec §6): lay out the cells, pick a chunk for each whose openings
// cover what the path needs, seal the openings nobody needs, fill the slots (enemies from each cell's budget, maybe
// sconces, maybe stone), stitch the chunks into one continuous map, and prove it can be finished. A level that fails
// the solver is re-rolled from the same random source, so one seed is still one level.
import { CW, CH, SIDES, openings, seal } from './ul-chunk.js';
import { makeLayout } from './ul-layout.js';
import { parseRoom } from './ul-room.js';
import { solve } from './ul-solver.js';
import { rng } from './ul-rng.js';
import { DEFAULT_TUNE } from './ul-const.js';

export const MAX_TRIES = 12;
/** What each enemy costs from a cell's budget. */
export const COST = { h: 2, m: 2, n: 3, r: 3, b: 3, l: 3 };
/** Who fills a biome's slots: per slot type, the enemies with a cost, a weight, and at most `max` in one chunk.
 *  A biome without its own list gets this one (the 1b mix: Shades, one Snuffer, Moths). */
export const DEFAULT_FOES = {
  ground: [{ ch: 'h', w: 1.9 }, { ch: 'n', w: 1, max: 1 }],
  air: [{ ch: 'm', w: 1 }],
};

/** A chunk for this cell: its role's pool, openings covering the need, not used already in this level if avoidable. */
export function pickChunk(biome, cell, used, r) {
  const pool = biome.chunks.filter((k) => k.role === cell.role && [...cell.need].every((s) => openings(k.rows).has(s)));
  if (!pool.length) throw new Error(`${biome.name}: no ${cell.role} chunk opens ${[...cell.need].sort().join('')}`);
  const fresh = pool.filter((k) => !used.has(k.id));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(r() * from.length)];
}

/** Slots → tiles and spawns: '*' maybe stone, '?' maybe a sconce, g/a enemies bought from the budget (foes: who). */
export function fill(rows, budget, r, foes = DEFAULT_FOES) {
  const g = rows.map((row) => [...row]), slots = [];
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const ch = g[y][x];
    if (ch === '*') g[y][x] = r() < 0.5 ? '#' : ' ';
    else if (ch === '?') g[y][x] = r() < 0.5 ? 'S' : ' ';
    else if (ch === 'g' || ch === 'a') { slots.push([y, x, ch]); g[y][x] = ' '; }
  }
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  let left = budget;
  const placed = {};
  for (const [y, x, kind] of slots) {
    const can = foes[kind === 'a' ? 'air' : 'ground'].filter((f) => COST[f.ch] <= left && (placed[f.ch] ?? 0) < (f.max ?? Infinity));
    if (!can.length) continue;
    let pick = r() * can.reduce((a, f) => a + f.w, 0), f = can[0];
    for (const c of can) { pick -= c.w; if (pick <= 0) { f = c; break; } }
    g[y][x] = f.ch; left -= COST[f.ch]; placed[f.ch] = (placed[f.ch] ?? 0) + 1;
  }
  return g.map((row) => row.join(''));
}

/** The whole level's rows: each cell's chunk in place, stone where no cell is. */
export function stitch(layout, placed) {
  const out = Array.from({ length: layout.rows * CH }, () => Array(layout.cols * CW).fill('#'));
  for (const { cell, rows } of placed) for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) out[cell.r * CH + y][cell.c * CW + x] = rows[y][x];
  return out.map((row) => row.join(''));
}

/** What the solver must reach in a room: the stairs, every sconce, every oil cache. */
export function targetsOf(room) {
  const at = (ch) => room.spawns.filter((s) => s.ch === ch).map((s) => ({ x: s.x, y: s.y }));
  return { exit: at('X')[0], sconces: at('S'), caches: at('o') };
}

/**
 * biome: { name, plan, chunks: [{ id, role, rows }] }. Returns { rows, layout, picks: [ids], tries }.
 * Throws if MAX_TRIES levels in a row fail (a biome bug: the tests run hundreds of seeds to keep that from happening).
 */
export function buildLevel(biome, seed, tune = DEFAULT_TUNE) {
  const r = rng(seed);
  const problems = [];
  for (let tries = 1; tries <= MAX_TRIES; tries++) {
    const layout = makeLayout(biome.plan, r), used = new Set(), placed = [];
    for (const cell of layout.cells) {
      const chunk = pickChunk(biome, cell, used, r);
      used.add(chunk.id);
      const shut = SIDES.filter((s) => !cell.need.has(s));
      placed.push({ cell, id: chunk.id, rows: fill(seal(chunk.rows, shut), cell.budget, r, biome.foes) });
    }
    const rows = stitch(layout, placed), room = parseRoom(rows);
    const res = solve(room, tune, room.spawns.find((s) => s.ch === 'P'), targetsOf(room));
    if (res.exitOk && !res.trapped.length && !res.missing.length) return { rows, layout, picks: placed.map((p) => p.id), tries };
    problems.push(`${placed.map((p) => p.id).join(' ')}: ${res.exitOk ? '' : 'no way to the stairs; '}${res.trapped.length} trapped spots; ${res.missing.length} unreachable`);
  }
  throw new Error(`${biome.name} seed ${seed}: ${MAX_TRIES} levels failed the solver:\n${problems.join('\n')}`);
}
