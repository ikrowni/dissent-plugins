// core/league/awards.js — the weekly report's shaming.
//
// PURE, and computed from what the league already stores: rosters, lineups and
// the scored week. No fetch, no new state.
//
// ⚠️ THIS IS THE PART PEOPLE SCREENSHOT. `recap.js` tells the team-level story —
// blowouts, the closest game, the high score. It cannot tell you that somebody
// left a 26-point receiver on their bench, which is the thing a league actually
// argues about on Monday. Sleeper builds an award per position and titles it
// "WR BENCHWARMER OF THE WEEK 👀"; the structure below is that, minus the emoji,
// which belongs to the view.

/**
 * The highest-scoring BENCHED player at each position, for one team.
 *
 * `players` is the whole roster, `lineup` is the positional starter array — so
 * the bench is the difference, which is the only definition that stays correct
 * when a manager leaves a slot empty.
 *
 * ⚠️ A STARTED PLAYER IS NEVER A BENCHWARMER, however well he did. The award is
 * about the decision, not the performance.
 *
 * ⚠️ SCORELESS BENCH PLAYERS ARE DROPPED. "Your best benched kicker scored 0"
 * is not an award, it is a row of noise on a screen whose whole job is to be
 * worth reading.
 */
export function bestBenchByPosition({
  players = [], lineup = [], pointsOf = () => 0, positionOf = () => null,
} = {}) {
  const started = new Set((lineup ?? []).filter(Boolean).map(String));
  const best = {};

  for (const raw of players ?? []) {
    const id = String(raw);
    if (started.has(id)) continue;

    const position = positionOf(id);
    if (!position) continue;

    const points = Number(pointsOf(id)) || 0;
    if (points <= 0) continue;

    const held = best[position];
    // ⚠️ Ties break on the id so the same week always produces the same award.
    // Left to insertion order, a roster reordered by an unrelated trade would
    // silently hand the award to a different player.
    if (!held || points > held.points || (points === held.points && id < held.playerId)) {
      best[position] = { playerId: id, points };
    }
  }
  return best;
}

/**
 * One award per position: the league's single worst benching that week.
 *
 * `teams` is `{ [teamId]: { players, lineup } }`. Returns
 * `{ position, teamId, playerId, points }[]` **sorted by points descending** —
 * the biggest embarrassment leads, because that is the one people read.
 *
 * ⚠️ EXACTLY ONE TEAM PER POSITION. Awarding every team's best bench would turn
 * a highlight into a table nobody reads.
 */
export function benchwarmerAwards({
  teams = {}, pointsOf = () => 0, positionOf = () => null,
} = {}) {
  const winners = {};

  for (const [teamId, team] of Object.entries(teams ?? {})) {
    const perPosition = bestBenchByPosition({
      players: team?.players ?? [],
      lineup: team?.lineup ?? [],
      pointsOf,
      positionOf,
    });

    for (const [position, entry] of Object.entries(perPosition)) {
      const held = winners[position];
      if (!held
        || entry.points > held.points
        || (entry.points === held.points && String(teamId) < held.teamId)) {
        winners[position] = { position, teamId: String(teamId), ...entry };
      }
    }
  }

  return Object.values(winners).sort(
    (a, b) => b.points - a.points || a.position.localeCompare(b.position),
  );
}
