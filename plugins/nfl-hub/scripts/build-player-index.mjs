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
import { TEAMS, normalizeAbbr } from '../core/config.js';

const SRC = 'https://api.sleeper.app/v1/players/nfl';
const ESPN_ROSTER = (slug) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${slug}/roster`;
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

// ── Fill the gaps from ESPN's own rosters ───────────────────────────────────
//
// ⚠️ SLEEPER IS THE BOTTLENECK, NOT US. It carries an espn_id for only ~23% of
// active players — Ja'Marr Chase's is null at the source — and without one there
// is no headshot to build a URL for. ESPN publishes the same players on its own
// team rosters WITH ids, so the missing side can be filled from there.
//
// ⚠️ AT BUILD TIME, NEVER AT RUNTIME. 32 requests once, when this is regenerated;
// a browser doing that per session would be far worse than the missing portraits.
await enrichFromEspn(index);

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

/**
 * Normalise a name for matching.
 *
 * ⚠️ APPLIED TO BOTH SIDES IDENTICALLY, which is what makes it safe. Stripping
 * suffixes and punctuation would be reckless as a display transform; as a join
 * key it just has to be consistent.
 */
function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function enrichFromEspn(index) {
  const slugs = [...new Set(Object.keys(TEAMS).map((a) => normalizeAbbr(a).toLowerCase()))];
  console.log(`filling missing espn ids from ${slugs.length} ESPN rosters…`);

  // team -> normalised name -> Set of espn ids
  const byTeam = new Map();
  let teamsOk = 0;

  for (const slug of slugs) {
    try {
      const r = await fetch(ESPN_ROSTER(slug));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const athletes = (data.athletes ?? []).flatMap((g) => g.items ?? []);
      const map = new Map();
      for (const a of athletes) {
        const key = norm(a.fullName ?? a.displayName);
        if (!key || !a.id) continue;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(Number(a.id));
      }
      byTeam.set(slug.toUpperCase(), map);
      teamsOk += 1;
    } catch (err) {
      // ⚠️ One unreachable team must not fail the build. The index is still
      // valid without it — just less complete — and a hard failure here would
      // block a player-data refresh over a portrait.
      console.warn(`  warn: ${slug} roster unavailable (${err.message})`);
    }
  }

  if (teamsOk === 0) {
    console.warn('  warn: no ESPN rosters reachable — keeping Sleeper ids only');
    return;
  }

  // Sleeper-side collisions matter too: two players with one normalised name on
  // one team cannot be told apart from either direction.
  const sleeperNames = new Map();
  for (const p of Object.values(index)) {
    if (!p.t) continue;
    const k = `${normalizeAbbr(p.t)}|${norm(p.n)}`;
    sleeperNames.set(k, (sleeperNames.get(k) ?? 0) + 1);
  }

  let filled = 0; let ambiguous = 0; let unmatched = 0;
  for (const p of Object.values(index)) {
    if (p.e !== null || !p.t) continue;
    const team = normalizeAbbr(p.t);
    const key = norm(p.n);
    const candidates = byTeam.get(team)?.get(key);

    // ⚠️ EXACTLY ONE ON EACH SIDE, or leave it as a monogram. Putting the wrong
    // player's face beside a name is worse than showing no face — and this is a
    // real hazard, not a theoretical one: searching Cincinnati for "Chase"
    // returns both Chase Brown and Ja'Marr Chase.
    if (!candidates || candidates.size === 0) { unmatched += 1; continue; }
    if (candidates.size > 1 || sleeperNames.get(`${team}|${key}`) > 1) { ambiguous += 1; continue; }

    p.e = [...candidates][0];
    filled += 1;
  }

  console.log(`  filled ${filled} · ambiguous ${ambiguous} (left as monograms) · no ESPN match ${unmatched}`);
}
