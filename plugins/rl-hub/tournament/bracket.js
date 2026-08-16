// tournament/bracket.js — single-elimination bracket maths. Pure: no DOM, no module state,
// no storage. Participants are passed in and returned, never read from a global.
//
// ⚠️ SEEDING IS NOT "1 vs N, 2 vs N-1 down the list". That ordering looks right and is
// wrong: propagation pairs adjacent matches, so listing 1v8, 2v7, 3v6, 4v5 puts seeds 1 and
// 2 in the same half and they meet in the SEMIFINAL. Correct bracket order recursively
// splits the field so the top two seeds can only meet in the final — which is the entire
// point of seeding by MMR.

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/// Standard single-elimination seed order for a bracket of `size` slots.
/// Returns 1-based seed numbers in match order: [1, 8, 4, 5, 2, 7, 3, 6] for size 8,
/// read as pairs — 1v8, 4v5, 2v7, 3v6.
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const round = order.length * 2;
    const next = [];
    for (const s of order) {
      next.push(s, round + 1 - s);
    }
    order = next;
  }
  return order;
}

export function roundName(totalPlayers) {
  if (totalPlayers <= 2) return 'Final';
  if (totalPlayers <= 4) return 'Semifinals';
  if (totalPlayers <= 8) return 'Quarterfinals';
  if (totalPlayers <= 16) return 'Round of 16';
  return `Round of ${totalPlayers}`;
}

const idOf = (p) => (p ? p.dissentUserId : null);

function emptyMatch() {
  return { player1: null, player2: null, score1: null, score2: null, winnerId: null };
}

function resolveByes(match) {
  if (match.player1 && !match.player2) match.winnerId = idOf(match.player1);
  if (!match.player1 && match.player2) match.winnerId = idOf(match.player2);
  return match;
}

/// `participants` must already be in seed order — index 0 is seed 1.
export function buildBracket(participants) {
  const size = Math.max(2, nextPow2(participants.length));
  const bySeed = seedOrder(size).map((seed) => participants[seed - 1] ?? null);

  const first = [];
  for (let i = 0; i < size; i += 2) {
    first.push(resolveByes({ ...emptyMatch(), player1: bySeed[i], player2: bySeed[i + 1] }));
  }

  const rounds = [{ name: roundName(size), matches: first }];
  let count = first.length;
  while (count > 1) {
    count = count / 2;
    rounds.push({ name: roundName(count * 2), matches: Array.from({ length: count }, emptyMatch) });
  }
  return rounds;
}

export function propagateWinners(rounds, participants) {
  const find = (id) => participants.find((p) => p && p.dissentUserId === id) ?? null;

  for (let r = 0; r < rounds.length - 1; r++) {
    const cur = rounds[r].matches;
    const next = rounds[r + 1].matches;
    for (let i = 0; i < next.length; i++) {
      const a = cur[i * 2];
      const b = cur[i * 2 + 1];
      const m = next[i];
      m.player1 = a.winnerId ? find(a.winnerId) : null;
      m.player2 = b.winnerId ? find(b.winnerId) : null;

      // A slot that lost its occupant — a result was corrected — must lose its result too,
      // or a stale winnerId keeps propagating a player who is no longer in this match.
      if (m.winnerId && m.winnerId !== idOf(m.player1) && m.winnerId !== idOf(m.player2)) {
        m.winnerId = null;
        m.score1 = null;
        m.score2 = null;
      }

      // Only auto-advance a bye once BOTH feeder matches have resolved. Advancing while the
      // other side is still undecided declares a walkover that has not happened.
      const bothDecided = Boolean(a.winnerId) && Boolean(b.winnerId);
      const bothFeedersEmpty = !a.player1 && !a.player2 && !b.player1 && !b.player2;
      if (!m.winnerId && (bothDecided || bothFeedersEmpty)) resolveByes(m);
    }
  }
  return rounds;
}

export function champion(rounds, participants) {
  const finalRound = rounds[rounds.length - 1];
  const finalMatch = finalRound?.matches?.[0];
  if (!finalMatch?.winnerId) return null;
  return participants.find((p) => p && p.dissentUserId === finalMatch.winnerId) ?? null;
}

/// Validates a reported score for a best-of series. Returns { ok, error }.
export function validateScore(s1, s2, bestOf) {
  if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0) {
    return { ok: false, error: 'Scores must be whole numbers.' };
  }
  const target = Math.ceil(bestOf / 2);
  if (s1 === s2) return { ok: false, error: 'A series cannot end level.' };
  const winner = Math.max(s1, s2);
  const loser = Math.min(s1, s2);
  if (winner !== target) return { ok: false, error: `In a best of ${bestOf}, the winner must reach ${target}.` };
  if (loser >= target) return { ok: false, error: `The loser cannot reach ${target}.` };
  if (winner + loser > bestOf) return { ok: false, error: `A best of ${bestOf} cannot run to ${winner + loser} games.` };
  return { ok: true, error: null };
}
