// core/playoff-odds.js — browser-side Monte Carlo playoff odds.
//
// Every remaining matchup is simulated by drawing each side a score from its own scoring
// distribution and awarding the win to the higher one. After the full remaining schedule
// the league is seeded by wins, then points-for, and the top `playoffTeams` advance.
// Repeat N times; the odds are the share of runs a team made it.
//
// Runs in CHUNKS with a yield between them. At 12 teams x ~8 remaining weeks x 5,000
// iterations this is ~480k simulated games, which as one synchronous loop drops frames on
// a mid-range laptop. `rng` and `yieldFn` are injectable so the whole thing is testable
// deterministically and without real timers.

/** Mean and standard deviation of each roster's weekly scores. */
export function teamStats(scored) {
  const byRoster = {};
  for (const { scores } of scored ?? []) {
    for (const [id, pts] of Object.entries(scores ?? {})) {
      (byRoster[id] ??= []).push(Number(pts) || 0);
    }
  }

  const out = {};
  for (const [id, vals] of Object.entries(byRoster)) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.length > 1
      ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)
      : 0;
    // A single data point has no spread, which would make every one of its games a
    // foregone conclusion. 15% of the mean is roughly the league-wide weekly sigma.
    const sd = variance > 0 ? Math.sqrt(variance) : Math.max(1, mean * 0.15);
    out[id] = { mean, sd };
  }
  return out;
}

/** Future weeks' pairings. Sleeper returns them pre-set, with zeroed points. */
export function remainingGames(weeks) {
  const out = [];
  for (const w of weeks ?? []) {
    const byMatchup = new Map();
    for (const m of w?.matchups ?? []) {
      if (m?.matchupId == null) continue;
      if (!byMatchup.has(m.matchupId)) byMatchup.set(m.matchupId, []);
      byMatchup.get(m.matchupId).push(m.rosterId);
    }
    for (const [, ids] of byMatchup) {
      // One roster on a matchup id is a bye — there is no game to simulate.
      if (ids.length === 2) out.push({ week: w.week, home: ids[0], away: ids[1] });
    }
  }
  return out;
}

/** Box–Muller, so scores are normally distributed rather than uniform. */
function gaussian(rng, mean, sd) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export async function simulate({
  rosters, scored, remaining, playoffTeams,
  iterations = 5000, chunkSize = 500,
  rng = Math.random,
  yieldFn = () => new Promise((r) => { setTimeout(r, 0); }),
}) {
  const stats = teamStats(scored);
  const seeds = (rosters ?? []).map((r) => ({
    rosterId: r.rosterId,
    wins: r.wins ?? 0,
    pointsFor: r.pointsFor ?? 0,
  }));
  const cut = Math.max(1, Number(playoffTeams) || 1);
  const made = Object.fromEntries(seeds.map((s) => [s.rosterId, 0]));

  const runOne = () => {
    const w = {};
    const pf = {};
    for (const s of seeds) { w[s.rosterId] = s.wins; pf[s.rosterId] = s.pointsFor; }

    for (const g of remaining ?? []) {
      const hs = stats[g.home] ?? { mean: 100, sd: 15 };
      const as = stats[g.away] ?? { mean: 100, sd: 15 };
      const h = gaussian(rng, hs.mean, hs.sd);
      const a = gaussian(rng, as.mean, as.sd);
      pf[g.home] = (pf[g.home] ?? 0) + h;
      pf[g.away] = (pf[g.away] ?? 0) + a;
      if (h > a) w[g.home] = (w[g.home] ?? 0) + 1;
      else if (a > h) w[g.away] = (w[g.away] ?? 0) + 1;
    }

    const order = seeds
      .map((s) => s.rosterId)
      .sort((x, y) => (w[y] - w[x]) || (pf[y] - pf[x]));
    for (let i = 0; i < cut && i < order.length; i += 1) made[order[i]] += 1;
  };

  for (let done = 0; done < iterations; done += chunkSize) {
    const upto = Math.min(chunkSize, iterations - done);
    for (let i = 0; i < upto; i += 1) runOne();
    // Hand the frame back between chunks, including after the last one — a caller that
    // renders immediately afterwards then paints on a clean frame.
    await yieldFn();
  }

  return seeds.map((s) => ({
    rosterId: s.rosterId,
    odds: Math.round((made[s.rosterId] / iterations) * 1000) / 10,
  }));
}
