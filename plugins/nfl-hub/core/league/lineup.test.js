import { describe, it, expect } from 'vitest';
import {
  optimalLineup, optimalPoints, setLineupPoints, weeklyPoints, pointsLeftOnBench,
} from './lineup.js';
import { slotAccepts } from './slots.js';

// A tiny world: ids encode their position so the fixtures stay readable.
const P = {
  qb1: ['QB', 25], qb2: ['QB', 18],
  rb1: ['RB', 22], rb2: ['RB', 12], rb3: ['RB', 4],
  wr1: ['WR', 20], wr2: ['WR', 15], wr3: ['WR', 6],
  te1: ['TE', 14], te2: ['TE', 3],
  k1: ['K', 9], def1: ['DEF', 11],
};
const positionOf = (id) => P[id]?.[0] ?? null;
const pointsOf = (id) => P[id]?.[1] ?? 0;
const all = Object.keys(P);

describe('optimalLineup', () => {
  it('fills dedicated slots with the best player at that position', () => {
    const rows = optimalLineup(all, ['QB', 'TE'], pointsOf, positionOf);
    expect(rows.map((r) => r.playerId)).toEqual(['qb1', 'te1']);
  });

  it('uses FLEX for the best remaining RB/WR/TE, not a QB', () => {
    const rows = optimalLineup(all, ['QB', 'RB', 'WR', 'FLEX'], pointsOf, positionOf);
    expect(rows[0].playerId).toBe('qb1');
    expect(rows.map((r) => r.playerId)).not.toContain('qb2');
    // Best three of rb1(22)/wr1(20)/rb2(12)/wr2(15)/te1(14) across RB, WR, FLEX.
    expect(rows.slice(1).map((r) => r.playerId).sort()).toEqual(['rb1', 'wr1', 'wr2']);
  });

  it('puts a second QB in SUPER_FLEX when that is the best use of it', () => {
    const rows = optimalLineup(all, ['QB', 'SUPER_FLEX'], pointsOf, positionOf);
    expect(rows[0].playerId).toBe('qb1');
    expect(rows[1].playerId).toBe('rb1'); // 22 beats qb2's 18
  });

  it('never starts the same player twice', () => {
    const rows = optimalLineup(all, ['RB', 'RB', 'FLEX', 'SUPER_FLEX'], pointsOf, positionOf);
    const used = rows.map((r) => r.playerId).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves a slot empty rather than filling it illegally', () => {
    // No kicker available: the K slot must be empty, not occupied by a WR.
    const rows = optimalLineup(['wr1', 'rb1'], ['K', 'FLEX'], pointsOf, positionOf);
    expect(rows[0]).toMatchObject({ slot: 'K', playerId: null });
    expect(rows[1].playerId).toBe('rb1');
  });

  it('handles fewer players than slots', () => {
    const rows = optimalLineup(['rb1'], ['RB', 'RB', 'FLEX'], pointsOf, positionOf);
    expect(rows.filter((r) => r.playerId).length).toBe(1);
  });

  it('returns empty rows for degenerate input rather than throwing', () => {
    expect(optimalLineup([], ['QB'], pointsOf, positionOf)).toEqual([{ slot: 'QB', playerId: null, points: 0 }]);
    expect(optimalLineup(all, [], pointsOf, positionOf)).toEqual([]);
    expect(optimalLineup(null, null, pointsOf, positionOf)).toEqual([]);
  });

  it('ignores duplicate ids in the available list', () => {
    const rows = optimalLineup(['rb1', 'rb1'], ['RB', 'FLEX'], pointsOf, positionOf);
    expect(rows.filter((r) => r.playerId === 'rb1')).toHaveLength(1);
  });

  // ⚠️ THE CASE GREEDY GETS WRONG. REC_FLEX (WR,TE) and WRRB_FLEX (RB,WR)
  // overlap without nesting. Filling REC_FLEX first with the best eligible
  // player takes the elite WR, leaving WRRB_FLEX a weak RB — when giving the WR
  // to WRRB_FLEX and the TE to REC_FLEX scores more.
  it('beats greedy on overlapping, non-nested flex slots', () => {
    const pts = { W: 20, T: 14, R: 4 };
    const pos = (id) => ({ W: 'WR', T: 'TE', R: 'RB' })[id];
    const rows = optimalLineup(['W', 'T', 'R'], ['REC_FLEX', 'WRRB_FLEX'], (id) => pts[id], pos);
    const byslot = Object.fromEntries(rows.map((r) => [r.slot, r.playerId]));
    expect(byslot.REC_FLEX).toBe('T');
    expect(byslot.WRRB_FLEX).toBe('W');
    // Greedy would have scored 20 + 4 = 24.
    expect(optimalPoints(['W', 'T', 'R'], ['REC_FLEX', 'WRRB_FLEX'], (id) => pts[id], pos)).toBe(34);
  });
});

// ⚠️ THE TEST THAT ACTUALLY PROVES THE ALGORITHM. Every assertion above encodes
// my own expectation; this one checks the optimiser against exhaustive search
// over randomised inputs. A "smarter" rewrite that quietly loses points cannot
// survive it.
describe('optimalLineup vs exhaustive brute force', () => {
  // ⚠️ THE SLOT POOL IS DELIBERATELY WEIGHTED TOWARDS OVERLAPPING FLEXES. With a
  // uniform pool over all ten slot types this test PASSED against a greedy
  // implementation — 200 random rosters never once produced a case greedy loses,
  // because the non-nested pair (REC_FLEX, WRRB_FLEX) rarely co-occurred and the
  // rosters were too small for it to matter when it did. A randomised test that
  // never generates the hard case is decorative. Verified by mutation: greedy now
  // fails here.
  const SLOTS = [
    'REC_FLEX', 'WRRB_FLEX', 'FLEX', 'SUPER_FLEX', 'REC_FLEX', 'WRRB_FLEX',
    'QB', 'RB', 'WR', 'TE',
  ];
  // Skewed towards the positions those flexes fight over, for the same reason.
  const POSITIONS = ['WR', 'WR', 'RB', 'RB', 'TE', 'TE', 'QB', 'K', 'DEF'];

  // Deterministic PRNG so a failure is reproducible — a flaky optimiser test
  // that cannot be re-run is worse than no test.
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function bruteForce(ids, slots, pts, pos) {
    let best = 0;
    const used = new Set();
    const walk = (i, total) => {
      if (i === slots.length) { best = Math.max(best, total); return; }
      for (const id of ids) {
        if (used.has(id) || !slotAccepts(slots[i], pos(id))) continue;
        used.add(id);
        walk(i + 1, total + pts(id));
        used.delete(id);
      }
      // Leaving the slot empty is always an option — sometimes the only one.
      walk(i + 1, total);
    };
    walk(0, 0);
    return Math.round(best * 100) / 100;
  }

  // ⚠️ THE TRIAL COUNT IS LOAD-BEARING. Rosters where greedy actually loses are
  // rare — measured at roughly 3 in 1,000 even with the slot pool weighted
  // towards overlapping flexes — so 200 trials caught nothing and this test
  // passed against a greedy implementation. 3,000 makes a miss vanishingly
  // unlikely. Verified by mutation, which is the only reason we know 200 was
  // not enough.
  it('matches brute force on 3000 randomised rosters', () => {
    const rand = rng(20260809);
    for (let trial = 0; trial < 3000; trial++) {
      const nSlots = 2 + Math.floor(rand() * 5);
      const nPlayers = 2 + Math.floor(rand() * 6);
      const slots = Array.from({ length: nSlots }, () => SLOTS[Math.floor(rand() * SLOTS.length)]);
      const table = {};
      const ids = Array.from({ length: nPlayers }, (_, i) => {
        const id = `p${i}`;
        table[id] = {
          pos: POSITIONS[Math.floor(rand() * POSITIONS.length)],
          pts: Math.round(rand() * 300) / 10,
        };
        return id;
      });
      const pts = (id) => table[id].pts;
      const pos = (id) => table[id].pos;

      const mine = optimalPoints(ids, slots, pts, pos);
      const truth = bruteForce(ids, slots, pts, pos);
      if (mine !== truth) {
        throw new Error(`trial ${trial}: optimiser ${mine} vs brute force ${truth}\n`
          + `slots=${JSON.stringify(slots)}\nplayers=${JSON.stringify(table)}`);
      }
    }
  });

  it('never produces an illegal or duplicated assignment in those rosters', () => {
    const rand = rng(777);
    for (let trial = 0; trial < 100; trial++) {
      const slots = Array.from({ length: 2 + Math.floor(rand() * 4) },
        () => SLOTS[Math.floor(rand() * SLOTS.length)]);
      const table = {};
      const ids = Array.from({ length: 2 + Math.floor(rand() * 5) }, (_, i) => {
        const id = `p${i}`;
        table[id] = { pos: POSITIONS[Math.floor(rand() * POSITIONS.length)], pts: Math.round(rand() * 200) / 10 };
        return id;
      });
      const rows = optimalLineup(ids, slots, (id) => table[id].pts, (id) => table[id].pos);
      const used = rows.map((r) => r.playerId).filter(Boolean);
      expect(new Set(used).size).toBe(used.length);
      for (const r of rows) {
        if (r.playerId) expect(slotAccepts(r.slot, table[r.playerId].pos)).toBe(true);
      }
    }
  });
});

describe('setLineupPoints', () => {
  const slots = ['QB', 'RB', 'FLEX'];

  it('scores the lineup as submitted', () => {
    const out = setLineupPoints(['qb1', 'rb1', 'wr1'], slots, pointsOf, positionOf);
    expect(out.total).toBe(67);
  });

  // ⚠️ Skipping an illegal entry would silently award the points of a legal
  // lineup to one that was never legal.
  it('scores an illegal placement as zero and flags it', () => {
    const out = setLineupPoints(['qb1', 'rb1', 'qb2'], slots, pointsOf, positionOf);
    expect(out.total).toBe(47);
    expect(out.rows[2]).toMatchObject({ playerId: 'qb2', points: 0, illegal: true });
  });

  it('treats null and "0" as empty slots', () => {
    expect(setLineupPoints(['qb1', null, '0'], slots, pointsOf, positionOf).total).toBe(25);
  });

  it('scores an unknown player as zero', () => {
    expect(setLineupPoints(['ghost', 'rb1', 'wr1'], slots, pointsOf, positionOf).total).toBe(42);
  });
});

describe('weeklyPoints', () => {
  const starterSlots = ['QB', 'RB', 'FLEX'];

  it('scores the set lineup in a normal league', () => {
    const out = weeklyPoints({
      players: all, lineup: ['qb2', 'rb3', 'wr3'], starterSlots, pointsOf, positionOf, bestBall: false,
    });
    expect(out.total).toBe(28);
    expect(out.bestBall).toBe(false);
  });

  // ⚠️ Best ball must ignore the submitted lineup ENTIRELY. Falling back to it
  // when one exists would make a best-ball league score differently depending on
  // whether the manager logged in.
  it('ignores the submitted lineup completely in best ball', () => {
    const bad = weeklyPoints({
      players: all, lineup: ['qb2', 'rb3', 'wr3'], starterSlots, pointsOf, positionOf, bestBall: true,
    });
    const none = weeklyPoints({
      players: all, lineup: [], starterSlots, pointsOf, positionOf, bestBall: true,
    });
    expect(bad.total).toBe(none.total);
    expect(bad.total).toBe(25 + 22 + 20);
    expect(bad.bestBall).toBe(true);
  });
});

describe('pointsLeftOnBench', () => {
  const starterSlots = ['QB', 'RB', 'FLEX'];

  it('measures what a better lineup would have scored', () => {
    const left = pointsLeftOnBench({
      players: all, lineup: ['qb2', 'rb3', 'wr3'], starterSlots, pointsOf, positionOf,
    });
    expect(left).toBe(67 - 28);
  });

  it('is zero for an already-optimal lineup, never negative', () => {
    const left = pointsLeftOnBench({
      players: all, lineup: ['qb1', 'rb1', 'wr1'], starterSlots, pointsOf, positionOf,
    });
    expect(left).toBe(0);
  });
});
