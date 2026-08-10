import { describe, it, expect } from 'vitest';
import { resolveBracket, advanceSide, weekForRound } from './bracket-resolve.js';
import { buildBracket, consolationSeeds } from './schedule.js';

const table = (n) => Array.from({ length: n }, (_, i) => ({
  teamId: `t${i + 1}`, seed: i + 1, wins: n - i, pointsFor: 1000 - i,
}));

/** A scores callback over `{ week: { teamId: points } }`. */
const scorer = (byWeek) => (week) => {
  const w = byWeek[week];
  if (!w) return null;
  return { teams: Object.fromEntries(Object.entries(w).map(([id, total]) => [id, { total }])) };
};

/** A postseason record as `startPlayoffs` writes it. */
function postseason(teams, playoffTeams, { playoffWeekStart = 15, consolation = true } = {}) {
  const standings = table(teams);
  const seeds = standings.slice(0, playoffTeams);
  const main = buildBracket(seeds);
  const alsoRans = consolation ? consolationSeeds(standings, playoffTeams) : [];
  const cons = alsoRans.length >= 2 ? buildBracket(alsoRans) : null;
  return {
    season: 2025,
    playoffWeekStart,
    reseed: true,
    seeds,
    rounds: main.rounds,
    byes: main.byes,
    champion: null,
    consolation: cons
      ? { seeds: alsoRans, rounds: cons.rounds, byes: cons.byes, champion: null }
      : null,
  };
}

describe('weekForRound', () => {
  it('pins round 0 to the first playoff week', () => {
    expect(weekForRound(15, 0)).toBe(15);
    expect(weekForRound(15, 2)).toBe(17);
  });

  it('defaults to week 15 when a bracket predates the setting', () => {
    expect(weekForRound(undefined, 0)).toBe(15);
  });
});

describe('advanceSide', () => {
  const side = () => {
    const b = buildBracket(table(4));
    return { rounds: b.rounds, byes: b.byes, champion: null };
  };

  it('waits when the week has no scores at all', () => {
    const out = advanceSide(side(), { playoffWeekStart: 15, scoresFor: () => null });
    expect(out.rounds).toHaveLength(1);
    expect(out.rounds[0].every((g) => !g.winner)).toBe(true);
  });

  // ⚠️ Half a scored round must not advance — the unplayed game would be
  // dropped and its two teams eliminated without playing.
  it('waits when only one game in the round has both scores', () => {
    const out = advanceSide(side(), {
      playoffWeekStart: 15,
      scoresFor: scorer({ 15: { t1: 100, t4: 90 } }),
    });
    expect(out.rounds).toHaveLength(1);
  });

  it('decides a round and opens the next one', () => {
    const out = advanceSide(side(), {
      playoffWeekStart: 15,
      scoresFor: scorer({ 15: { t1: 100, t4: 90, t2: 80, t3: 95 } }),
    });
    expect(out.rounds).toHaveLength(2);
    expect(out.rounds[1][0].home.seed).toBe(1);
    expect(out.rounds[1][0].away.seed).toBe(3);
  });

  it('runs to a champion once the final has a score', () => {
    const out = advanceSide(side(), {
      playoffWeekStart: 15,
      scoresFor: scorer({
        15: { t1: 100, t4: 90, t2: 80, t3: 95 },
        16: { t1: 120, t3: 110 },
      }),
    });
    expect(out.champion.teamId).toBe('t1');
  });

  // ⚠️ Without this the bracket stalls forever on a genuine tie, and a fantasy
  // week really can tie.
  it('breaks a tie for the better seed and says that it did', () => {
    const out = advanceSide(side(), {
      playoffWeekStart: 15,
      scoresFor: scorer({ 15: { t1: 100, t4: 100, t2: 80, t3: 95 } }),
    });
    expect(out.rounds[0][0].winner.seed).toBe(1);
    expect(out.rounds[0][0].tie).toBe(true);
  });

  it('leaves a finished side alone', () => {
    const done = { rounds: [[{ home: table(2)[0], away: table(2)[1], winner: table(2)[0] }]], byes: [], champion: table(2)[0] };
    expect(advanceSide(done, { playoffWeekStart: 15, scoresFor: () => { throw new Error('should not read'); } })).toBe(done);
  });
});

describe('resolveBracket', () => {
  // 10 teams, 6 in the playoffs: a three-round championship beside a two-round
  // consolation, so the consolation finishes FIRST.
  const wide = () => postseason(10, 6);
  // 10 teams, 4 in the playoffs: a two-round championship beside a three-round
  // consolation, so the championship finishes first.
  const narrow = () => postseason(10, 4);

  it('seeds both sides from one standings table', () => {
    const b = wide();
    expect(b.rounds[0].map((g) => [g.home.teamId, g.away.teamId])).toEqual([['t3', 't6'], ['t4', 't5']]);
    expect(b.consolation.rounds[0].map((g) => [g.home.teamId, g.away.teamId]))
      .toEqual([['t7', 't10'], ['t8', 't9']]);
  });

  it('advances both sides on the same week', () => {
    const out = resolveBracket(wide(), scorer({
      15: { t3: 100, t6: 90, t4: 88, t5: 99, t7: 70, t10: 60, t8: 50, t9: 55 },
    }));
    expect(out.rounds).toHaveLength(2);
    expect(out.consolation.rounds).toHaveLength(2);
  });

  // ⚠️ THE REGRESSION THESE TWO EXIST FOR, and they MUST run week by week.
  //
  // The tick resolves the STORED record every five minutes against whatever
  // scores exist so far, so the moment one side crowns a champion that champion
  // is written down and the next tick reads it back. Resolving once with every
  // week already present never puts `champion` on the input, and so never
  // reaches the early return that used to freeze the other side — a
  // single-shot version of this test passes against the bug.
  const tickThrough = (bracket, byWeek, weeks) => {
    let state = bracket;
    const known = {};
    for (const w of weeks) {
      known[w] = byWeek[w];
      state = resolveBracket(state, scorer(known));
      // What the tick does: stringify, store, read back.
      state = JSON.parse(JSON.stringify(state));
    }
    return state;
  };

  it('keeps advancing the championship after the consolation has a winner', () => {
    const out = tickThrough(wide(), {
      15: { t3: 100, t6: 90, t4: 88, t5: 99, t7: 70, t10: 60, t8: 50, t9: 55 },
      16: { t1: 120, t5: 100, t2: 110, t3: 90, t7: 40, t9: 30 },
      17: { t1: 130, t2: 100 },
    }, [15, 16, 17]);
    // The consolation is decided in week 16, a week BEFORE the final.
    expect(out.consolation.champion.teamId).toBe('t7');
    expect(out.champion.teamId).toBe('t1');
  });

  it('keeps advancing the consolation after the championship has a winner', () => {
    const out = tickThrough(narrow(), {
      15: { t1: 100, t4: 90, t2: 88, t3: 99, t5: 70, t10: 60, t6: 50, t9: 55, t7: 80, t8: 40 },
      16: { t1: 120, t3: 100, t5: 90, t7: 80, t9: 70, t6: 60 },
      17: { t5: 95, t7: 60 },
    }, [15, 16, 17]);
    // The championship is decided in week 16, a week BEFORE the consolation.
    expect(out.champion.teamId).toBe('t1');
    expect(out.consolation.champion.teamId).toBe('t5');
  });

  it('leaves a league with no consolation side alone', () => {
    const b = postseason(4, 4);
    expect(b.consolation).toBe(null);
    const out = resolveBracket(b, scorer({ 15: { t1: 100, t4: 90, t2: 80, t3: 95 } }));
    expect(out.consolation).toBe(null);
  });

  // ⚠️ `undefined` here would be dropped by JSON.stringify, and the tick's
  // change-detection compares stringified records — an unchanged bracket would
  // look different on every pass and be rewritten forever.
  it('never turns a null consolation into undefined', () => {
    const out = resolveBracket(postseason(4, 4), () => null);
    expect('consolation' in out).toBe(true);
    expect(JSON.stringify(out)).toContain('"consolation":null');
  });

  it('is idempotent — resolving twice over the same scores changes nothing', () => {
    const scores = scorer({
      15: { t3: 100, t6: 90, t4: 88, t5: 99, t7: 70, t10: 60, t8: 50, t9: 55 },
    });
    const once = resolveBracket(wide(), scores);
    expect(JSON.stringify(resolveBracket(once, scores))).toEqual(JSON.stringify(once));
  });

  it('does nothing at all before any week is scored', () => {
    const b = wide();
    const out = resolveBracket(b, () => null);
    expect(JSON.stringify(out)).toEqual(JSON.stringify(b));
  });

  it('handles a bracket stored before consolation existed', () => {
    const legacy = postseason(10, 6);
    delete legacy.consolation;
    const out = resolveBracket(legacy, scorer({
      15: { t3: 100, t6: 90, t4: 88, t5: 99 },
    }));
    expect(out.rounds).toHaveLength(2);
    expect(out.consolation).toBe(null);
  });
});
