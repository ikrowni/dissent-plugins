// core/fantasy.js — pure fantasy logic. No DOM, no fetches.
//
// Everything here is a function of already-parsed Sleeper payloads, so the whole scoring
// and win-probability model is unit-testable against a recorded league.

const KEY_BY_TYPE = { PPR: 'ppr', 'Half PPR': 'halfPpr', Standard: 'std' };

/** Which projection field this league actually scores by.
 *  Sleeper ships all three variants per player, so the league's scoring settings pick one
 *  rather than the hub guessing. Unknown leagues fall back to PPR, the common case. */
export function scoringKey(league) {
  return KEY_BY_TYPE[league?.scoringType] ?? 'ppr';
}

/**
 * One row per roster SLOT, in the league's own slot order.
 *
 * Slot order matters: Sleeper's `starters` array is positional — index i is the player in
 * `roster_positions`' i-th non-bench slot. An empty slot is kept as a row rather than
 * dropped, otherwise every slot after a hole is mislabelled (a bye-week QB would silently
 * relabel the whole lineup).
 */
export function buildLineup(side, league, { projections = {}, key = 'ppr', index = null } = {}) {
  if (!side) return [];
  const slots = league?.starterSlots ?? [];
  return slots.map((slot, i) => {
    const id = side.starters?.[i];
    // Sleeper writes "0" for an unfilled slot, not null.
    if (!id || id === '0') {
      return {
        slot, playerId: null, empty: true, name: '—', position: null, teamAbbr: null,
        actual: 0, projected: 0, played: false, espnId: null,
      };
    }
    // core/players.js exposes get(sleeperId) — NOT bySleeperId. It returns null until
    // load() has resolved, which is why every field below has a fallback.
    const p = index?.get?.(id) ?? null;
    const actual = Number(side.playerPoints?.[id] ?? 0);
    const projected = Number(projections?.[String(id)]?.[key] ?? 0);
    return {
      slot,
      playerId: String(id),
      empty: false,
      name: p?.name ?? `Player ${id}`,
      position: p?.position ?? null,
      teamAbbr: p?.teamAbbr ?? null,
      espnId: p?.espnId ?? null,
      actual: Number.isFinite(actual) ? actual : 0,
      projected: Number.isFinite(projected) ? projected : 0,
      // A player who has scored has demonstrably played. Zero is ambiguous (a real 0.0 is
      // possible), so the view refines this with live NFL game state where it has it.
      played: actual > 0,
    };
  });
}

/** Actual, still-to-come, and the projected final for one side of a matchup. */
export function sideTotals(side, rows) {
  const r2 = (n) => Math.round(n * 100) / 100;
  // Trust Sleeper's own total for `actual` when it has one — it is authoritative and
  // includes scoring the per-player map can lag on.
  const summed = (rows ?? []).reduce((a, x) => a + (x.actual ?? 0), 0);
  const actual = Number.isFinite(side?.points) && side.points > 0 ? side.points : summed;
  const remaining = (rows ?? [])
    .filter((x) => !x.empty && !x.played)
    .reduce((a, x) => a + (x.projected ?? 0), 0);
  return { actual: r2(actual), remaining: r2(remaining), projectedFinal: r2(actual + remaining) };
}

/**
 * Win probability for a fantasy matchup, as a whole percentage.
 *
 * A normal approximation, not a simulation. Each side's final is treated as normally
 * distributed around its projected final, with a spread that shrinks as players finish:
 * with 90 projected points still to come the outcome is wide open, with 5 it is nearly
 * settled, and with 0 it is decided. SIGMA_SHARE is calibrated so a 10-point lead early
 * is roughly a 55-60% edge and the same lead late is a near-lock, which matches how these
 * read on Sleeper and ESPN.
 *
 * Deliberately not Monte Carlo: this runs on every poll for every matchup on screen, and a
 * closed form costs nothing. Wave 3B's season-long playoff odds is the place for a sim.
 */
const SIGMA_SHARE = 0.38; // stdev as a share of the points still to be scored
const SIGMA_FLOOR = 0.5; // keeps the curve from becoming a step function at remaining=0

export function winProbability(a, b) {
  const meanDiff = (a?.projectedFinal ?? 0) - (b?.projectedFinal ?? 0);
  const varSum = ((a?.remaining ?? 0) + (b?.remaining ?? 0)) * SIGMA_SHARE;
  const sigma = Math.max(varSum, SIGMA_FLOOR);
  if (sigma <= SIGMA_FLOOR && Math.abs(meanDiff) > 0.01) return meanDiff > 0 ? 100 : 0;
  // Logistic approximation to the normal CDF — within ~1% and needs no erf.
  const p = 1 / (1 + Math.exp((-meanDiff * 1.702) / sigma));
  return Math.max(0, Math.min(100, Math.round(p * 100)));
}

/** Points left on the bench: the optimal lineup's ceiling minus what was actually scored.
 *  Null when Sleeper reports no potential — better a hidden callout than a wrong one. */
export function benchPoints(roster) {
  const pot = Number(roster?.potentialPoints ?? 0);
  const got = Number(roster?.pointsFor ?? 0);
  if (!Number.isFinite(pot) || pot <= 0) return null;
  return Math.round(Math.max(0, pot - got) * 100) / 100;
}
