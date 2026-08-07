#!/usr/bin/env node
// scripts/fetch-logos.mjs — regenerates assets/logos/.
//
// Run from the plugin directory:  node scripts/fetch-logos.mjs
//
// Logos ship as committed assets rather than runtime fetches: there are exactly 32,
// they appear on every surface, and the node image proxy allows 120 req/min per IP.
// The 500-dark variant reads correctly on the hub's near-black background.
import { mkdir, writeFile } from 'node:fs/promises';
import { TEAMS } from '../core/config.js';

const OUT = new URL('../assets/logos/', import.meta.url);
const W = 160;

await mkdir(OUT, { recursive: true });

let ok = 0;
for (const abbr of Object.keys(TEAMS)) {
  const slug = abbr.toLowerCase();
  const src = `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500-dark/${slug}.png&w=${W}&h=${W}`;
  const res = await fetch(src);
  if (!res.ok) {
    console.error(`FAIL ${abbr}: HTTP ${res.status}`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) {
    console.error(`FAIL ${abbr}: suspiciously small (${buf.length}B)`);
    continue;
  }
  await writeFile(new URL(`${slug}.png`, OUT), buf);
  ok += 1;
}

console.log(`wrote ${ok}/32 logos`);
if (ok !== 32) process.exit(1);
