// core/league/schedule.js — the regular season and the playoff bracket.
//
// PURE. Generation is deterministic: the same teams and the same settings always
// produce the same schedule, so a commissioner regenerating it does not quietly
// reshuffle a season in progress.

/**
 * Round-robin schedule by the circle method.
 *
 * ⚠️ ODD TEAM COUNTS GET A BYE, and the bye must ROTATE. Pinning it to one team
 * would have the same manager sitting out every week. A dummy opponent is added
 * for odd counts and whoever draws it that week has the bye.
 *
 * ⚠️ THE FIRST TEAM IS THE PIVOT and must not rotate with the others, or the
 * "rotation" is a relabelling that produces the same pairings every week.
 */
export function generateRegularSeason(teamIds, weeks, { startWeek = 1 } = {}) {
  const teams = (teamIds ?? []).map(String);
  if (teams.length < 2 || !Number.isInteger(weeks) || weeks < 1) return [];

  const BYE = Symbol('bye');
  const field = teams.length % 2 === 0 ? [...teams] : [...teams, BYE];
  const half = field.length / 2;
  const schedule = [];

  // The rotating portion, excluding the pivot at index 0.
  let rotation = field.slice(1);

  for (let w = 0; w < weeks; w++) {
    const round = [field[0], ...rotation];
    const matchups = [];
    for (let i = 0; i < half; i++) {
      const home = round[i];
      const away = round[round.length - 1 - i];
      if (home === BYE || away === BYE) {
        matchups.push({ home: home === BYE ? away : home, away: null, bye: true });
      } else {
        // Alternate home and away across weeks so one team is not always home.
        matchups.push(w % 2 === 0 ? { home, away, bye: false } : { home: away, away: home, bye: false });
      }
    }
    schedule.push({ week: startWeek + w, matchups });
    rotation = [rotation[rotation.length - 1], ...rotation.slice(0, -1)];
  }
  return schedule;
}

/** How many regular-season weeks a league has before the playoffs. */
export function regularSeasonWeeks(settings) {
  return Math.max(0, (settings?.playoffWeekStart ?? 15) - (settings?.startWeek ?? 1));
}

/**
 * Sort teams into playoff seeds.
 *
 * ⚠️ THE TIEBREAK ORDER IS PART OF THE RULES, not a detail. Wins, then points
 * for, then head-to-head is the common convention; leaving ties to sort order
 * means a seeding that changes between two runs over the same data.
 */
export function seedTeams(standings = []) {
  return [...standings]
    .sort((a, b) => (b.wins - a.wins)
      || (b.pointsFor - a.pointsFor)
      || String(a.teamId).localeCompare(String(b.teamId)))
    .map((row, i) => ({ ...row, seed: i + 1 }));
}

/**
 * Build the first round of a playoff bracket, giving byes to the top seeds.
 *
 * ⚠️ A BRACKET THAT IS NOT A POWER OF TWO NEEDS BYES, and the count is
 * `nextPowerOfTwo - teams`, awarded to the best seeds. A 6-team playoff is two
 * first-round games and two byes — get this wrong and seeds 1 and 2 are knocked
 * out in a round they should never have played.
 */
export function buildBracket(seeds) {
  const n = seeds.length;
  if (n < 2) return { rounds: [], byes: [] };

  const size = 2 ** Math.ceil(Math.log2(n));
  const byeCount = size - n;
  const byes = seeds.slice(0, byeCount);
  const playing = seeds.slice(byeCount);

  const games = [];
  for (let i = 0; i < playing.length / 2; i++) {
    games.push({
      home: playing[i],
      away: playing[playing.length - 1 - i],
      winner: null,
    });
  }
  return { rounds: [games], byes };
}

/**
 * Advance a completed round into the next one.
 *
 * `reseed` re-ranks the survivors so the best remaining seed always plays the
 * worst — Sleeper's default and the fairer arrangement. Without it the bracket
 * is fixed at the start and a 1-seed can meet a 2-seed in a semi-final.
 */
export function advanceBracket(bracket, { reseed = true } = {}) {
  const round = bracket.rounds[bracket.rounds.length - 1] ?? [];
  if (round.length === 0) return bracket;
  if (round.some((g) => !g.winner)) return bracket; // round not finished

  let survivors = [...bracket.byes, ...round.map((g) => g.winner)];
  if (survivors.length < 2) return bracket;

  if (reseed) survivors.sort((a, b) => a.seed - b.seed);

  const games = [];
  for (let i = 0; i < survivors.length / 2; i++) {
    games.push({ home: survivors[i], away: survivors[survivors.length - 1 - i], winner: null });
  }
  return { rounds: [...bracket.rounds, games], byes: [] };
}

/** The champion, once the final round has a winner. */
export function bracketChampion(bracket) {
  const last = bracket.rounds[bracket.rounds.length - 1] ?? [];
  if (last.length === 1 && last[0].winner) return last[0].winner;
  return null;
}

/**
 * Standings from a set of played results.
 *
 * `results` is [{ week, home, away, homePoints, awayPoints }]. A bye scores no
 * result at all rather than a win — free wins would corrupt every tiebreak.
 *
 * `medianMatchup` adds a second weekly result against the league median, which is
 * Sleeper's `league_average_match`.
 */
export function buildStandings(teamIds, results = [], { medianMatchup = false } = {}) {
  const table = {};
  for (const id of teamIds ?? []) {
    table[String(id)] = { teamId: String(id), wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
  }

  const byWeek = new Map();
  for (const r of results) {
    if (!byWeek.has(r.week)) byWeek.set(r.week, []);
    byWeek.get(r.week).push(r);
  }

  for (const [, weekResults] of byWeek) {
    for (const r of weekResults) {
      const home = table[String(r.home)];
      if (!home) continue;
      home.pointsFor += Number(r.homePoints) || 0;

      if (r.away === null || r.away === undefined) continue; // a bye is not a win
      const away = table[String(r.away)];
      if (!away) continue;
      away.pointsFor += Number(r.awayPoints) || 0;
      home.pointsAgainst += Number(r.awayPoints) || 0;
      away.pointsAgainst += Number(r.homePoints) || 0;

      if (r.homePoints > r.awayPoints) { home.wins++; away.losses++; }
      else if (r.homePoints < r.awayPoints) { away.wins++; home.losses++; }
      else { home.ties++; away.ties++; }
    }

    if (medianMatchup) applyMedian(table, weekResults);
  }

  return Object.values(table);
}

/** A second result each week against the league median score. */
function applyMedian(table, weekResults) {
  const scores = [];
  for (const r of weekResults) {
    if (table[String(r.home)]) scores.push([String(r.home), Number(r.homePoints) || 0]);
    if (r.away !== null && r.away !== undefined && table[String(r.away)]) {
      scores.push([String(r.away), Number(r.awayPoints) || 0]);
    }
  }
  if (scores.length === 0) return;

  const sorted = scores.map(([, s]) => s).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[Math.floor(mid)];

  for (const [teamId, score] of scores) {
    if (score > median) table[teamId].wins++;
    else if (score < median) table[teamId].losses++;
    else table[teamId].ties++;
  }
}
