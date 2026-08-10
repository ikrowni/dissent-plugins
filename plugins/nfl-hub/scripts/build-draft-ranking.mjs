#!/usr/bin/env node
/**
 * build-draft-ranking — turn a finished season into a draft board ranking.
 *
 * ⚠️ THE RANKING IS AN ASSET, NOT A RUNTIME FETCH. Sleeper's season stats are
 * **1.88 MB**, which is over the node's fetch-proxy ceiling and far too much to
 * pull into a browser to sort a list. This reduces it to a few hundred ids per
 * scoring type — a file small enough to ship beside the player index and load
 * instantly, and one that makes a mock draft deterministic instead of dependent
 * on a third party being up.
 *
 * ⚠️ IT IS BACKWARD-LOOKING AND THE UI MUST SAY SO. Ranking by last season's
 * points knows nothing about rookies, injuries or a changed depth chart. That is
 * an honest, explainable basis for a mock draft; pretending it is a projection
 * would not be.
 *
 * Regenerate after a season ends:
 *   node scripts/build-draft-ranking.mjs 2025
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const season = process.argv[2] ?? '2025';

// Only positions a fantasy roster can start. Ranking a linebacker into the top
// 100 would be worse than leaving them out.
const FANTASY = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
// Deep enough for a 12-team, 16-round draft (192 picks) with real margin.
const DEPTH = 400;

const SCORING = [['ppr', 'pts_ppr'], ['half', 'pts_half_ppr'], ['std', 'pts_std']];

const stats = await (await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}`)).json();
const index = JSON.parse(
  await (await fetch('https://plugins.dissent.chat/plugins/nfl-hub/assets/players.index.json')).text(),
);

const out = { season: Number(season), generated: new Date().toISOString().slice(0, 10) };

for (const [key, field] of SCORING) {
  const rows = [];
  for (const [id, s] of Object.entries(stats)) {
    const pts = s?.[field];
    if (typeof pts !== 'number' || pts <= 0) continue;
    const p = index[id];
    // ⚠️ Skip anyone the index does not know: the board renders from the index,
    // so a ranked id with no record would draw a nameless row.
    if (!p || !FANTASY.has(String(p.p ?? '').toUpperCase())) continue;
    rows.push([id, pts]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  out[key] = rows.slice(0, DEPTH).map(([id]) => id);
  console.log(`  ${key.padEnd(4)} ${out[key].length} players`);
}

const path = join(HERE, '..', 'assets', 'draft-ranking.json');
writeFileSync(path, `${JSON.stringify(out)}\n`);
console.log(`\nwrote ${path}`);
