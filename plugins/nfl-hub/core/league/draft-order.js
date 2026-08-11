// core/league/draft-order.js — who picks, and when.
//
// PURE. Order generation is separated from the draft state machine because it is
// the part with real arithmetic in it, and because traded picks make "whose pick
// is this?" a different question from "whose slot is this?".

/** Draft types. Auction is deliberately absent — see the design's non-goals. */
export const DRAFT_TYPE = Object.freeze({
  SNAKE: 'snake',
  LINEAR: 'linear',
  /**
   * 3rd Round Reversal: a snake that reverses AGAIN at round three.
   *
   * In a plain snake the team holding 1.01 ends round two and opens round
   * three, taking two picks back to back — the imbalance 3RR exists to remove.
   * Reversing again hands round three to whoever picked LAST in round one, and
   * the draft snakes normally from there with its parity flipped.
   */
  THIRD_ROUND_REVERSAL: 'third_round_reversal',
});

/**
 * Does this round run backwards?
 *
 * ⚠️ THE PARITY FLIPS AT ROUND THREE and stays flipped — 3RR is not a one-round
 * special case. Rounds 1-2 behave like a snake (even rounds reversed); from
 * round 3 on, ODD rounds are the reversed ones.
 */
function roundIsReversed(round, type) {
  if (type === DRAFT_TYPE.LINEAR) return false;
  if (type === DRAFT_TYPE.THIRD_ROUND_REVERSAL && round >= 3) return round % 2 === 1;
  if (type === DRAFT_TYPE.SNAKE || type === DRAFT_TYPE.THIRD_ROUND_REVERSAL) {
    return round % 2 === 0;
  }
  return false;
}

/**
 * Generate the full pick order.
 *
 * `draftOrder` is the round-one order: an array of team ids, first pick first.
 *
 * Each entry is:
 *   { overall, round, pickInRound, slot, owner }
 *
 * ⚠️ `slot` AND `owner` ARE DIFFERENT THINGS. `slot` is the team whose draft
 * position this is and never changes; `owner` is who actually makes the pick,
 * and in a league with pick trading they diverge. Collapsing them works
 * perfectly until the first traded pick, then silently gives the pick to the
 * wrong team.
 *
 * ⚠️ SNAKE REVERSES ON ODD-INDEXED ROUNDS (round 2, 4, …), and `round` here is
 * 1-based. An off-by-one makes round 2 run forwards, which looks right in a
 * 2-round test and is wrong for every real draft.
 */
export function generateOrder(draftOrder, rounds, type = DRAFT_TYPE.SNAKE) {
  const teams = Array.isArray(draftOrder) ? draftOrder.map(String) : [];
  const n = teams.length;
  const picks = [];
  if (n === 0 || !Number.isInteger(rounds) || rounds < 1) return picks;

  for (let round = 1; round <= rounds; round++) {
    const reversed = roundIsReversed(round, type);
    const order = reversed ? [...teams].reverse() : teams;
    order.forEach((team, i) => {
      picks.push({
        overall: (round - 1) * n + i + 1,
        round,
        pickInRound: i + 1,
        slot: team,
        owner: team,
      });
    });
  }
  return picks;
}

/**
 * Reassign picks that have been traded.
 *
 * `trades` is [{ round, slot, to }] — "the pick belonging to `slot` in `round`
 * now belongs to `to`". That addressing is deliberate: a traded pick is agreed
 * as "your 2027 second-rounder", not as an overall number, and overall numbers
 * are not even known until the order is set.
 *
 * Unknown picks are ignored rather than throwing: a stale trade referencing a
 * round that no longer exists must not stop a draft from starting.
 */
export function applyTradedPicks(picks, trades = []) {
  const byKey = new Map();
  for (const t of trades) {
    if (!t) continue;
    byKey.set(`${t.round}:${String(t.slot)}`, String(t.to));
  }
  return picks.map((p) => {
    const owner = byKey.get(`${p.round}:${p.slot}`);
    return owner ? { ...p, owner } : p;
  });
}

/** The pick at a 1-based overall number, or null. */
export function pickAt(picks, overall) {
  return picks.find((p) => p.overall === overall) ?? null;
}

/**
 * How many picks each team owns, for a draft board's "picks remaining" column.
 * Counts by OWNER, so a traded pick counts for whoever will actually make it.
 */
export function picksByOwner(picks) {
  const out = {};
  for (const p of picks) out[p.owner] = (out[p.owner] ?? 0) + 1;
  return out;
}

/**
 * A team's draft position in round one, 1-based, or null if it has no slot.
 * Read from `slot`, not `owner` — a team that traded away its first-rounder
 * still occupies its position in the order.
 */
export function draftSlotOf(picks, teamId) {
  const first = picks.find((p) => p.round === 1 && p.slot === String(teamId));
  return first ? first.pickInRound : null;
}
