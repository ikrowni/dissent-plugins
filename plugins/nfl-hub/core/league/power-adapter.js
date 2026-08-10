// core/league/power-adapter.js — native league data in the shape core/power.js wants.
//
// ⚠️ AN ADAPTER, NOT A SECOND IMPLEMENTATION. `core/power.js` already computes
// all-play records, luck and rankings, and it is already tested; it was written
// for the Sleeper mirror's shapes. Reimplementing that maths for the native
// league would give the league two answers to "who is actually best", which is
// precisely the argument a power ranking exists to settle.
//
// PURE. Takes the standings the module already computes and the stored week
// scores, and returns what powerRankings expects.

/**
 * Week scores → `[{ week, scores: { teamId: points } }]`.
 *
 * ⚠️ A WEEK WITH NO RECORD IS SKIPPED, not zero-filled. Handing power.js a week
 * of zeroes would give every team a tie against the whole field for that week
 * and drag all-play percentages toward .500 — quietly wrong, and worse the
 * earlier in a season you look.
 */
export function toScoredWeeks(weekScores = {}) {
  const out = [];
  for (const [week, record] of Object.entries(weekScores)) {
    const teams = record?.teams;
    if (!teams) continue;
    const scores = {};
    let any = false;
    for (const [teamId, row] of Object.entries(teams)) {
      const total = Number(row?.total);
      if (!Number.isFinite(total)) continue;
      scores[String(teamId)] = total;
      if (total !== 0) any = true;
    }
    // Every score zero means the week exists but was never played.
    if (!any || Object.keys(scores).length === 0) continue;
    out.push({ week: Number(week), scores });
  }
  return out.sort((a, b) => a.week - b.week);
}

/**
 * Standings rows → the roster shape powerRankings reads.
 *
 * ⚠️ `potentialPoints` IS DELIBERATELY ZERO. Sleeper supplies a best-possible
 * lineup; the native league does not compute one, and it cannot be derived from
 * a stored week — the score record holds only the STARTERS' points, so the bench
 * scores needed to know what the best lineup would have been are simply absent.
 * Zero makes powerRankings report efficiency 0, so the UI must not show that
 * column rather than print a confident nonsense number.
 */
export function toRosters(standings = []) {
  return standings.map((r) => ({
    rosterId: String(r.teamId),
    wins: r.wins ?? 0,
    losses: r.losses ?? 0,
    ties: r.ties ?? 0,
    pointsFor: r.pointsFor ?? 0,
    pointsAgainst: r.pointsAgainst ?? 0,
    potentialPoints: 0,
  }));
}

/** True when there is enough played football for a ranking to mean anything. */
export function hasEnoughForPower(scoredWeeks, minWeeks = 2) {
  return Array.isArray(scoredWeeks) && scoredWeeks.length >= minWeeks;
}
