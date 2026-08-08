// core/opponent-strength.js — how tough this week's opponent defense is.
//
// ⚠️ This is TEAM-LEVEL, not per-position, and the UI must say "Opponent strength" rather
// than "difficulty". Spec §4.4 asked for a per-position defensive ranking; measurement on
// 2026-08-08 established there is NO such source on any allowlisted host:
//
//   - ESPN's team stats carry what a defense EARNS (sacks, tackles, INTs), never what it
//     ALLOWS by position, and a league-wide ranking would cost 32 fetches (~2.5 MB).
//   - site.web.api.espn.com/.../statistics/byteam is DEAD: HTTP 200, 369 KB, and every
//     stats array empty across three season/seasontype combinations.
//
// `pointsAgainst` in the standings payload the hub ALREADY fetches is the honest signal
// available for zero extra requests. It cannot tell a WR owner that a strong run defense
// is an easy matchup, which is exactly why it is not called difficulty.
import { normalizeAbbr } from './config.js';

/** Walk the nested standings tree and yield every team entry. */
function* entriesOf(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.standings?.entries)) yield* node.standings.entries;
  for (const child of node.children ?? []) yield* entriesOf(child);
}

export function strengthFromStandings(json) {
  const rows = [];
  for (const e of entriesOf(json)) {
    const abbr = normalizeAbbr(e?.team?.abbreviation);
    const stat = (e?.stats ?? []).find((s) => s.name === 'pointsAgainst');
    if (!abbr || !stat) continue;
    rows.push({ abbr, pointsAgainst: Number(stat.value ?? 0) });
  }

  rows.sort((a, b) => a.pointsAgainst - b.pointsAgainst);
  const out = {};
  rows.forEach((r, i) => { out[r.abbr] = { rank: i + 1, pointsAgainst: r.pointsAgainst }; });
  return out;
}

/** Thirds of the league. Rank 1 allows the fewest points, so rank 1 is the toughest draw. */
export function tierOf(rank) {
  if (!rank) return null;
  if (rank <= 11) return 'tough';
  if (rank <= 22) return 'even';
  return 'soft';
}

export function opponentStrengthFor(row, nfl, table) {
  const abbr = normalizeAbbr(row?.teamAbbr);
  if (!abbr) return { opponentAbbr: null, rank: null, tier: null };

  if ((nfl?.byeTeams ?? []).includes(abbr)) {
    return { opponentAbbr: null, rank: null, tier: null, bye: true };
  }

  const opp = nfl?.games?.[abbr]?.opponentAbbr ?? null;
  if (!opp) return { opponentAbbr: null, rank: null, tier: null };

  const hit = table?.[normalizeAbbr(opp)];
  return {
    opponentAbbr: opp,
    rank: hit?.rank ?? null,
    tier: tierOf(hit?.rank ?? null),
  };
}
