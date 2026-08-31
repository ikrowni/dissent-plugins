#!/usr/bin/env node
/**
 * build-draft-ranking — the draft board's ordering, for the season being drafted.
 *
 * ⚠️ THE RANKING IS AN ASSET, NOT A RUNTIME FETCH. Sleeper's projections payload
 * is **2.6 MB**, which is over the node's fetch-proxy ceiling and far too much to
 * pull into a browser to sort a list. This reduces it to a few hundred ids per
 * scoring type — a file small enough to ship beside the player index and load
 * instantly, and one that makes a mock draft deterministic instead of dependent
 * on a third party being up.
 *
 * ⚠️ IT USED TO RANK LAST SEASON'S ACTUAL POINTS, AND THAT WAS THE BUG. A
 * backward-looking board cannot contain a rookie at all — Ashton Jeanty and
 * Omarion Hampton were simply absent — and it ranks players on a depth chart
 * that has since changed. Reported 2026-08-31 as "the rankings are incorrect",
 * and they were: correct for 2025, and 2025 is not what anyone is drafting.
 *
 * ⚠️ ADP IS THE ORDER, NOT PROJECTED POINTS. `pts_ppr` alone reproduces exactly
 * the failure the old raw-points ranking had: quarterbacks outscore everyone, so
 * projected points put NINE OF THEM in the top fifteen. A draft board is a
 * market, and ADP is what that market actually does — it prices positional
 * scarcity without needing a replacement-level model to reconstruct it.
 *
 * ⚠️ ADP 999 IS A SENTINEL, NOT A RANK. Sleeper writes 999 for a player the
 * market has not priced. Sorting it numerically buries them behind pick 998 in
 * ADP order, which is accidentally almost right and completely unprincipled —
 * so they are separated out and ordered among themselves by projected value.
 *
 * Regenerate before a draft season:
 *   node scripts/build-draft-ranking.mjs 2026
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const season = process.argv[2] ?? String(new Date().getUTCFullYear());

// Only positions a fantasy roster can start. Ranking a linebacker into the top
// 100 would be worse than leaving them out.
const FANTASY = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
// Deep enough for a 12-team, 16-round draft (192 picks) with real margin.
const DEPTH = 400;
// Sleeper's "the market has not priced this player" value.
const ADP_UNRANKED = 999;

/**
 * ⚠️ VALUE OVER REPLACEMENT, NEVER RAW POINTS — for the VALUES, now that ADP
 * carries the order.
 *
 * These are what the mock draft grades against, and grading against raw points
 * would hand the win to whoever drafted the most quarterbacks. What matters is
 * not what a player scores, it is how much more they score than the player you
 * could have had instead at the same position.
 *
 * The baseline is the last starter a 12-team league would roster at each
 * position: 12 quarterbacks, 24 running backs (two starters each), 36 receivers,
 * 12 tight ends.
 */
const REPLACEMENT_RANK = { QB: 12, RB: 24, WR: 36, TE: 12, K: 12, DEF: 12 };

const SCORING = [
  ['ppr', 'pts_ppr', 'adp_ppr'],
  ['half', 'pts_half_ppr', 'adp_half_ppr'],
  ['std', 'pts_std', 'adp_std'],
];

const proj = await (await fetch(`https://api.sleeper.app/v1/projections/nfl/regular/${season}`)).json();
const index = JSON.parse(
  await (await fetch('https://plugins.dissent.chat/plugins/nfl-hub/assets/players.index.json')).text(),
);

const positionOf = (id) => String(index[id]?.p ?? '').toUpperCase();

const out = {
  season: Number(season),
  generated: new Date().toISOString().slice(0, 10),
  // ⚠️ Recorded IN the asset so a stale one is diagnosable from the file rather
  // than from whoever remembers how it was built. The old asset carried a
  // `season` of 2025 and nothing saying that meant "ranked on 2025 results"
  // rather than "for the 2025 draft" — the ambiguity that let it ship into 2026.
  basis: 'sleeper adp + season projection',
};

for (const [key, ptsField, adpField] of SCORING) {
  const rows = [];
  for (const [id, s] of Object.entries(proj)) {
    const pts = s?.[ptsField];
    if (typeof pts !== 'number' || pts <= 0) continue;
    // ⚠️ Skip anyone the index does not know: the board renders from the index,
    // so a ranked id with no record would draw a nameless row.
    if (!index[id] || !FANTASY.has(positionOf(id))) continue;
    const rawAdp = s?.[adpField];
    const adp = typeof rawAdp === 'number' && rawAdp > 0 && rawAdp < ADP_UNRANKED ? rawAdp : null;
    rows.push({ id, pts, adp });
  }

  // Replacement level per position, from that position's own projected points.
  const byPos = {};
  for (const r of rows) (byPos[positionOf(r.id)] ??= []).push(r.pts);
  const baseline = {};
  for (const [pos, pts] of Object.entries(byPos)) {
    pts.sort((a, b) => b - a);
    const n = REPLACEMENT_RANK[pos] ?? 12;
    // Short of a full baseline, the last real player is the best answer there is.
    baseline[pos] = pts[Math.min(n, pts.length) - 1] ?? 0;
  }
  for (const r of rows) r.vor = r.pts - (baseline[positionOf(r.id)] ?? 0);

  // Priced players in market order; everyone else after them, best value first.
  const priced = rows.filter((r) => r.adp !== null).sort((a, b) => a.adp - b.adp);
  const unpriced = rows.filter((r) => r.adp === null).sort((a, b) => b.vor - a.vor);
  const kept = [...priced, ...unpriced].slice(0, DEPTH);

  out[key] = kept.map((r) => r.id);
  // ⚠️ The VALUES ship too, so a draft grade can be an honest sum rather than a
  // number invented from ranking position. Rounded to whole points: the asset is
  // downloaded by every browser that opens a mock, and two decimal places of
  // projected fantasy points is precision the projection does not have.
  out[`${key}_v`] = Object.fromEntries(kept.map((r) => [r.id, Math.round(r.vor)]));

  const top = kept.slice(0, 12).map((r) => positionOf(r.id));
  console.log(`  ${key.padEnd(4)} ${kept.length} players (${priced.length} priced) · round 1: ${top.join(' ')}`);
}

const path = join(HERE, '..', 'assets', 'draft-ranking.json');
writeFileSync(path, `${JSON.stringify(out)}\n`);
console.log(`\nwrote ${path}`);
