// core/league/lineup.js — the optimal lineup, and best ball.
//
// PURE. No DOM, no fetches.
//
// ⚠️ THE OPTIMAL LINEUP IS AN ASSIGNMENT PROBLEM, NOT A GREEDY ONE. The obvious
// approach — fill the most restrictive slot first with the best eligible player —
// is exact only when the slots' eligibility sets are NESTED (QB ⊂ SUPER_FLEX,
// RB/WR/TE ⊂ FLEX ⊂ SUPER_FLEX). Sleeper also has REC_FLEX (WR, TE) and
// WRRB_FLEX (RB, WR), which OVERLAP without nesting, and greedy provably loses
// points there: give the only elite WR to REC_FLEX and WRRB_FLEX may be left with
// a replacement-level RB when the reverse assignment scored more.
//
// So this solves it exactly, with the Hungarian algorithm over a
// slots × players cost matrix. It is small — a dozen slots against a few dozen
// players — and the tests check it against exhaustive brute force, which is the
// only way to be sure a "smarter" implementation did not quietly get worse.

import { slotAccepts } from './slots.js';

// A cost no real assignment can reach, standing in for "this player may not
// occupy this slot". Finite rather than Infinity because the algorithm does
// arithmetic on these values and Infinity - Infinity is NaN.
const FORBIDDEN = 1e9;

/**
 * Hungarian algorithm (Kuhn–Munkres), rectangular, minimising total cost.
 *
 * `cost` is 1-indexed [1..n][1..m] with n <= m. Returns `assignment` where
 * assignment[j] is the row matched to column j, or 0 for unmatched.
 *
 * This is the standard potentials formulation. It is dense and unlovely, and it
 * is deliberately confined to this one function so nothing else has to know how
 * it works — callers see `optimalLineup`.
 */
function hungarian(cost, n, m) {
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  return p;
}

/**
 * The highest-scoring legal lineup for one roster.
 *
 * `players` is the ids available to start. `pointsOf(id)` and `positionOf(id)`
 * resolve each one. Returns one row per slot, in slot order, with `playerId`
 * null for a slot nothing could fill.
 *
 * Slots that no available player is eligible for are left EMPTY rather than
 * filled with an ineligible player — a bye-week roster with no kicker must
 * produce an empty K slot, not an illegal lineup.
 */
export function optimalLineup(players, starterSlots, pointsOf, positionOf) {
  const slots = Array.isArray(starterSlots) ? starterSlots : [];
  const ids = [...new Set((players ?? []).map(String))];
  const empty = slots.map((slot) => ({ slot, playerId: null, points: 0 }));
  if (slots.length === 0 || ids.length === 0) return empty;

  const n = slots.length;
  // The matrix must be at least as wide as it is tall. Padding columns are
  // dummies every slot may "take" at FORBIDDEN cost, which is how a slot ends up
  // legitimately unfilled when there are fewer players than slots.
  const m = Math.max(n, ids.length);

  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(FORBIDDEN));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= ids.length; j++) {
      const id = ids[j - 1];
      const position = positionOf?.(id) ?? null;
      if (position && slotAccepts(slots[i - 1], position)) {
        // Minimising cost, so points are negated: the best lineup is the
        // cheapest assignment.
        const pts = Number(pointsOf?.(id) ?? 0);
        cost[i][j] = Number.isFinite(pts) ? -pts : 0;
      }
    }
  }

  const assignment = hungarian(cost, n, m);
  const rows = empty.map((r) => ({ ...r }));
  for (let j = 1; j <= m; j++) {
    const i = assignment[j];
    if (!i || i > n) continue;
    // A slot matched only to a padding column, or matched at FORBIDDEN cost,
    // was never actually fillable.
    if (j > ids.length || cost[i][j] >= FORBIDDEN) continue;
    rows[i - 1] = { slot: slots[i - 1], playerId: ids[j - 1], points: -cost[i][j] };
  }
  return rows;
}

/** Total of an optimal lineup. */
export function optimalPoints(players, starterSlots, pointsOf, positionOf) {
  return round2(optimalLineup(players, starterSlots, pointsOf, positionOf)
    .reduce((sum, r) => sum + r.points, 0));
}

/**
 * Score a lineup the league actually set — the non-best-ball case.
 *
 * Positional: index i is the player in starting slot i. An ineligible or unknown
 * player scores ZERO rather than being skipped, because the alternative silently
 * rewards an illegal lineup with the points of a legal one.
 */
export function setLineupPoints(lineup, starterSlots, pointsOf, positionOf) {
  const slots = Array.isArray(starterSlots) ? starterSlots : [];
  const row = Array.isArray(lineup) ? lineup : [];
  let total = 0;
  const rows = slots.map((slot, i) => {
    const id = row[i];
    if (!id || id === '0') return { slot, playerId: null, points: 0 };
    const position = positionOf?.(String(id)) ?? null;
    if (!position || !slotAccepts(slot, position)) {
      return { slot, playerId: String(id), points: 0, illegal: true };
    }
    const pts = Number(pointsOf?.(String(id)) ?? 0);
    const points = Number.isFinite(pts) ? pts : 0;
    total += points;
    return { slot, playerId: String(id), points };
  });
  return { rows, total: round2(total) };
}

/**
 * What a team scores this week.
 *
 * ⚠️ Best ball ignores the submitted lineup ENTIRELY and always scores the
 * optimal one — that is the whole format. Falling back to a set lineup when one
 * happens to exist would make a best-ball league score differently depending on
 * whether a manager bothered to log in.
 */
export function weeklyPoints({ players, lineup, starterSlots, pointsOf, positionOf, bestBall = false }) {
  if (bestBall) {
    const rows = optimalLineup(players, starterSlots, pointsOf, positionOf);
    return { rows, total: round2(rows.reduce((s, r) => s + r.points, 0)), bestBall: true };
  }
  return { ...setLineupPoints(lineup, starterSlots, pointsOf, positionOf), bestBall: false };
}

/**
 * Points left on the bench: what an optimal lineup would have scored, minus what
 * the manager actually started. Never negative — the optimum is by definition at
 * least as good as any legal lineup.
 */
export function pointsLeftOnBench({ players, lineup, starterSlots, pointsOf, positionOf }) {
  const best = optimalPoints(players, starterSlots, pointsOf, positionOf);
  const actual = setLineupPoints(lineup, starterSlots, pointsOf, positionOf).total;
  return round2(Math.max(0, best - actual));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
