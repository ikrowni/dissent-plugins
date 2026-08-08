#!/usr/bin/env node
// scripts/build-player-index.mjs — regenerates assets/players.index.json.
//
// Run from the plugin directory:  node scripts/build-player-index.mjs
//
// Sleeper's /v1/players/nfl is ~14.3 MB. fetch:external caps responses at 1 MB, so the
// hub can never load it at runtime. This trims it to the four fields the hub actually
// joins on and commits the result as a static asset served from the plugin's own
// origin (no proxy, no cap).
//
// espn_id is the important one: without it, a Sleeper roster and ESPN's live game data
// cannot be joined at all, which is what makes "your receiver is on the field right
// now" possible.
import { writeFile } from 'node:fs/promises';

const SRC = 'https://api.sleeper.app/v1/players/nfl';
const OUT = new URL('../assets/players.index.json', import.meta.url);
const KEEP = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB']);

console.log('fetching Sleeper player database (~14 MB)…');
const res = await fetch(SRC);
if (!res.ok) {
  console.error(`FAIL: HTTP ${res.status}`);
  process.exit(1);
}
const all = await res.json();

const index = {};
let skipped = 0;
for (const [id, p] of Object.entries(all)) {
  const pos = p.position ?? p.fantasy_positions?.[0] ?? null;
  if (!pos || !KEEP.has(pos)) { skipped += 1; continue; }
  // Retired players with no team are dead weight; keep inactive players who are still
  // rostered somewhere, because a Sleeper roster can legitimately reference them.
  if (p.active === false && !p.team) { skipped += 1; continue; }
  index[id] = {
    n: p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? 'Unknown',
    p: pos,
    t: p.team ?? null,
    e: p.espn_id ? Number(p.espn_id) : null,
  };
}

// Single-letter keys deliberately: this file ships to every viewer, and n/p/t/e versus
// name/position/team/espn_id is a meaningful size difference across thousands of records.
const json = JSON.stringify(index);
await writeFile(OUT, json);

const withEspn = Object.values(index).filter((p) => p.e !== null).length;
const total = Object.keys(index).length;
console.log(`wrote ${total} players (${skipped} skipped), ` +
            `${withEspn} with an espn_id (${Math.round((withEspn / total) * 100)}%), ` +
            `${Math.round(json.length / 1024)} KiB`);
if (total < 1000) {
  console.error('FAIL: implausibly small index');
  process.exit(1);
}
