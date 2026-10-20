// node tests/check-chunks.mjs [id…] — every chunk's errors and routes, for writing chunks.
import { CELLARS } from '../biomes/cellars.js';
import { chunkErrors, openings } from '../ul-chunk.js';
import { route, routesFor } from './route.js';
const only = process.argv.slice(2);
let bad = 0;
for (const k of CELLARS.chunks) {
  if (only.length && !only.includes(k.id)) continue;
  const errs = chunkErrors(k);
  if (errs.length) { bad++; console.log('✗', errs.join('; ')); continue; }
  const fails = [];
  for (const [from, to] of routesFor(k, openings(k.rows))) for (const stars of k.rows.join('').includes('*') ? ['#', ' '] : [' ']) {
    const res = route(k, from, to, stars);
    if (!res.exitOk || res.trapped.length || res.missing.length) fails.push(`${from}→${to}${stars === '#' ? ' (stars stone)' : ''}: ${res.exitOk ? '' : 'no way through; '}${res.trapped.length ? res.trapped.length + ' trapped; ' : ''}${res.missing.map((m) => m.what + ' r' + Math.floor((m.y % 432) / 24) + ' c' + Math.floor((m.x % 768) / 24)).join(', ')}`);
  }
  if (fails.length) { bad++; console.log('✗', k.id, '|', fails.join(' | ')); } else console.log('✓', k.id);
}
console.log(bad ? `${bad} chunk(s) to fix` : 'all chunks pass');
