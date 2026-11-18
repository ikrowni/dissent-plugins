// core/power.js — all-play records, luck, and power rankings.
//
// Head-to-head record is a noisy signal in a 12-team league: a team can go 8-5 by drawing
// the weakest opponent every week. ALL-PLAY asks the schedule-free question — if everyone
// played everyone every week, what would the record be? LUCK is the gap between the two.
//
// Pure functions over already-parsed rosters and matchups. No fetching, no DOM.

/**
 * Collapse per-week matchup arrays into { week, scores: { rosterId: points } }.
 *
 * A week where every score is 0 has not been played yet — Sleeper returns the full
 * pairings for future weeks with zeroed points, and counting those would hand every team
 * a tie against the field for the rest of the season.
 */
export function weeklyScores(weeks) {
  const out = [];
  for (const w of weeks ?? []) {
    const scores = {};
    let any = false;
    for (const m of w?.matchups ?? []) {
      if (m?.rosterId == null) continue;
      const pts = Number(m.points ?? 0);
      scores[m.rosterId] = pts;
      if (pts > 0) any = true;
    }
    if (any) out.push({ week: w.week, scores });
  }
  return out;
}

/** Record against the whole field each week, summed. Returns { rosterId: {w,l,t} }. */
export function allPlayRecords(scored) {
  const recs = {};
  const bump = (id, k) => {
    recs[id] ??= { wins: 0, losses: 0, ties: 0 };
    recs[id][k] += 1;
  };

  for (const { scores } of scored ?? []) {
    const ids = Object.keys(scores);
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        if (scores[a] > scores[b]) bump(a, 'wins');
        else if (scores[a] < scores[b]) bump(a, 'losses');
        else bump(a, 'ties');
      }
    }
  }
  return recs;
}

const pct = (r) => {
  const games = r.wins + r.losses + r.ties;
  return games ? (r.wins + r.ties * 0.5) / games : 0;
};

/**
 * Rank rosters by all-play win percentage, tie-broken by points for.
 *
 * Deliberately NOT a weighted composite of five metrics. A composite is impossible to
 * argue with in a league chat, and every weight would be invented rather than measured.
 * All-play is one defensible number; luck and efficiency are shown ALONGSIDE it so the
 * reader draws their own conclusion.
 */
export function powerRankings(rosters, scored) {
  const recs = allPlayRecords(scored);
  const weeksPlayed = (scored ?? []).length;

  const rows = (rosters ?? []).map((r) => {
    const ap = recs[r.rosterId] ?? { wins: 0, losses: 0, ties: 0 };
    const opponents = Math.max(0, (rosters?.length ?? 1) - 1);
    // A team's all-play win pct scaled back to the games it actually played.
    const expectedWins = weeksPlayed && opponents ? pct(ap) * weeksPlayed : 0;
    return {
      rosterId: r.rosterId,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
      ties: r.ties ?? 0,
      pointsFor: r.pointsFor ?? 0,
      pointsAgainst: r.pointsAgainst ?? 0,
      potentialPoints: r.potentialPoints ?? 0,
      allPlay: ap,
      allPlayPct: pct(ap),
      expectedWins,
      luck: (r.wins ?? 0) - expectedWins,
      efficiency: r.potentialPoints > 0 ? (r.pointsFor ?? 0) / r.potentialPoints : 0,
    };
  });

  rows.sort((a, b) => (b.allPlayPct - a.allPlayPct) || (b.pointsFor - a.pointsFor));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
