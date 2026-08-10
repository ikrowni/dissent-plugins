// core/league/recap.js — what actually happened last week.
//
// PURE, and computed from data the league already stores: the schedule and the
// scored weeks. No fetch, no new state, nothing to keep in sync.
//
// ⚠️ A SEASON WITHOUT A STORY IS A SPREADSHEET. Standings say who is winning;
// they never say that somebody put up the highest score of the year and still
// lost by two, which is the part people actually talk about. Every established
// fantasy platform ships this and it is the cheapest personality a league can
// have.

/**
 * One week's story.
 *
 * `matchups` is [{ home, away, bye }] from the stored schedule; `scores` is the
 * stored `{ teams: { [teamId]: { total } } }` record for that week.
 *
 * Returns null when the week cannot be described — no schedule, no scores, or
 * every game a bye. ⚠️ A recap of nothing must be ABSENT, not empty: a panel
 * headed "Week 4" with blank rows reads as broken.
 */
export function weekRecap(week, matchups = [], scores = null) {
  const totalOf = (t) => scores?.teams?.[String(t)]?.total;
  const games = [];

  for (const m of matchups) {
    if (m?.bye || !m?.away) continue;
    const home = totalOf(m.home);
    const away = totalOf(m.away);
    // ⚠️ A half-scored game is not a result. Including it would let an
    // unplayed opponent count as a 0 and manufacture a record blowout.
    if (typeof home !== 'number' || typeof away !== 'number') continue;
    games.push({
      home: String(m.home),
      away: String(m.away),
      homePoints: home,
      awayPoints: away,
      margin: Math.abs(home - away),
      combined: home + away,
      winner: home === away ? null : (home > away ? String(m.home) : String(m.away)),
      loser: home === away ? null : (home > away ? String(m.away) : String(m.home)),
    });
  }

  if (games.length === 0) return null;

  const teamScores = games.flatMap((g) => [
    { teamId: g.home, points: g.homePoints, won: g.winner === g.home },
    { teamId: g.away, points: g.awayPoints, won: g.winner === g.away },
  ]);

  const best = teamScores.reduce((a, b) => (b.points > a.points ? b : a));
  const worst = teamScores.reduce((a, b) => (b.points < a.points ? b : a));
  const blowout = games.reduce((a, b) => (b.margin > a.margin ? b : a));
  const nailBiter = games.reduce((a, b) => (b.margin < a.margin ? b : a));
  const shootout = games.reduce((a, b) => (b.combined > a.combined ? b : a));

  // ⚠️ THE ONE EVERYBODY REMEMBERS: the highest score of the week that still
  // lost. It only exists some weeks, and forcing a value would be a lie.
  const unlucky = teamScores
    .filter((t) => !t.won)
    .reduce((a, b) => (a === null || b.points > a.points ? b : a), null);
  const luckiest = teamScores
    .filter((t) => t.won)
    .reduce((a, b) => (a === null || b.points < a.points ? b : a), null);

  return {
    week,
    games: games.length,
    best,
    worst,
    blowout,
    nailBiter,
    shootout,
    // Only interesting when the unlucky loser actually outscored a winner.
    unlucky: unlucky && luckiest && unlucky.points > luckiest.points ? unlucky : null,
    luckiest: unlucky && luckiest && unlucky.points > luckiest.points ? luckiest : null,
  };
}

/**
 * The most recent week that can be described.
 *
 * ⚠️ Walks BACKWARDS from the current week and stops at the first week with
 * results. A league whose latest week has not been scored still has a story to
 * tell from the one before, and showing nothing there would make the panel
 * disappear for most of every week.
 */
export function latestRecap(currentWeek, scheduleWeeks = [], scoresFor = () => null) {
  const start = Number(currentWeek);
  if (!Number.isInteger(start) || start < 1) return null;
  for (let week = start; week >= 1; week -= 1) {
    const entry = scheduleWeeks.find((w) => Number(w.week) === week);
    if (!entry) continue;
    const recap = weekRecap(week, entry.matchups ?? [], scoresFor(week));
    if (recap) return recap;
  }
  return null;
}
