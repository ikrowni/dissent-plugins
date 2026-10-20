// node tests/sweep.mjs [seeds=200] — build many Cellars levels: failures, re-rolls, time, which chunks get re-rolled.
import { buildLevel } from '../ul-level.js';
import { CELLARS } from '../biomes/cellars.js';
const n = Number(process.argv[2] ?? 200), tries = {}, fails = [], used = {};
const t0 = performance.now();
for (let s = 1; s <= n; s++) {
  try { const L = buildLevel(CELLARS, s); tries[L.tries] = (tries[L.tries] ?? 0) + 1; for (const id of L.picks) used[id] = (used[id] ?? 0) + 1; }
  catch (e) { fails.push(`seed ${s}: ${e.message.split('\n')[0]}`); }
}
console.log(`${n} seeds, ${((performance.now() - t0) / n).toFixed(0)} ms a level; tries ${JSON.stringify(tries)}; ${fails.length} failed`);
fails.slice(0, 5).forEach((f) => console.log(' ', f));
const never = CELLARS.chunks.filter((k) => k.role !== 'lamppost' && !used[k.id]).map((k) => k.id);
console.log('never used:', never.join(', ') || 'none');
