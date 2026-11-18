// core/league/draft.js — the draft state machine and its clock.
//
// PURE. No timers, no I/O. `now` is always passed in, which is what makes the
// clock testable at all.
//
// ⚠️ DURING A DRAFT, THE DRAFT IS THE SOURCE OF TRUTH FOR OWNERSHIP — not
// `rosters`. A pick would otherwise have to write two storage keys at once
// (draft state and rosters), and compare-and-swap is per-key: there is no way to
// make those two writes atomic. So a pick touches ONE key, "who owns whom" is
// derived from the picks while drafting, and rosters are materialised once when
// the draft completes. Splitting a pick across two keys is how a player ends up
// drafted but on nobody's roster.
//
// The clock is DEADLINE-ON-READ (design §5): the node's scheduler floor is five
// minutes and cannot drive a 90-second timer, so lapsed picks are resolved
// lazily by whoever next reads the board, with the scheduler as a backstop. A
// lapse is therefore RECORDED late but TIMED correctly.

import { generateOrder, applyTradedPicks } from './draft-order.js';

export const DRAFT_STATUS = Object.freeze({
  PRE: 'pre',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETE: 'complete',
});

/**
 * Build a draft that has not started.
 *
 * `pickTimerSeconds` of 0 means no clock at all — a slow/offline draft, which is
 * a legitimate way to run one and must not be treated as "expired immediately".
 */
export function createDraft({
  draftOrder, rounds, type, tradedPicks = [], pickTimerSeconds = 90, season = null,
}) {
  return {
    status: DRAFT_STATUS.PRE,
    season,
    type,
    rounds,
    pickTimerSeconds,
    order: applyTradedPicks(generateOrder(draftOrder, rounds, type), tradedPicks),
    picks: {},        // overall -> { playerId, teamId, at, auto }
    startedAt: null,
    pickEndsAt: null, // epoch ms deadline for the pick currently on the clock
  };
}

/** Start the clock. */
export function startDraft(draft, now) {
  if (draft.status !== DRAFT_STATUS.PRE) return fail(draft, 'draft has already started');
  if (draft.order.length === 0) return fail(draft, 'draft has no picks');
  return done({
    ...draft,
    status: DRAFT_STATUS.ACTIVE,
    startedAt: now,
    pickEndsAt: deadlineFrom(draft, now),
  });
}

const fail = (draft, error) => ({ ok: false, draft, error });
const done = (draft, made = []) => ({ ok: true, draft, error: null, made });

function deadlineFrom(draft, from) {
  return draft.pickTimerSeconds > 0 ? from + draft.pickTimerSeconds * 1000 : null;
}

/** The next pick not yet made, or null when the draft is over. */
export function currentPick(draft) {
  for (const p of draft.order) {
    if (!draft.picks[p.overall]) return p;
  }
  return null;
}

/** Every player id already taken. */
export function draftedPlayerIds(draft) {
  return Object.values(draft.picks ?? {}).map((p) => String(p.playerId));
}

/** Ownership as it stands mid-draft, in the same shape `rosters` uses. */
export function draftedRosters(draft, teamIds) {
  const out = {};
  for (const id of teamIds ?? []) out[String(id)] = { players: [], ir: [], taxi: [] };
  for (const pick of Object.values(draft.picks ?? {})) {
    const team = String(pick.teamId);
    if (!out[team]) out[team] = { players: [], ir: [], taxi: [] };
    out[team].players.push(String(pick.playerId));
  }
  return out;
}

/**
 * Make a pick.
 *
 * ⚠️ The acting team is checked against the pick's OWNER, never its slot — in a
 * league with pick trading those differ, and checking the slot hands the pick to
 * the team that traded it away.
 */
export function makePick(draft, teamId, playerId, now, { auto = false } = {}) {
  if (draft.status !== DRAFT_STATUS.ACTIVE) return fail(draft, `draft is ${draft.status}`);

  const pick = currentPick(draft);
  if (!pick) return fail(draft, 'draft is already complete');

  const team = String(teamId);
  if (pick.owner !== team) return fail(draft, `it is team ${pick.owner}'s pick, not ${team}'s`);

  // ⚠️ Check BEFORE stringifying. String(null) is "null" — truthy, and it would
  // sail past a `!id` guard and be drafted as a player literally named "null".
  if (playerId === null || playerId === undefined || playerId === '' || playerId === '0' || playerId === 0) {
    return fail(draft, 'no player named');
  }
  const id = String(playerId);
  if (draftedPlayerIds(draft).includes(id)) return fail(draft, `player ${id} is already drafted`);

  const picks = { ...draft.picks, [pick.overall]: { playerId: id, teamId: team, at: now, auto } };
  const complete = Object.keys(picks).length >= draft.order.length;

  return done({
    ...draft,
    picks,
    status: complete ? DRAFT_STATUS.COMPLETE : draft.status,
    // The next clock runs from the moment this pick was made, not from `now` —
    // for an auto-pick those differ, and using `now` would silently give the next
    // team extra time whenever a lapse was resolved late.
    pickEndsAt: complete ? null : deadlineFrom(draft, now),
  });
}

/**
 * Resolve every pick whose deadline has passed, auto-drafting each.
 *
 * ⚠️ THE CASCADE IS THE HARD PART. If nobody loads the board for twenty minutes,
 * SEVERAL picks have expired — and each one's deadline must be measured from the
 * PREVIOUS DEADLINE, not from `now`. Measuring from `now` would give every lapsed
 * team a fresh full timer and stretch a twenty-minute absence into one pick.
 *
 * `autoPick(draft, pick)` returns a player id for a team that ran out of time.
 * Returning null stops the cascade rather than looping forever.
 */
export function resolveExpired(draft, now, autoPick) {
  if (draft.status !== DRAFT_STATUS.ACTIVE) return done(draft);
  if (!draft.pickEndsAt) return done(draft); // no clock — nothing can expire

  let state = draft;
  const made = [];
  // Bounded by the number of remaining picks: a draft cannot lapse more picks
  // than it has.
  let guard = state.order.length + 1;

  while (guard-- > 0) {
    if (state.status !== DRAFT_STATUS.ACTIVE) break;
    const deadline = state.pickEndsAt;
    if (!deadline || deadline > now) break;

    const pick = currentPick(state);
    if (!pick) break;

    const playerId = autoPick?.(state, pick) ?? null;
    if (!playerId) break; // nothing to give them; leave it on the clock

    // ⚠️ `deadline`, not `now`. This is what keeps the recorded timeline honest.
    const res = makePick(state, pick.owner, playerId, deadline, { auto: true });
    if (!res.ok) break;
    state = res.draft;
    made.push({ ...pick, playerId: String(playerId), at: deadline });
  }

  return done(state, made);
}

/**
 * Pause and resume, for a commissioner rescuing a draft.
 *
 * ⚠️ PAUSING BANKS THE TIME LEFT; RESUMING PAYS IT BACK. A pause used to clear
 * the deadline and a resume used to mint a fresh full timer, which meant a
 * manager with nine seconds left got ninety back — so pausing was a way to buy
 * time, and pausing repeatedly was a way to never be on the clock at all.
 *
 * `pausedRemainingMs` is what makes the round trip honest. It is absent on a
 * draft paused by an older build, and absent is handled: resume falls back to a
 * full timer, which is exactly what that build already did.
 */
export function pauseDraft(draft, now) {
  if (draft.status !== DRAFT_STATUS.ACTIVE) return fail(draft, `draft is ${draft.status}`);
  // A non-finite `now` means we cannot measure anything; bank nothing rather than
  // banking NaN, and resume will hand out a full timer.
  const measurable = Number.isFinite(now) && Number.isFinite(draft.pickEndsAt);
  return done({
    ...draft,
    status: DRAFT_STATUS.PAUSED,
    pickEndsAt: null,
    pausedRemainingMs: measurable ? Math.max(0, draft.pickEndsAt - now) : null,
  });
}

export function resumeDraft(draft, now) {
  if (draft.status !== DRAFT_STATUS.PAUSED) return fail(draft, `draft is ${draft.status}`);

  const banked = draft.pausedRemainingMs;
  const next = { ...draft, status: DRAFT_STATUS.ACTIVE };
  // A league with no clock at all stays that way — `deadlineFrom` returns null
  // and banked time is meaningless.
  next.pickEndsAt = draft.pickTimerSeconds > 0 && Number.isFinite(banked)
    ? now + banked
    : deadlineFrom(draft, now);
  // Cleared, not left behind: a stale banked value on an active draft would be
  // paid out again by the next pause/resume pair.
  delete next.pausedRemainingMs;
  return done(next);
}

/**
 * Best available from a ranking, skipping anyone already drafted.
 *
 * The default autodraft. A team's own queue should be tried first by the caller;
 * this is the fallback when the queue is empty or exhausted.
 */
export function bestAvailable(draft, ranking = []) {
  const taken = new Set(draftedPlayerIds(draft));
  for (const id of ranking) {
    if (!taken.has(String(id))) return String(id);
  }
  return null;
}
