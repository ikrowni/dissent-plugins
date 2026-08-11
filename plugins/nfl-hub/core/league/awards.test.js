import { describe, it, expect } from 'vitest';
import { benchwarmerAwards, bestBenchByPosition } from './awards.js';

const POS = {
  qb1: 'QB', rb1: 'RB', rb2: 'RB', wr1: 'WR', wr2: 'WR', wr3: 'WR', te1: 'TE',
};
const positionOf = (id) => POS[id] ?? null;

describe('bestBenchByPosition', () => {
  it('finds the highest scorer left on the bench, per position', () => {
    const out = bestBenchByPosition({
      players: ['rb1', 'rb2', 'wr1', 'wr2'],
      lineup: ['rb1', 'wr1'],
      pointsOf: (id) => ({ rb2: 14.2, wr2: 21.5 }[id] ?? 0),
      positionOf,
    });
    expect(out.RB).toEqual({ playerId: 'rb2', points: 14.2 });
    expect(out.WR).toEqual({ playerId: 'wr2', points: 21.5 });
  });

  // ⚠️ A STARTER IS NOT A BENCHWARMER. The whole joke is that the manager left
  // them out; including a started player would make the award meaningless.
  it('never returns a player who was started', () => {
    const out = bestBenchByPosition({
      players: ['rb1', 'rb2'],
      lineup: ['rb1'],
      pointsOf: (id) => ({ rb1: 99, rb2: 3 }[id] ?? 0),
      positionOf,
    });
    expect(out.RB).toEqual({ playerId: 'rb2', points: 3 });
  });

  it('ignores positions with nobody on the bench', () => {
    const out = bestBenchByPosition({
      players: ['qb1'], lineup: ['qb1'], pointsOf: () => 10, positionOf,
    });
    expect(out.QB).toBeUndefined();
  });

  // A bench player who scored nothing is not an award; it is an empty seat.
  it('drops bench players who scored zero or less', () => {
    const out = bestBenchByPosition({
      players: ['rb1', 'rb2'], lineup: ['rb1'],
      pointsOf: () => 0, positionOf,
    });
    expect(out.RB).toBeUndefined();
  });

  it('breaks ties by player id so the result is stable', () => {
    const a = bestBenchByPosition({
      players: ['rb1', 'rb2'], lineup: [], pointsOf: () => 10, positionOf,
    });
    const b = bestBenchByPosition({
      players: ['rb2', 'rb1'], lineup: [], pointsOf: () => 10, positionOf,
    });
    expect(a.RB).toEqual(b.RB);
  });

  it('tolerates an empty roster', () => {
    expect(bestBenchByPosition({ players: [], lineup: [], pointsOf: () => 0, positionOf })).toEqual({});
  });

  it('ignores nulls in the lineup', () => {
    const out = bestBenchByPosition({
      players: ['rb1'], lineup: [null, null],
      pointsOf: () => 5, positionOf,
    });
    expect(out.RB).toEqual({ playerId: 'rb1', points: 5 });
  });
});

describe('benchwarmerAwards', () => {
  const teams = {
    t1: { players: ['rb1', 'rb2', 'wr1'], lineup: ['rb1', 'wr1'] },
    t2: { players: ['wr2', 'wr3'], lineup: ['wr2'] },
  };
  const pointsOf = (id) => ({ rb2: 14.2, wr3: 25.9 }[id] ?? 0);

  it('crowns one team per position — the league-wide best bench', () => {
    const out = benchwarmerAwards({ teams, pointsOf, positionOf });
    expect(out).toEqual([
      { position: 'WR', teamId: 't2', playerId: 'wr3', points: 25.9 },
      { position: 'RB', teamId: 't1', playerId: 'rb2', points: 14.2 },
    ]);
  });

  // ⚠️ Sorted by points, not by position order — the biggest embarrassment
  // leads, which is the entire point of the feature.
  it('sorts by points descending', () => {
    const out = benchwarmerAwards({ teams, pointsOf, positionOf });
    expect(out.map((a) => a.points)).toEqual([25.9, 14.2]);
  });

  it('returns nothing when every bench was empty or scoreless', () => {
    expect(benchwarmerAwards({ teams, pointsOf: () => 0, positionOf })).toEqual([]);
  });

  it('is empty-safe', () => {
    expect(benchwarmerAwards({})).toEqual([]);
    expect(benchwarmerAwards({ teams: {}, pointsOf: () => 1, positionOf })).toEqual([]);
  });

  // ⚠️ THE GUARD THAT MATTERS, and the one 12 passing tests missed. Both teams
  // have a benched WR and the WEAKER one is iterated LAST, so an implementation
  // that simply overwrites — rather than comparing — hands the award to the
  // wrong team and every other test still passes.
  it('keeps the higher scorer when a later team also benched that position', () => {
    const contested = {
      t1: { players: ['wr1', 'wr2'], lineup: ['wr1'] },   // benched wr2, 30.0
      t2: { players: ['wr3'], lineup: [] },               // benched wr3,  4.0
    };
    const out = benchwarmerAwards({
      teams: contested,
      pointsOf: (id) => ({ wr2: 30.0, wr3: 4.0 }[id] ?? 0),
      positionOf,
    });
    expect(out).toEqual([{ position: 'WR', teamId: 't1', playerId: 'wr2', points: 30.0 }]);
  });

  it('does not award a position to two teams', () => {
    const out = benchwarmerAwards({ teams, pointsOf, positionOf });
    const positions = out.map((a) => a.position);
    expect(new Set(positions).size).toBe(positions.length);
  });
});
