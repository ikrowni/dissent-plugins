// services/sts2-stats/src/aggregate.mjs — contributions → the counts the plugin shows. Nightly.
//
// Publishes COUNTS, not rates: the plugin computes Wilson intervals the same way it does for personal
// insights. 🔴 Nothing is published below a minimum — a cell under MIN_RUNS runs, an encounter fought fewer
// than MIN_RUNS times, a build type under MIN_RUNS, a card offered fewer than MIN_OFFERS times — so a
// published number is never about a handful of identifiable players (community stats spec §6.4).
//
// Co-op runs count every player's deck and picks: pooled statistics do not need to know which player sent
// the run. They stay in their own cells.

import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { classifyDeck, buildTypeLabel } from '../../../plugins/sts2-companion/core/classify.js';
import { compareBuilds, bandOf } from '../../../plugins/sts2-companion/core/builds.js';

export { compareBuilds };

export const MIN_RUNS = 50;
export const MIN_OFFERS = 30;
export const STATS_SCHEMA = 1;

const BUCKETS = [[1, 10, '1–10'], [11, 20, '11–20'], [21, 30, '21–30'], [31, 40, '31–40'], [41, Infinity, '41+']];

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function newCell(character, band, mode) {
  return { character, band, mode, runs: 0, wins: 0, floors: BUCKETS.map(() => 0), encounters: new Map(), builds: new Map(), cards: new Map() };
}

export async function aggregate(contributions, data, { minRuns = MIN_RUNS, minOffers = MIN_OFFERS } = {}) {
  const builds = new Map();
  for (const c of contributions) {
    const b = builds.get(c.build) ?? { runs: 0, cells: new Map() };
    b.runs += 1;
    builds.set(c.build, b);
    const mode = c.players.length === 1 ? 'solo' : 'coop';
    const band = bandOf(c.ascension);
    const fought = new Set(c.players.flatMap((p) => p.floors.map((f) => f.encounter).filter(Boolean)));

    for (const character of new Set(c.players.map((p) => p.character))) {
      const key = `${character}|${band}|${mode}`;
      const cell = b.cells.get(key) ?? newCell(character, band, mode);
      b.cells.set(key, cell);
      cell.runs += 1;
      if (c.win) cell.wins += 1;
      const bi = BUCKETS.findIndex(([lo, hi]) => c.floors >= lo && c.floors <= hi);
      if (bi >= 0) cell.floors[bi] += 1;
      for (const id of fought) {
        const e = cell.encounters.get(id) ?? { id, fought: 0, deaths: 0 };
        e.fought += 1;
        if (c.killedBy === id) e.deaths += 1;
        cell.encounters.set(id, e);
      }
      for (const p of c.players.filter((x) => x.character === character)) {
        const label = buildTypeLabel((await classifyDeck(p.deck, p.character, data)).tags);
        const bt = cell.builds.get(label) ?? { label, runs: 0, wins: 0, floors: [] };
        bt.runs += 1; if (c.win) bt.wins += 1; bt.floors.push(c.floors);
        cell.builds.set(label, bt);
        for (const ch of p.choices) {
          const cd = cell.cards.get(ch.id) ?? { id: ch.id, offered: 0, picked: 0, pickedWins: 0, skippedWins: 0 };
          cd.offered += 1;
          if (ch.picked) { cd.picked += 1; if (c.win) cd.pickedWins += 1; } else if (c.win) cd.skippedWins += 1;
          cell.cards.set(ch.id, cd);
        }
      }
    }
  }

  const out = {};
  for (const [build, b] of builds) {
    out[build] = {
      runs: b.runs,
      cells: [...b.cells.values()].filter((cell) => cell.runs >= minRuns).map((cell) => ({
        character: cell.character, band: cell.band, mode: cell.mode, runs: cell.runs, wins: cell.wins,
        floorBuckets: BUCKETS.map(([, , label], i) => ({ label, n: cell.floors[i] })),
        encounters: [...cell.encounters.values()].filter((e) => e.fought >= minRuns).sort((x, y) => y.deaths - x.deaths || x.id.localeCompare(y.id)),
        buildTypes: [...cell.builds.values()].filter((t) => t.runs >= minRuns)
          .map((t) => ({ label: t.label, runs: t.runs, wins: t.wins, medianFloor: median(t.floors) }))
          .sort((x, y) => y.runs - x.runs || x.label.localeCompare(y.label)),
        cards: [...cell.cards.values()].filter((cd) => cd.offered >= minOffers).sort((x, y) => y.offered - x.offered || x.id.localeCompare(y.id)),
      })).sort((x, y) => `${x.character}|${x.band}|${x.mode}`.localeCompare(`${y.character}|${y.band}|${y.mode}`)),
    };
  }
  return { schema: STATS_SCHEMA, generatedAt: new Date().toISOString().slice(0, 10), minRuns, minOffers, builds: out };
}

function writeAtomic(path, text) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

/** Prune raw runs outside the newest `keepBuilds` builds, aggregate what remains, write the files. */
export async function publish({ db, data, outDir, keepBuilds = 3 }) {
  const all = db.prepare('SELECT DISTINCT build FROM runs').all().map((r) => r.build).sort(compareBuilds);
  const keep = all.slice(-keepBuilds);
  const drop = db.prepare('DELETE FROM runs WHERE build = ?');
  for (const build of all.filter((x) => !keep.includes(x))) drop.run(build);

  // One row at a time: the whole table in memory would outgrow the unit's MemoryMax long before disk.
  function* contributions() {
    for (const r of db.prepare('SELECT body FROM runs').iterate()) yield JSON.parse(r.body);
  }
  const stats = await aggregate(contributions(), data);
  for (const build of keep) {
    writeAtomic(join(outDir, `stats-${build}.json`), JSON.stringify({ ...stats, builds: { [build]: stats.builds[build] } }));
  }
  // latest.json is the NEWEST build only: every build in one file could pass net:direct's 5 MB response
  // cap at full size (cells × up to 400 cards). `builds` lists what else is published.
  const newest = keep.at(-1);
  writeAtomic(join(outDir, 'latest.json'), JSON.stringify({
    ...stats, available: keep, builds: newest ? { [newest]: stats.builds[newest] } : {},
  }));
  return stats;
}
