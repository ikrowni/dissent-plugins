// core/league/scoring.js — turning raw NFL stats into fantasy points.
//
// PURE. No DOM, no fetches, no host SDK. This module is imported by BOTH halves
// of the plugin: the browser client previews optimistically, the server module
// enforces. One implementation, so the two cannot disagree — which is the whole
// reason it must stay free of I/O.

/**
 * Score one stat line under one league's scoring settings.
 *
 * ⚠️ SCORING IS A DOT PRODUCT, and that is not a simplification — it is how
 * Sleeper's data is actually shaped. Settings are a flat map of stat key →
 * points per unit, and the stats payload carries a matching key for every one,
 * INCLUDING the tiered bonuses: a defense that allowed 10 points has
 * `pts_allow_7_13: 1.0` in its stat line, so the tier needs no branching. Verified
 * against a recorded week: 354 of 354 scored entities reproduce Sleeper's own
 * totals exactly.
 *
 * Unknown stat keys are ignored rather than throwing: the payload carries far
 * more fields than any league scores (`pass_rtg`, `off_yd_per_play`, snap counts),
 * and a new one appearing upstream must never break a scoring run mid-season.
 */
export function scoreStatLine(stats, settings) {
  if (!stats || !settings) return 0;
  let total = 0;
  for (const key of Object.keys(stats)) {
    const weight = settings[key];
    if (typeof weight !== 'number') continue;
    const value = Number(stats[key]);
    if (!Number.isFinite(value)) continue;
    total += value * weight;
  }
  // Two decimals is what every fantasy platform displays and what Sleeper's own
  // totals carry. Rounding here rather than at the view keeps a season total from
  // drifting away from the sum of its weeks.
  return Math.round(total * 100) / 100;
}

/**
 * Score every entity in a week's stats payload.
 *
 * Returns a plain object keyed exactly as the payload is, so callers keep
 * whatever id space they came in with.
 */
export function scoreWeek(statsByEntity, settings) {
  const out = {};
  if (!statsByEntity) return out;
  for (const [id, line] of Object.entries(statsByEntity)) {
    out[id] = scoreStatLine(line, settings);
  }
  return out;
}

/**
 * ⚠️ A SLEEPER STATS PAYLOAD HAS THREE KEY NAMESPACES, not one. Measured against
 * a recorded week (2,142 entries):
 *
 *   - 2,086 numeric ids  → individual players
 *   -    28 `TEAM_BUF`   → whole-team OFFENSIVE aggregates; not a fantasy entity
 *   -    28 `BUF`        → the team DEFENSE (DST), carrying sack/int/pts_allow_*
 *
 * Scoring a `TEAM_*` row as if it were a roster slot yields a plausible-looking
 * ~100-point number, which is exactly the kind of wrong that survives review.
 */
export function classifyStatKey(id) {
  const key = String(id);
  if (/^\d+$/.test(key)) return 'player';
  if (key.startsWith('TEAM_')) return 'team_offense';
  return 'defense';
}

/** The scorable entities: players and defenses, never team-offense aggregates. */
export function scorableEntities(statsByEntity) {
  return Object.keys(statsByEntity ?? {}).filter((id) => classifyStatKey(id) !== 'team_offense');
}

/**
 * A working PPR configuration, for seeding a new league.
 *
 * ⚠️ TAKEN FROM A REAL LEAGUE, NOT INVENTED. These are the settings of a recorded
 * public PPR league, kept verbatim so every value is one that a real league
 * actually ran. Do not "tidy" a value here without a payload to check it against.
 *
 * ⚠️ It is NOT identical to Sleeper's platform defaults. That league customises
 * `pts_allow_14_20` (1, where Sleeper's default is 0) — which is precisely how we
 * learned that the `pts_ppr` field in the global stats payload is computed under
 * SLEEPER'S DEFAULTS and not under any particular league's settings. See the note
 * on `pts_ppr` below.
 */
export const PPR_SCORING = Object.freeze({
  // Passing
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  // Rushing
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  // Receiving
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  // Fumbles
  fum: 0, fum_lost: -2, fum_rec: 2, fum_rec_td: 6,
  // Kicking
  fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5,
  fgmiss: -1, xpm: 1, xpmiss: -1,
  // Defense / special teams
  sack: 1, int: 2, safe: 2, def_td: 6, blk_kick: 2, ff: 1,
  def_st_ff: 1, def_st_fum_rec: 1, def_st_td: 6,
  st_ff: 1, st_fum_rec: 1, st_td: 6,
  // Points allowed — tiers, applied via the payload's own indicator fields
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
  pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
});

/** Half-PPR and standard differ from PPR only in the per-reception value. */
export const HALF_PPR_SCORING = Object.freeze({ ...PPR_SCORING, rec: 0.5 });
export const STANDARD_SCORING = Object.freeze({ ...PPR_SCORING, rec: 0 });

/**
 * ⚠️ NEVER SCORE A NATIVE LEAGUE FROM `pts_ppr` / `pts_std` / `pts_half_ppr`.
 *
 * Those fields exist in the stats payload and are tempting, but they are computed
 * under SLEEPER'S DEFAULT scoring — the payload is global and knows nothing about
 * any league. Proven: with a recorded league's settings, 348 of 354 entities match
 * those fields and the 6 that do not are exactly the defenses affected by that
 * league's one customised tier. A league that customises anything at all would be
 * silently mis-scored, and only for the handful of players the setting touches —
 * which is the hardest kind of bug to notice.
 *
 * This function exists to be called in tests, and to name the trap in code.
 */
export function sleeperDefaultPoints(statLine, key = 'pts_ppr') {
  return Number(statLine?.[key] ?? 0);
}
