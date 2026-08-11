// core/league/autosubs.js — automatic substitutions for starters who do not play.
//
// PURE. Given a lineup, a set of designations and who actually played, it says
// what the lineup becomes. No IO, no storage, no clock.
//
// ⚠️ THREE OF SLEEPER'S AUTOSUB RULES ARE DELIBERATELY ABSENT — every one keyed
// to kickoff time: "neither game may have begun", the "Require AutoSub To Not
// Play Before Starter" toggle, and "both players lock as soon as either kicks
// off". THIS MODULE HAS NO KICKOFF TIMES, and that is a design decision rather
// than a gap: `score-backoff.js` records that deciding behaviour from a schedule
// "would mean shipping kickoff times and a timezone, and being wrong every time
// a game moves".
//
// Do not fake them. A lock that guesses is worse than no lock — it either
// freezes a lineup a manager may still legally change, or permits a change after
// kickoff, and the second is exploitable. What ships instead is a WEEK-scoped
// lock, which is honest and enforceable with the data we have.
//
// See docs/superpowers/plans/2026-08-11-sleeper-parity-wave2-autosubs.md.

import { slotAccepts, NON_SCORING_SLOTS } from './slots.js';

/**
 * May a player of `subPosition` back up a starter occupying `starterSlot`?
 *
 * ⚠️ ELIGIBILITY IS AGAINST THE SLOT, NOT THE STARTER'S POSITION. A flex starter
 * who happens to be an RB may be backed by any flex-eligible player; requiring
 * the sub to match the starter's own position would silently forbid the most
 * common real case.
 *
 * Bench, IR and taxi are not startable, so nothing can back them up — they
 * accept anyone as storage, which is exactly why they need excluding here.
 */
export function subEligible({ starterSlot, subPosition } = {}) {
  if (!starterSlot || !subPosition) return false;
  if (NON_SCORING_SLOTS.includes(starterSlot)) return false;
  return slotAccepts(starterSlot, subPosition);
}

/**
 * Is this whole set of designations legal?
 *
 * `subs` is `{ [starterId]: subId }`. Returns `{ ok: true }` or
 * `{ ok: false, error }` — a message the UI can show verbatim, because a
 * refusal a manager cannot act on is a bug report waiting to happen.
 *
 * ⚠️ THE ROSTER-LIMIT RULE IS ASYMMETRIC BY DESIGN. Sleeper refuses to *set*
 * subs while a roster is over its limit, but *honours* subs set while it was
 * legal and only later went over — a mid-week trade, say. So the limit belongs
 * to the caller of THIS function, at assignment time, and `resolveAutoSubs`
 * must never re-check it.
 */
export function validateAutoSubs({
  subs = {}, lineup = [], starterSlots = [], positionOf = () => null,
  roster = [], maxSubs = 0,
} = {}) {
  const pairs = Object.entries(subs ?? {});
  if (pairs.length === 0) return { ok: true };

  if (!Number.isInteger(maxSubs) || maxSubs <= 0) {
    return { ok: false, error: 'AutoSubs are not enabled in this league.' };
  }
  if (pairs.length > maxSubs) {
    return {
      ok: false,
      error: `This league allows at most ${maxSubs} AutoSub${maxSubs === 1 ? '' : 's'} per week.`,
    };
  }

  const held = new Set(roster.map(String));
  const starting = new Set(lineup.filter(Boolean).map(String));
  const usedSubs = new Set();

  for (const [starterId, subId] of pairs) {
    const s = String(starterId);
    const b = String(subId);

    const idx = lineup.findIndex((x) => String(x ?? '') === s);
    if (idx === -1) return { ok: false, error: `${s} is not in the lineup.` };
    if (!held.has(b)) return { ok: false, error: `${b} is not on the roster.` };
    if (starting.has(b)) return { ok: false, error: `${b} is already starting.` };
    if (usedSubs.has(b)) {
      return { ok: false, error: `${b} cannot back up more than one starter.` };
    }
    usedSubs.add(b);

    if (!subEligible({ starterSlot: starterSlots[idx], subPosition: positionOf(b) })) {
      return { ok: false, error: `${b} cannot back up a ${starterSlots[idx]} slot.` };
    }
  }
  return { ok: true };
}

/**
 * Did this player appear in a game this week?
 *
 * ⚠️ `gp` IS THE FIELD, measured not assumed. Against the live
 * `stats/nfl/regular/2025/1` payload: 2312 rows, of which **1551 carry `gp: 1`
 * and 761 carry `gp: null`** — and every null-`gp` row also has
 * `pts_ppr: null`. Snap counts are NOT usable for this: `off_snp` was null for
 * seven of eight sampled players who did play.
 *
 * ⚠️ NEVER INFER THIS FROM POINTS. A player who played and scored zero HAS
 * played. Treating zero as absence would make the feature quietly take points
 * off a manager who did nothing wrong — the single worst failure mode here.
 */
export function playedThisWeek(statLine) {
  if (!statLine) return false;
  return Number(statLine.gp) === 1;
}

/**
 * Apply designations to a lineup for scoring.
 *
 * Returns a NEW lineup plus the swaps applied, so the caller can show what
 * happened — an automatic change nobody can see is indistinguishable from a bug.
 *
 * ⚠️ THE SUB MUST HAVE PLAYED TOO. He replaces an absence, he is not an upgrade;
 * swapping in someone who also did not play changes no points and only makes the
 * lineup harder to explain.
 *
 * ⚠️ DOES NOT RE-VALIDATE. Legality was settled by `validateAutoSubs` when the
 * designation was made. Re-checking here would break Sleeper's explicit rule
 * that subs set while legal are honoured even after a later trade puts the
 * roster over its limit.
 */
export function resolveAutoSubs({
  lineup = [], starterSlots = [], subs = {}, statsOf = () => null,
} = {}) {
  const out = [...lineup];
  const applied = [];
  if (!subs || Object.keys(subs).length === 0) return { lineup: out, applied };

  for (const [starterId, subId] of Object.entries(subs)) {
    const idx = out.findIndex((x) => String(x ?? '') === String(starterId));
    if (idx === -1) continue;                          // starter is no longer started
    if (playedThisWeek(statsOf(starterId))) continue;  // he showed up; nothing to do
    if (!playedThisWeek(statsOf(subId))) continue;     // the backup did not either

    applied.push({ slot: starterSlots[idx], out: String(starterId), in: String(subId) });
    out[idx] = String(subId);
  }
  return { lineup: out, applied };
}
