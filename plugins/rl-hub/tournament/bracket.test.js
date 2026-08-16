import { describe, it, expect } from 'vitest';
import {
  nextPow2, seedOrder, buildBracket, propagateWinners, champion, validateScore, roundName,
} from './bracket.js';

/// Seed n is the player named `p{n}` with id `u{n}`. Index 0 is seed 1.
const field = (n) => Array.from({ length: n }, (_, i) => ({
  dissentUserId: `u${i + 1}`, displayName: `p${i + 1}`, mmr: 1000 - i,
}));

const win = (match, who) => { match.winnerId = who; };

describe('nextPow2', () => {
  it.each([[1, 1], [2, 2], [3, 4], [5, 8], [8, 8], [9, 16]])('%i → %i', (a, b) => {
    expect(nextPow2(a)).toBe(b);
  });
});

describe('seedOrder', () => {
  it('pairs 1 against 2 for a two-slot bracket', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
  });

  it('puts 1 and 2 in opposite halves of a four-slot bracket', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
  });

  it('produces the standard eight-slot order', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('pairs every match to a constant sum, which is what makes it a valid bracket', () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const o = seedOrder(size);
      for (let i = 0; i < o.length; i += 2) {
        expect(o[i] + o[i + 1]).toBe(size + 1);
      }
    }
  });

  it('uses every seed exactly once', () => {
    const o = seedOrder(16);
    expect([...o].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
});

describe('buildBracket', () => {
  it('creates the right number of rounds', () => {
    expect(buildBracket(field(8))).toHaveLength(3);
    expect(buildBracket(field(16))).toHaveLength(4);
  });

  it('names the rounds from the far end', () => {
    const r = buildBracket(field(8));
    expect(r.map((x) => x.name)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
  });

  it('opens seed 1 against the lowest seed', () => {
    const r = buildBracket(field(8));
    expect(r[0].matches[0].player1.displayName).toBe('p1');
    expect(r[0].matches[0].player2.displayName).toBe('p8');
  });

  // THE REGRESSION. The previous implementation listed 1v8, 2v7, 3v6, 4v5, and propagation
  // pairs adjacent matches — so seeds 1 and 2 met in the semifinal and MMR seeding was
  // pointless. They must be able to meet only in the final.
  it('keeps the top two seeds apart until the final', () => {
    const players = field(8);
    const rounds = buildBracket(players);

    // Higher seed wins every match.
    for (const round of rounds) {
      for (const m of round.matches) {
        if (!m.player1 || !m.player2) continue;
        const better = Number(m.player1.displayName.slice(1)) < Number(m.player2.displayName.slice(1))
          ? m.player1 : m.player2;
        win(m, better.dissentUserId);
      }
      propagateWinners(rounds, players);
    }

    const final = rounds[rounds.length - 1].matches[0];
    const names = [final.player1?.displayName, final.player2?.displayName].sort();
    expect(names).toEqual(['p1', 'p2']);
  });

  it('gives byes to the top seeds when the field is not a power of two', () => {
    const rounds = buildBracket(field(5));
    expect(rounds[0].matches).toHaveLength(4);
    // Seed 1 draws the empty 8th slot and advances.
    const seed1Match = rounds[0].matches.find((m) => m.player1?.displayName === 'p1');
    expect(seed1Match.player2).toBeNull();
    expect(seed1Match.winnerId).toBe('u1');
  });

  it('handles a two-player field without crashing', () => {
    const rounds = buildBracket(field(2));
    expect(rounds).toHaveLength(1);
    expect(rounds[0].name).toBe('Final');
  });
});

describe('propagateWinners', () => {
  it('advances winners into the next round', () => {
    const players = field(4);
    const rounds = buildBracket(players);
    win(rounds[0].matches[0], 'u1');
    win(rounds[0].matches[1], 'u2');
    propagateWinners(rounds, players);
    const ids = [rounds[1].matches[0].player1.dissentUserId, rounds[1].matches[0].player2.dissentUserId];
    expect(ids.sort()).toEqual(['u1', 'u2']);
  });

  it('does not declare a walkover while the other side is undecided', () => {
    const players = field(4);
    const rounds = buildBracket(players);
    win(rounds[0].matches[0], 'u1');
    propagateWinners(rounds, players);
    // u1 is in the final, u2/u3 is unresolved — the final must NOT be awarded to u1.
    expect(rounds[1].matches[0].winnerId).toBeNull();
  });

  it('clears a downstream result when an upstream result is corrected', () => {
    const players = field(4);
    const rounds = buildBracket(players);
    win(rounds[0].matches[0], 'u1');
    win(rounds[0].matches[1], 'u2');
    propagateWinners(rounds, players);
    win(rounds[1].matches[0], 'u1');
    rounds[1].matches[0].score1 = 2;

    // The organiser corrects round 1: u4 actually beat u1.
    win(rounds[0].matches[0], 'u4');
    propagateWinners(rounds, players);

    // u1 is no longer in the final, so the final cannot still record u1 as winner.
    expect(rounds[1].matches[0].winnerId).toBeNull();
    expect(rounds[1].matches[0].score1).toBeNull();
  });

  it('is idempotent', () => {
    const players = field(8);
    const rounds = buildBracket(players);
    win(rounds[0].matches[0], 'u1');
    propagateWinners(rounds, players);
    const once = JSON.stringify(rounds);
    propagateWinners(rounds, players);
    expect(JSON.stringify(rounds)).toBe(once);
  });
});

describe('champion', () => {
  it('is null until the final is decided', () => {
    const players = field(4);
    expect(champion(buildBracket(players), players)).toBeNull();
  });

  it('returns the winner of the final', () => {
    const players = field(4);
    const rounds = buildBracket(players);
    win(rounds[0].matches[0], 'u1');
    win(rounds[0].matches[1], 'u2');
    propagateWinners(rounds, players);
    win(rounds[1].matches[0], 'u2');
    expect(champion(rounds, players).displayName).toBe('p2');
  });
});

describe('validateScore', () => {
  it('accepts a legal best-of-three result', () => {
    expect(validateScore(2, 1, 3).ok).toBe(true);
    expect(validateScore(2, 0, 3).ok).toBe(true);
  });

  it('rejects a level series', () => {
    expect(validateScore(1, 1, 3).ok).toBe(false);
  });

  it('rejects a winner short of the target', () => {
    expect(validateScore(1, 0, 3).ok).toBe(false);
  });

  it('rejects a loser who also reached the target', () => {
    expect(validateScore(2, 2, 3).ok).toBe(false);
  });

  it('rejects more games than the series allows', () => {
    expect(validateScore(2, 3, 3).ok).toBe(false);
  });

  it('rejects negatives and non-integers', () => {
    expect(validateScore(-1, 2, 3).ok).toBe(false);
    expect(validateScore(1.5, 2, 3).ok).toBe(false);
    expect(validateScore(NaN, 2, 3).ok).toBe(false);
  });

  it('handles best of one', () => {
    expect(validateScore(1, 0, 1).ok).toBe(true);
    expect(validateScore(1, 1, 1).ok).toBe(false);
  });

  it('handles best of five', () => {
    expect(validateScore(3, 2, 5).ok).toBe(true);
    expect(validateScore(2, 1, 5).ok).toBe(false);
  });

  it('always explains why it refused', () => {
    expect(validateScore(1, 1, 3).error.length).toBeGreaterThan(10);
  });
});

describe('roundName', () => {
  it.each([[2, 'Final'], [4, 'Semifinals'], [8, 'Quarterfinals'], [16, 'Round of 16'], [32, 'Round of 32']])(
    '%i players → %s', (n, name) => expect(roundName(n)).toBe(name),
  );
});
