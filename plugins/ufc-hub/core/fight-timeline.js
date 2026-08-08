// core/fight-timeline.js — the FightNightTracking play-by-play.
//
// The richest field in any source available to this project, and it arrives inside the
// event document the hub already fetches, at ZERO additional request cost.
//
// Measured on one completed card (2026-08-08): 360 tracked actions.
//   takedown_attempt 106 · takedown 46 · round_start/end 31 each · walkout 24
//   submission_attempt 15 · staredown / tale_of_the_tape / fight_open / fight_over /
//   results / fight_complete 12 each · unofficial_winner_decision 7 · knockdown 4 ·
//   reversal 4 · round_pause/unpause 5 each · pause_reason_low_blow 4 ·
//   unofficial_winner_kotko 3 · unofficial_winner_submission 2 · pause_reason_eye_poke 1
//
// ⚠️ These are TRACKED ACTIONS, not official UFC statistics. There is no strike-level
// data in any measured source, so nothing here may be labelled "significant strikes".

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Actions worth drawing on a timeline. Everything else is bookkeeping. */
const SIGNIFICANT = new Set([
  'knockdown', 'takedown', 'takedown_attempt', 'submission_attempt', 'reversal',
  'unofficial_winner_decision', 'unofficial_winner_kotko', 'unofficial_winner_submission',
  'pause_reason_low_blow', 'pause_reason_eye_poke',
]);

export function isSignificant(type) {
  return SIGNIFICANT.has(String(type ?? ''));
}

export function parseTracking(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t) => ({
    actionId: num(t?.ActionId),
    type: t?.Type ?? null,
    fighterId: num(t?.FighterId),
    round: num(t?.RoundNumber),
    clock: t?.RoundTime ?? null,
    timestamp: t?.Timestamp ?? null,
  }));
}

const ZERO = () => ({
  takedowns: 0, takedownAttempts: 0, knockdowns: 0, submissionAttempts: 0, reversals: 0,
});

/**
 * Per-fighter tallies derived from the timeline.
 *
 * This is what the dead ufcstats.com scraper was reaching for — obtainable here from a
 * source that actually works, with no extra request.
 *
 * `takedownAttempts` counts ATTEMPTS ONLY, not attempts+landed: the payload emits a
 * separate `takedown_attempt` and `takedown` for a successful shot, so adding them would
 * double-count every landed takedown. A view wanting "landed of total" adds them itself.
 */
export function actionCounts(events) {
  const out = {};
  const bump = (id, k) => {
    out[id] ??= ZERO();
    out[id][k] += 1;
  };
  for (const e of events ?? []) {
    // A knockdown with no fighter attached cannot be attributed to anyone.
    if (e.fighterId == null) continue;
    if (e.type === 'takedown') bump(e.fighterId, 'takedowns');
    else if (e.type === 'takedown_attempt') bump(e.fighterId, 'takedownAttempts');
    else if (e.type === 'knockdown') bump(e.fighterId, 'knockdowns');
    else if (e.type === 'submission_attempt') bump(e.fighterId, 'submissionAttempts');
    else if (e.type === 'reversal') bump(e.fighterId, 'reversals');
  }
  return out;
}
