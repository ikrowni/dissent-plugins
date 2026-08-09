import { describe, it, expect } from 'vitest';
import {
  generateRegularSeason, regularSeasonWeeks, seedTeams, buildBracket,
  advanceBracket, bracketChampion, buildStandings,
} from './schedule.js';
import { normalizeSettings } from './settings.js';

const six = ['a', 'b', 'c', 'd', 'e', 'f'];
const five = ['a', 'b', 'c', 'd', 'e'];

const pairsOf = (week) => week.matchups
  .filter((m) => !m.bye)
  .map((m) => [m.home, m.away].sort().join('-'))
  .sort();

describe('generateRegularSeason', () => {
  it('pairs everyone exactly once per week', () => {
    const s = generateRegularSeason(six, 5);
    for (const week of s) {
      const played = week.matchups.flatMap((m) => [m.home, m.away]).filter(Boolean);
      expect(new Set(played).size).toBe(played.length);
      expect(played.sort()).toEqual([...six].sort());
    }
  });

  // ⚠️ If the pivot rotated with everyone else, the "rotation" would be a
  // relabelling and every week would have identical pairings.
  it('produces different pairings each week', () => {
    const s = generateRegularSeason(six, 5);
    const signatures = s.map(pairsOf).map((p) => p.join('|'));
    expect(new Set(signatures).size).toBe(5);
  });

  it('completes a full round robin in n-1 weeks with no repeats', () => {
    const s = generateRegularSeason(six, 5);
    const all = s.flatMap(pairsOf);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(15); // C(6,2)
  });

  it('is deterministic — regenerating does not reshuffle a season', () => {
    expect(generateRegularSeason(six, 5)).toEqual(generateRegularSeason(six, 5));
  });

  it('numbers weeks from the league’s start week', () => {
    expect(generateRegularSeason(six, 3, { startWeek: 5 }).map((w) => w.week)).toEqual([5, 6, 7]);
  });

  it('alternates home and away so one team is not always home', () => {
    const s = generateRegularSeason(['a', 'b'], 2);
    expect(s[0].matchups[0].home).not.toBe(s[1].matchups[0].home);
  });

  describe('odd team counts', () => {
    const s = generateRegularSeason(five, 5);

    it('gives exactly one bye per week', () => {
      for (const week of s) {
        expect(week.matchups.filter((m) => m.bye)).toHaveLength(1);
      }
    });

    // ⚠️ A pinned bye means the same manager sits out every week.
    it('rotates the bye through every team', () => {
      const onBye = s.map((w) => w.matchups.find((m) => m.bye).home);
      expect(new Set(onBye).size).toBe(5);
    });

    it('never leaves a team both playing and on a bye', () => {
      for (const week of s) {
        const involved = week.matchups.flatMap((m) => [m.home, m.away]).filter(Boolean);
        expect(new Set(involved).size).toBe(involved.length);
      }
    });
  });

  it('returns nothing for degenerate input rather than throwing', () => {
    expect(generateRegularSeason([], 5)).toEqual([]);
    expect(generateRegularSeason(['solo'], 5)).toEqual([]);
    expect(generateRegularSeason(six, 0)).toEqual([]);
  });
});

describe('regularSeasonWeeks', () => {
  it('counts the weeks before the playoffs', () => {
    expect(regularSeasonWeeks(normalizeSettings({ startWeek: 1, playoffWeekStart: 15 }))).toBe(14);
  });
});

describe('seedTeams', () => {
  it('ranks on wins, then points for', () => {
    const seeds = seedTeams([
      { teamId: 'a', wins: 8, pointsFor: 1200 },
      { teamId: 'b', wins: 10, pointsFor: 1100 },
      { teamId: 'c', wins: 8, pointsFor: 1300 },
    ]);
    expect(seeds.map((s) => s.teamId)).toEqual(['b', 'c', 'a']);
    expect(seeds.map((s) => s.seed)).toEqual([1, 2, 3]);
  });

  // A seeding that changes between two runs over the same data is not a seeding.
  it('is deterministic when teams are completely tied', () => {
    const tied = [
      { teamId: 'z', wins: 5, pointsFor: 1000 },
      { teamId: 'a', wins: 5, pointsFor: 1000 },
    ];
    expect(seedTeams(tied).map((s) => s.teamId)).toEqual(['a', 'z']);
    expect(seedTeams([...tied].reverse()).map((s) => s.teamId)).toEqual(['a', 'z']);
  });
});

describe('buildBracket', () => {
  const seeds = (n) => Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, seed: i + 1 }));

  // ⚠️ Get the bye count wrong and the 1-seed plays a round it should not.
  it('gives byes to the top seeds in a 6-team playoff', () => {
    const b = buildBracket(seeds(6));
    expect(b.byes.map((s) => s.seed)).toEqual([1, 2]);
    expect(b.rounds[0]).toHaveLength(2);
    expect(b.rounds[0].map((g) => [g.home.seed, g.away.seed])).toEqual([[3, 6], [4, 5]]);
  });

  it('gives no byes when the field is already a power of two', () => {
    const b = buildBracket(seeds(4));
    expect(b.byes).toEqual([]);
    expect(b.rounds[0].map((g) => [g.home.seed, g.away.seed])).toEqual([[1, 4], [2, 3]]);
  });

  it('handles a 5-team playoff — three byes, one game', () => {
    const b = buildBracket(seeds(5));
    expect(b.byes.map((s) => s.seed)).toEqual([1, 2, 3]);
    expect(b.rounds[0].map((g) => [g.home.seed, g.away.seed])).toEqual([[4, 5]]);
  });

  it('returns an empty bracket for fewer than two teams', () => {
    expect(buildBracket(seeds(1)).rounds).toEqual([]);
  });
});

describe('advanceBracket', () => {
  const seeds = (n) => Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, seed: i + 1 }));

  it('waits until every game in the round has a winner', () => {
    const b = buildBracket(seeds(4));
    b.rounds[0][0].winner = b.rounds[0][0].home;
    expect(advanceBracket(b).rounds).toHaveLength(1);
  });

  // ⚠️ Without reseeding, the bracket is fixed at the start and a 1-seed can meet
  // a 2-seed in a semi-final.
  it('reseeds so the best survivor plays the worst', () => {
    const b = buildBracket(seeds(6));
    b.rounds[0][0].winner = b.rounds[0][0].away;  // 6 beats 3
    b.rounds[0][1].winner = b.rounds[0][1].home;  // 4 beats 5
    const next = advanceBracket(b, { reseed: true });
    expect(next.rounds[1].map((g) => [g.home.seed, g.away.seed])).toEqual([[1, 6], [2, 4]]);
  });

  it('can leave the bracket fixed when a league prefers it', () => {
    const b = buildBracket(seeds(4));
    b.rounds[0][0].winner = b.rounds[0][0].away;  // 4 beats 1
    b.rounds[0][1].winner = b.rounds[0][1].home;  // 2 beats 3
    const next = advanceBracket(b, { reseed: false });
    expect(next.rounds[1][0].home.seed).toBe(4);
  });

  it('folds bye teams into the next round', () => {
    const b = buildBracket(seeds(6));
    b.rounds[0][0].winner = b.rounds[0][0].home;
    b.rounds[0][1].winner = b.rounds[0][1].home;
    const next = advanceBracket(b);
    expect(next.byes).toEqual([]);
    expect(next.rounds[1].flatMap((g) => [g.home.seed, g.away.seed]).sort()).toEqual([1, 2, 3, 4]);
  });

  it('runs a whole 6-team playoff down to one champion', () => {
    let b = buildBracket(seeds(6));
    b.rounds[0].forEach((g) => { g.winner = g.home; });
    b = advanceBracket(b);
    expect(bracketChampion(b)).toBe(null);
    b.rounds[1].forEach((g) => { g.winner = g.home; });
    b = advanceBracket(b);
    expect(b.rounds[2]).toHaveLength(1);
    b.rounds[2][0].winner = b.rounds[2][0].home;
    expect(bracketChampion(b).seed).toBe(1);
  });
});

describe('buildStandings', () => {
  const results = [
    { week: 1, home: 'a', away: 'b', homePoints: 100, awayPoints: 90 },
    { week: 1, home: 'c', away: 'd', homePoints: 80, awayPoints: 80 },
    { week: 2, home: 'a', away: 'c', homePoints: 70, awayPoints: 110 },
  ];

  it('counts wins, losses, ties and both points columns', () => {
    const t = buildStandings(['a', 'b', 'c', 'd'], results);
    const by = Object.fromEntries(t.map((r) => [r.teamId, r]));
    expect(by.a).toMatchObject({ wins: 1, losses: 1, ties: 0, pointsFor: 170, pointsAgainst: 200 });
    expect(by.c).toMatchObject({ wins: 1, losses: 0, ties: 1, pointsFor: 190 });
    expect(by.d).toMatchObject({ ties: 1 });
  });

  // ⚠️ A free win from a bye would corrupt every tiebreak in the table.
  it('scores a bye as points only, never as a win', () => {
    const t = buildStandings(['a'], [{ week: 1, home: 'a', away: null, homePoints: 95 }]);
    expect(t[0]).toMatchObject({ wins: 0, losses: 0, ties: 0, pointsFor: 95 });
  });

  it('ignores results for teams not in the league', () => {
    const t = buildStandings(['a'], [{ week: 1, home: 'ghost', away: 'a', homePoints: 1, awayPoints: 2 }]);
    expect(t[0].pointsFor).toBe(0);
  });

  describe('median matchup', () => {
    const week = [
      { week: 1, home: 'a', away: 'b', homePoints: 120, awayPoints: 60 },
      { week: 1, home: 'c', away: 'd', homePoints: 100, awayPoints: 80 },
    ];

    it('adds a second result against the league median', () => {
      const t = buildStandings(['a', 'b', 'c', 'd'], week, { medianMatchup: true });
      const by = Object.fromEntries(t.map((r) => [r.teamId, r]));
      // Scores 120/100/80/60 -> median 90. a and c beat it; b and d do not.
      expect(by.a).toMatchObject({ wins: 2, losses: 0 });
      expect(by.b).toMatchObject({ wins: 0, losses: 2 });
      expect(by.c).toMatchObject({ wins: 2, losses: 0 });
      expect(by.d).toMatchObject({ wins: 0, losses: 2 });
    });

    it('is off by default', () => {
      const t = buildStandings(['a', 'b', 'c', 'd'], week);
      expect(t.find((r) => r.teamId === 'a').wins).toBe(1);
    });
  });
});
