// core/league/season-clock.js — should this league move to a new week?
//
// PURE, and separated from the tick that calls it precisely so it can be tested.
// The decision has five ways to be wrong and all of them are silent: a league
// that never advances simply stops scoring, and one that advances when it should
// not overwrites a week a commissioner was holding.

/**
 * Decide whether a league should move to the NFL's current week.
 *
 * Returns { advance, to, reason } — `reason` is always populated, because
 * "nothing happened" is the hardest outcome to debug without one.
 *
 * `state` is Sleeper's /v1/state/nfl: { week, season, season_type }.
 */
export function shouldAdvance(meta, state) {
  const no = (reason) => ({ advance: false, to: null, reason });

  if (!meta) return no('no league');
  if (meta.settings?.autoAdvanceWeek === false) return no('auto-advance is off for this league');

  const type = String(state?.season_type ?? '');
  // ⚠️ PRESEASON WEEK 1 IS NOT WEEK 1. Following it would start every league's
  // season in August against players who are not playing.
  if (type !== 'regular' && type !== 'post') return no(`season_type is ${type || 'unknown'}`);

  // ⚠️ SLEEPER REPORTS THE SEASON AS A STRING. A === against a numeric league
  // season is always false, which would disable this entirely and look like the
  // feature was never wired.
  if (Number(state?.season) !== Number(meta.season)) {
    return no(`league season ${meta.season} is not the live season ${state?.season}`);
  }

  const live = Number(state?.week);
  if (!Number.isInteger(live) || live < 1) return no('no live week');

  const current = Number(meta.currentWeek ?? 0);
  // ⚠️ FORWARD ONLY. Going backwards would rescore a finished week against
  // whatever the rosters look like now, not what they were then.
  if (live <= current) return no('already at or past the live week');

  return { advance: true, to: live, reason: `advancing ${current || 'preseason'} -> ${live}` };
}
