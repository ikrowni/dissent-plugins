import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {rngFrom, startingNeed, remainingNeed, botPick, createMock, availableIn, rosterOf, onTheClock, pick, runBotsUntilMyTurn, isComplete, POSITION_CAP, gradeDrafts, bestPickFor} from './mock-draft.js';

const ROSTER = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN'];

// A ranking deep enough to draft from, with a realistic position mix.
const POOL = (() => {
  const mix = ['RB', 'WR', 'WR', 'QB', 'RB', 'TE', 'WR', 'RB', 'QB', 'WR', 'TE', 'K', 'DEF'];
  return Array.from({ length: 260 }, (_, i) => ({ id: `p${i + 1}`, pos: mix[i % mix.length] }));
})();
const POS = Object.fromEntries(POOL.map((p) => [p.id, p.pos]));
const RANKING = POOL.map((p) => p.id);
const positionOf = (id) => POS[String(id)] ?? null;

const mock = (over = {}) => createMock({
  teams: 12, rounds: 15, slot: 1, rosterPositions: ROSTER, ranking: RANKING, positionOf, seed: 7, ...over,
});

describe('rngFrom', () => {
  // ⚠️ Reproducibility is what makes any of this testable, and lets somebody
  // replay a board they want to think about.
  it('is deterministic for a seed', () => {
    const a = rngFrom(42); const b = rngFrom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('differs between seeds', () => {
    expect(rngFrom(1)()).not.toBe(rngFrom(2)());
  });

  it('stays in range', () => {
    const r = rngFrom(9);
    for (let i = 0; i < 200; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('startingNeed', () => {
  it('counts starting slots and ignores the bench', () => {
    expect(startingNeed(ROSTER)).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1 });
  });

  it('ignores IR and taxi as well as bench', () => {
    expect(startingNeed(['QB', 'BN', 'IR', 'TAXI'])).toEqual({ QB: 1 });
  });
});

describe('remainingNeed', () => {
  it('is the full starting lineup for an empty roster', () => {
    expect(remainingNeed(ROSTER, [])).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1 });
  });

  it('drops a position once it is filled', () => {
    expect(remainingNeed(ROSTER, ['QB']).QB).toBeUndefined();
  });

  // ⚠️ A spare RB/WR/TE covers FLEX. Without this a bot keeps "needing" a flex
  // it already has a body for, and drafts a fourth running back to fill it.
  it('lets a spare skill player cover the flex', () => {
    const need = remainingNeed(ROSTER, ['RB', 'RB', 'RB']);
    expect(need.RB).toBeUndefined();
    expect(need.FLEX).toBeUndefined();
  });

  it('is empty once a whole starting lineup exists', () => {
    expect(remainingNeed(ROSTER, ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'RB', 'K', 'DEF'])).toEqual({});
  });
});

describe('botPick', () => {
  const rng = () => 0.5; // no noise, so the preference is the only thing under test

  it('takes from the top of the board', () => {
    const chosen = botPick(POOL.slice(0, 20), { need: remainingNeed(ROSTER, []), owned: [], rng });
    expect(POOL.slice(0, 8).map((p) => p.id)).toContain(chosen);
  });

  // ⚠️ THE WHOLE REASON THIS IS NOT best-available. Pure BPA gives a bot five
  // running backs and no quarterback.
  it('never exceeds the positional cap', () => {
    const owned = Array.from({ length: POSITION_CAP.QB }, (_, i) => ({ id: `q${i}`, pos: 'QB' }));
    const qbOnly = [{ id: 'x1', pos: 'QB' }, { id: 'x2', pos: 'QB' }, { id: 'x3', pos: 'WR' }];
    expect(botPick(qbOnly, { need: { WR: 1 }, owned, rng })).toBe('x3');
  });

  // ⚠️ A kicker in round two reads as a broken board, not a bold strategy.
  it('defers kickers and defences while starters are unfilled', () => {
    const board = [{ id: 'k1', pos: 'K' }, { id: 'd1', pos: 'DEF' }, { id: 'w1', pos: 'WR' }];
    expect(botPick(board, { need: { WR: 1, K: 1, DEF: 1 }, owned: [], rng })).toBe('w1');
  });

  it('will finally take a kicker once nothing else is needed', () => {
    const board = [{ id: 'k1', pos: 'K' }];
    expect(botPick(board, { need: { K: 1 }, owned: [], rng })).toBe('k1');
  });

  it('returns null on an empty board rather than throwing', () => {
    expect(botPick([], { need: {}, owned: [], rng })).toBe(null);
  });
});

describe('a whole mock draft', () => {
  it('puts the human in the seat they chose', () => {
    expect(mock({ slot: 1 }).myTeam).toBe('m1');
    expect(mock({ slot: 7 }).myTeam).toBe('m7');
  });

  it('clamps an impossible seat rather than seating nobody', () => {
    expect(mock({ slot: 99 }).myTeam).toBe('m12');
    expect(mock({ slot: 0 }).myTeam).toBe('m1');
  });

  it('starts on the clock at pick one', () => {
    expect(onTheClock(mock()).overall).toBe(1);
  });

  it('runs bots up to the human and then stops', () => {
    const m = runBotsUntilMyTurn(mock({ slot: 5 }));
    expect(onTheClock(m).owner).toBe('m5');
    expect(Object.keys(m.draft.picks)).toHaveLength(4);
  });

  it('does nothing when the human is already on the clock', () => {
    const m = mock({ slot: 1 });
    expect(Object.keys(runBotsUntilMyTurn(m).draft.picks)).toHaveLength(0);
  });

  it('never drafts the same player twice', () => {
    let m = mock({ slot: 1 });
    for (let i = 0; i < 40 && !isComplete(m); i++) {
      m = runBotsUntilMyTurn(m);
      const avail = availableIn(m);
      if (!avail.length || isComplete(m)) break;
      m = pick(m, avail[0].id);
    }
    const ids = Object.values(m.draft.picks).map((p) => String(p.playerId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is reproducible for a seed and different for another', () => {
    const board = (seed) => Object.values(runBotsUntilMyTurn(mock({ slot: 12, seed })).draft.picks)
      .map((p) => String(p.playerId)).join(',');
    expect(board(7)).toBe(board(7));
    expect(board(7)).not.toBe(board(99));
  });

  // ⚠️ The property that makes a rehearsal useful: bots build plausible rosters.
  it('gives every bot a sane roster rather than six quarterbacks', () => {
    let m = mock({ slot: 1 });
    let guard = 300;
    while (!isComplete(m) && guard-- > 0) {
      m = runBotsUntilMyTurn(m);
      if (isComplete(m)) break;
      const avail = availableIn(m);
      if (!avail.length) break;
      m = pick(m, avail[0].id);
    }
    // ⚠️ BOTS ONLY. The "human" in this loop takes best-available blindly, caps
    // and all — which is a thing a real person can do and the engine must allow.
    // Asserting on their roster would test the test.
    for (const team of m.teamIds.filter((t) => t !== m.myTeam)) {
      const counts = {};
      for (const r of rosterOf(m, team)) counts[r.pos] = (counts[r.pos] ?? 0) + 1;
      expect(counts.QB ?? 0).toBeLessThanOrEqual(POSITION_CAP.QB);
      expect(counts.K ?? 0).toBeLessThanOrEqual(POSITION_CAP.K);
      expect(counts.DEF ?? 0).toBeLessThanOrEqual(POSITION_CAP.DEF);
    }
  });

  it('terminates on an exhausted board rather than spinning', () => {
    const short = createMock({
      teams: 4, rounds: 15, slot: 1, rosterPositions: ROSTER,
      ranking: RANKING.slice(0, 3), positionOf, seed: 3,
    });
    expect(() => runBotsUntilMyTurn(short)).not.toThrow();
  });
});

describe('gradeDrafts', () => {
  const graded = (valueOf) => {
    let m = mock({ slot: 1 });
    let guard = 300;
    while (!isComplete(m) && guard-- > 0) {
      m = runBotsUntilMyTurn(m);
      if (isComplete(m)) break;
      const a = availableIn(m);
      if (!a.length) break;
      m = pick(m, a[0].id);
    }
    return gradeDrafts(m, valueOf);
  };
  // Value falls off with ranking position, like a real board.
  const byRank = (id) => Math.max(0, 300 - RANKING.indexOf(String(id)));

  it('grades every team exactly once', () => {
    const g = graded(byRank);
    expect(g).toHaveLength(12);
    expect(new Set(g.map((x) => x.teamId)).size).toBe(12);
  });

  it('ranks them best first', () => {
    const totals = graded(byRank).map((x) => x.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('gives the best draft the top grade and the worst the bottom one', () => {
    const g = graded(byRank);
    expect(g[0].grade).toBe('A+');
    expect(g[g.length - 1].grade).toBe('C');
  });

  // ⚠️ Missing values count as ZERO, not skipped — a team that drafted unranked
  // players is scored for having done so, rather than quietly excused.
  it('counts an unvalued pick as nothing rather than ignoring it', () => {
    const g = graded(() => undefined);
    expect(g.every((x) => x.total === 0)).toBe(true);
  });

  // ⚠️ THE OUTLIER CASE THAT BROKE MIN-MAX. One team taking the best player
  // available every single pick pushed every other total near the floor, and a
  // room of twelve real drafts reported one A and eleven C's.
  it('still spreads the field when one team dominates', () => {
    const g = graded(byRank);
    const grades = new Set(g.map((x) => x.grade));
    expect(grades.size).toBeGreaterThanOrEqual(4);
  });

  // ⚠️ A dead-flat field must not divide by zero.
  it('gives everyone the same grade when every draft is identical', () => {
    const g = graded(() => 1);
    expect(new Set(g.map((x) => x.grade)).size).toBe(1);
  });
});

describe('simulating on the human\'s behalf', () => {
  // ⚠️ THE REAL RANKING AND THE REAL PLAYER INDEX, not an invented board. A
  // hand-built fixture hid this bug once already: given 40 kickers against 120
  // skill players it is the BOARD that forces kicker picks, and the test measures
  // the fixture rather than the code.
  //
  // The shipped ranking is 400 players — WR 150, TE 75, RB 73, K 42, DEF 32,
  // QB 28 — and the detail that matters is where the junk sits: the first KICKER
  // is at index 25 and the first DEFENCE at 26. So in a 12-team draft the raw
  // top of the board IS a kicker by round three, which is exactly how a roster
  // ended up with six of them.
  const rankFile = JSON.parse(readFileSync(new URL('../assets/draft-ranking.json', import.meta.url), 'utf8'));
  const index = JSON.parse(readFileSync(new URL('../assets/players.index.json', import.meta.url), 'utf8'));
  const ranking = rankFile.ppr;
  const positionOf = (id) => (index[String(id)] || {}).p ?? null;

  const ROSTER = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
    'BN', 'BN', 'BN', 'BN', 'BN'];

  const makeMock = () => createMock({
    teams: 12, rounds: ROSTER.length, slot: 1, rosterPositions: ROSTER,
    ranking, positionOf, seed: 7,
  });

  /** Drive a whole draft the way the Simulate button does. */
  const runWholeDraft = () => {
    let m = runBotsUntilMyTurn(makeMock());
    for (let guard = 0; guard < 400 && !isComplete(m); guard += 1) {
      const avail = availableIn(m);
      if (avail.length === 0) break;
      const mine = rosterOf(m, m.myTeam);
      const chosen = bestPickFor(avail, {
        need: remainingNeed(m.rosterPositions, mine.map((o) => o.pos)),
        owned: mine,
      });
      if (!chosen) break;
      m = runBotsUntilMyTurn(pick(m, chosen));
    }
    return m;
  };

  const countBy = (roster) => roster.reduce((acc, r) => {
    acc[r.pos] = (acc[r.pos] ?? 0) + 1;
    return acc;
  }, {});

  // 🔴 THE REPORTED FAILURE. "Simulate" took `available[0]` while every bot at the
  // same table picked through botPick. With a kicker sitting 25th on the real
  // board, the human's roster came back with six kickers and four defences.
  it('never stockpiles kickers or defences', () => {
    const counts = countBy(rosterOf(runWholeDraft(), 'm1'));
    expect(counts.K ?? 0).toBeLessThanOrEqual(POSITION_CAP.K);
    expect(counts.DEF ?? 0).toBeLessThanOrEqual(POSITION_CAP.DEF);
  });

  // The other half of the same report: WR/WR, TE and FLEX were left empty.
  it('fills every starting slot the roster asks for', () => {
    const roster = rosterOf(runWholeDraft(), 'm1');
    const counts = countBy(roster);
    expect(counts.QB ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.RB ?? 0).toBeGreaterThanOrEqual(2);
    expect(counts.WR ?? 0).toBeGreaterThanOrEqual(3);
    expect(counts.TE ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.K ?? 0).toBe(1);
    expect(counts.DEF ?? 0).toBe(1);
    // …and something spare for the FLEX, over and above those starters.
    const flexEligible = (counts.RB ?? 0) + (counts.WR ?? 0) + (counts.TE ?? 0);
    expect(flexEligible).toBeGreaterThanOrEqual(2 + 3 + 1 + 1);
    expect(roster.length).toBe(ROSTER.length);
  });

  // The bench has to be worth something: every pick after the starters are full
  // should be a player who can actually score, not the dregs of the board.
  it('spends the whole bench on scoring positions', () => {
    const roster = rosterOf(runWholeDraft(), 'm1');
    const junk = roster.filter((r) => r.pos === 'K' || r.pos === 'DEF').length;
    expect(junk).toBe(2); // exactly the one starting K and the one starting DEF
  });

  // ⚠️ THE OLD BEHAVIOUR, PINNED AS A COUNTER-EXAMPLE. If `available[0]` were
  // still good enough there would be nothing to fix — this proves the naive pick
  // really does produce the reported roster on the real board.
  it('beats the naive available[0] it replaced', () => {
    let m = runBotsUntilMyTurn(makeMock());
    for (let guard = 0; guard < 400 && !isComplete(m); guard += 1) {
      const avail = availableIn(m);
      if (avail.length === 0) break;
      m = runBotsUntilMyTurn(pick(m, avail[0].id));
    }
    const naive = countBy(rosterOf(m, 'm1'));
    expect((naive.K ?? 0) + (naive.DEF ?? 0)).toBeGreaterThan(2);
  });

  // ⚠️ DETERMINISTIC, unlike a bot's. Somebody asking the computer to pick for
  // them wants the best answer available, not a plausible sample of one.
  it('makes the same choice every time for the same board', () => {
    const avail = availableIn(makeMock());
    const args = { need: remainingNeed(ROSTER, []), owned: [] };
    const first = bestPickFor(avail, args);
    for (let i = 0; i < 5; i += 1) expect(bestPickFor(avail, args)).toBe(first);
  });

  // Early on there is no reason to reach — the best player available IS the pick.
  it('takes the best available with an empty roster', () => {
    const avail = availableIn(makeMock());
    expect(bestPickFor(avail, { need: remainingNeed(ROSTER, []), owned: [] })).toBe(avail[0].id);
  });

  it('refuses to invent a pick from an empty board', () => {
    expect(bestPickFor([], { need: {}, owned: [] })).toBe(null);
  });
});
