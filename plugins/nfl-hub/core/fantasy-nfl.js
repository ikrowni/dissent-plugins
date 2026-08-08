// core/fantasy-nfl.js — the join between a fantasy roster and live NFL.
//
// This is what separates the hub from Sleeper's own app: Sleeper shows "12.4 pts", the hub
// shows "Q3 4:20 · up 7". Pure functions over an already-parsed scoreboard.
import { TEAMS } from './config.js';

/**
 * Index this week's slate by team abbreviation, from each team's own point of view.
 *
 * Both sides of a game get an entry, each with ITS OWN margin — a shared margin would
 * read "up 7" next to a player whose team is losing by 7.
 *
 * Bye teams are derived by subtraction: any of the 32 not on the slate. That is more
 * reliable than a bye-week table, which goes stale every season.
 */
export function buildNflContext(games, injuries) {
  const out = { games: {}, byeTeams: [], injuries: {} };

  for (const g of games ?? []) {
    if (!g?.home || !g?.away) continue;
    const hs = Number(g.home.score ?? 0);
    const as = Number(g.away.score ?? 0);
    const common = {
      state: g.state, period: g.period ?? null, clock: g.clock ?? null,
      redZone: g.redZone === true, gameId: g.id,
    };
    out.games[g.home.abbr] = { ...common, margin: hs - as, opponentAbbr: g.away.abbr };
    out.games[g.away.abbr] = { ...common, margin: as - hs, opponentAbbr: g.home.abbr };
  }

  out.byeTeams = Object.keys(TEAMS).filter((abbr) => !out.games[abbr]);

  for (const i of injuries ?? []) {
    if (i?.sleeperId && i.status) out.injuries[String(i.sleeperId)] = i.status;
  }
  return out;
}

/** One short line of real-game context for a player, from their team's perspective. */
export function gameContext(row, nfl) {
  const abbr = row?.teamAbbr;
  if (!abbr || !nfl) return '—';

  if ((nfl.byeTeams ?? []).includes(abbr)) return 'BYE';

  const g = nfl.games?.[abbr];
  if (!g) return '—';

  const m = Number(g.margin ?? 0);
  const swing = m === 0 ? 'tied' : m > 0 ? `up ${m}` : `down ${Math.abs(m)}`;

  if (g.state === 'in') {
    const q = g.period > 4 ? 'OT' : `Q${g.period ?? 1}`;
    return `${q}${g.clock ? ` ${g.clock}` : ''} · ${swing}`;
  }
  if (g.state === 'post') return m > 0 ? 'Final · W' : m < 0 ? 'Final · L' : 'Final · T';
  return 'Scheduled';
}
