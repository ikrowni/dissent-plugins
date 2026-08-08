// core/fight-state.js — is this fight upcoming, happening, or over?
//
// One place, because three views need the same answer and a disagreement between them
// shows up as a live badge on a finished fight.

/**
 * Has this fight actually been decided?
 *
 * ⚠️ `fight.result` IS NOT A BOOLEAN. CloudFront emits a `Result` key on every fight
 * including upcoming ones, so `parseResult` returns a fully-populated object whose
 * fields are all null — truthy, and meaning nothing. Measured on cf-event-upcoming:
 * 12 of 12 upcoming fights have a truthy `.result`.
 *
 * `views/card.js` in 1.0.0 tested `fight.result` directly and rendered an empty
 * `<div class="fresult">` on every upcoming bout because of it. Anything asking "is
 * this over" must ask THIS, not the object's existence.
 */
export function hasResult(fight) {
  const r = fight?.result;
  if (!r) return false;
  return Boolean(r.method || r.endingRound || (r.scores?.length ?? 0) > 0);
}

/**
 * 'pre' | 'in' | 'post' for a single fight.
 *
 * ⚠️ A result WINS over LiveFightId. The event document has been observed still
 * carrying a LiveFightId after the bout was decided, and trusting it would leave a
 * pulsing live bar on a fight with a scorecard underneath it.
 */
export function fightState(fight, event) {
  if (!fight) return 'pre';
  if (hasResult(fight) || fight.state === 'post') return 'post';
  if (event?.liveFightId != null && event.liveFightId === fight.fightId) return 'in';
  if (fight.state === 'in') return 'in';
  return 'pre';
}

/** The live round and clock, or null when nothing is live. */
export function liveClock(event) {
  const round = event?.liveRound;
  if (round == null) return null;
  return { round, clock: event.liveRoundElapsed ?? null };
}

/** Per-round markers for the round strip. */
export function roundProgress(liveRound, totalRounds) {
  const total = Number(totalRounds) > 0 ? Number(totalRounds) : 3;
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    if (n < liveRound) return 'done';
    if (n === liveRound) return 'now';
    return 'pending';
  });
}

/** `RuleSet.Description` is "5 Rnd (5-5-5-5-5)"; the count is the leading number. */
export function roundsFromRuleSet(desc) {
  const m = /^(\d+)\s*Rnd/i.exec(String(desc ?? ''));
  return m ? Number(m[1]) : null;
}
