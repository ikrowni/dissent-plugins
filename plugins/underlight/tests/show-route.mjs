// node tests/show-route.mjs <id> <from> <to> — the chunk (middle cell) with what the solver reaches ('.'), traps ('!').
import { CELLARS } from '../biomes/cellars.js';
import { route } from './route.js';
const [id, from, to] = process.argv.slice(2);
const k = CELLARS.chunks.find((c) => c.id === id);
const res = route(k, from, to);
const g = k.rows.map((r) => [...r]);
const trapped = new Set(res.trapped);
for (const key of res.reach) {
  const [c, r] = res.cr(key);
  if (c >= 32 && c < 64 && r >= 18 && r < 36) g[r - 18][c - 32] = trapped.has(key) ? '!' : '.';
}
console.log(`${id} ${from}→${to}: exit ${res.exitOk}, ${res.trapped.length} trapped`);
console.log(g.map((r, i) => String(i).padStart(2) + ' ' + r.join('')).join('\n'));
