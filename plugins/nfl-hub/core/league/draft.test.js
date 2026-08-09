import { describe, it, expect } from 'vitest';
import {
  DRAFT_STATUS, createDraft, startDraft, currentPick, makePick,
  resolveExpired, pauseDraft, resumeDraft, bestAvailable,
  draftedPlayerIds, draftedRosters,
} from './draft.js';
import { DRAFT_TYPE } from './draft-order.js';

const T0 = 1_700_000_000_000; // fixed epoch — the clock is only testable if `now` is an input
const SEC = 1000;

const newDraft = (over = {}) => createDraft({
  draftOrder: ['a', 'b', 'c'], rounds: 2, type: DRAFT_TYPE.SNAKE, pickTimerSeconds: 90, ...over,
});

const started = (over = {}) => startDraft(newDraft(over), T0).draft;

describe('createDraft / startDraft', () => {
  it('starts in pre with a full order and no picks', () => {
    const d = newDraft();
    expect(d.status).toBe(DRAFT_STATUS.PRE);
    expect(d.order).toHaveLength(6);
    expect(currentPick(d).overall).toBe(1);
  });

  it('sets the first deadline when it starts', () => {
    const d = started();
    expect(d.status).toBe(DRAFT_STATUS.ACTIVE);
    expect(d.pickEndsAt).toBe(T0 + 90 * SEC);
  });

  it('refuses to start twice, or with no picks', () => {
    expect(startDraft(started(), T0).ok).toBe(false);
    expect(startDraft(newDraft({ draftOrder: [] }), T0).ok).toBe(false);
  });

  // A slow/offline draft is a legitimate way to run one — it must not read as
  // "expired immediately".
  it('has no deadline when the timer is 0', () => {
    expect(started({ pickTimerSeconds: 0 }).pickEndsAt).toBe(null);
  });
});

describe('makePick', () => {
  it('records the pick and advances the clock', () => {
    const r = makePick(started(), 'a', 'p1', T0 + 10 * SEC);
    expect(r.ok).toBe(true);
    expect(r.draft.picks[1]).toMatchObject({ playerId: 'p1', teamId: 'a', auto: false });
    expect(currentPick(r.draft).overall).toBe(2);
    expect(r.draft.pickEndsAt).toBe(T0 + 10 * SEC + 90 * SEC);
  });

  it('refuses a pick out of turn', () => {
    const r = makePick(started(), 'b', 'p1', T0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("team a's pick");
  });

  it('refuses a player already drafted', () => {
    const d = makePick(started(), 'a', 'p1', T0).draft;
    const r = makePick(d, 'b', 'p1', T0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('already drafted');
  });

  it('refuses an empty player id, including Sleeper’s "0"', () => {
    expect(makePick(started(), 'a', null, T0).ok).toBe(false);
    expect(makePick(started(), 'a', '0', T0).ok).toBe(false);
  });

  // ⚠️ Checking the SLOT instead of the OWNER hands the pick to the team that
  // traded it away.
  it('checks the pick’s owner, not its slot', () => {
    const d = startDraft(newDraft({ tradedPicks: [{ round: 1, slot: 'a', to: 'c' }] }), T0).draft;
    expect(makePick(d, 'a', 'p1', T0).ok).toBe(false);
    expect(makePick(d, 'c', 'p1', T0).ok).toBe(true);
  });

  it('completes when the last pick is made', () => {
    let d = started();
    const order = d.order.map((p) => p.owner);
    order.forEach((team, i) => { d = makePick(d, team, `p${i}`, T0).draft; });
    expect(d.status).toBe(DRAFT_STATUS.COMPLETE);
    expect(d.pickEndsAt).toBe(null);
    expect(currentPick(d)).toBe(null);
    expect(makePick(d, 'a', 'px', T0).ok).toBe(false);
  });
});

// ⚠️ THE HARD PART. Deadline-on-read has to cascade, and each lapsed pick's
// deadline must be measured from the PREVIOUS DEADLINE — not from `now`.
describe('resolveExpired — the deadline-on-read clock', () => {
  const ranking = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const auto = (d) => bestAvailable(d, ranking);

  it('does nothing before the deadline', () => {
    const d = started();
    const r = resolveExpired(d, T0 + 89 * SEC, auto);
    expect(r.made).toEqual([]);
    expect(r.draft).toBe(d);
  });

  it('auto-drafts a single lapsed pick', () => {
    const r = resolveExpired(started(), T0 + 91 * SEC, auto);
    expect(r.made).toHaveLength(1);
    expect(r.draft.picks[1]).toMatchObject({ playerId: 'p1', teamId: 'a', auto: true });
  });

  // Twenty minutes with nobody watching: 90s per pick means many lapses, not one.
  it('cascades through every pick that expired while nobody was watching', () => {
    const r = resolveExpired(started(), T0 + 20 * 60 * SEC, auto);
    // 6 picks at 90s each = 9 minutes; all of them have lapsed.
    expect(r.made).toHaveLength(6);
    expect(r.draft.status).toBe(DRAFT_STATUS.COMPLETE);
  });

  // ⚠️ Measuring from `now` would give every lapsed team a fresh full timer and
  // stretch a twenty-minute absence into a single pick.
  it('times each lapse from the previous deadline, not from now', () => {
    const r = resolveExpired(started(), T0 + 5 * 60 * SEC, auto);
    expect(r.made.map((m) => m.at)).toEqual([
      T0 + 90 * SEC, T0 + 180 * SEC, T0 + 270 * SEC,
    ]);
    // The 4th pick's deadline is 360s, which is beyond `now` (300s) — so exactly
    // three picks lapsed, and the 4th is still legitimately on the clock.
    expect(r.made).toHaveLength(3);
    expect(r.draft.pickEndsAt).toBe(T0 + 360 * SEC);
  });

  it('respects the snake order while auto-drafting', () => {
    const r = resolveExpired(started(), T0 + 20 * 60 * SEC, auto);
    expect(r.made.map((m) => m.owner)).toEqual(['a', 'b', 'c', 'c', 'b', 'a']);
  });

  it('marks auto-drafted picks so a board can show them differently', () => {
    const r = resolveExpired(started(), T0 + 20 * 60 * SEC, auto);
    expect(Object.values(r.draft.picks).every((p) => p.auto)).toBe(true);
  });

  it('stops rather than looping when autoPick has nobody left to give', () => {
    const r = resolveExpired(started(), T0 + 20 * 60 * SEC, () => null);
    expect(r.made).toEqual([]);
    expect(r.draft.status).toBe(DRAFT_STATUS.ACTIVE);
  });

  it('does nothing when there is no clock', () => {
    const r = resolveExpired(started({ pickTimerSeconds: 0 }), T0 + 10 * 60 * SEC, auto);
    expect(r.made).toEqual([]);
  });

  it('does nothing while paused', () => {
    const d = pauseDraft(started()).draft;
    expect(resolveExpired(d, T0 + 10 * 60 * SEC, auto).made).toEqual([]);
  });
});

describe('pause and resume', () => {
  it('clears the deadline on pause and gives a fresh one on resume', () => {
    const p = pauseDraft(started());
    expect(p.draft.status).toBe(DRAFT_STATUS.PAUSED);
    expect(p.draft.pickEndsAt).toBe(null);

    // The team on the clock is not punished for the commissioner's pause.
    const r = resumeDraft(p.draft, T0 + 60 * 60 * SEC);
    expect(r.draft.pickEndsAt).toBe(T0 + 60 * 60 * SEC + 90 * SEC);
  });

  it('refuses pause/resume from the wrong state', () => {
    expect(pauseDraft(newDraft()).ok).toBe(false);
    expect(resumeDraft(started(), T0).ok).toBe(false);
  });

  it('blocks picks while paused', () => {
    expect(makePick(pauseDraft(started()).draft, 'a', 'p1', T0).ok).toBe(false);
  });
});

describe('bestAvailable', () => {
  it('skips players already drafted', () => {
    const d = makePick(started(), 'a', 'p1', T0).draft;
    expect(bestAvailable(d, ['p1', 'p2'])).toBe('p2');
  });

  it('returns null when the ranking is exhausted', () => {
    const d = makePick(started(), 'a', 'p1', T0).draft;
    expect(bestAvailable(d, ['p1'])).toBe(null);
    expect(bestAvailable(d, [])).toBe(null);
  });
});

// ⚠️ Ownership is derived from the picks WHILE DRAFTING, because a pick must
// touch only one storage key — CAS cannot make two key writes atomic.
describe('ownership during the draft', () => {
  it('derives rosters from the picks', () => {
    let d = started();
    d = makePick(d, 'a', 'p1', T0).draft;
    d = makePick(d, 'b', 'p2', T0).draft;
    d = makePick(d, 'c', 'p3', T0).draft;
    d = makePick(d, 'c', 'p4', T0).draft; // snake turn

    const rosters = draftedRosters(d, ['a', 'b', 'c']);
    expect(rosters.a.players).toEqual(['p1']);
    expect(rosters.c.players).toEqual(['p3', 'p4']);
    expect(draftedPlayerIds(d).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('never lets one player reach two teams', () => {
    const r = resolveExpired(started(), T0 + 20 * 60 * SEC, (d) => bestAvailable(d, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']));
    const all = Object.values(draftedRosters(r.draft, ['a', 'b', 'c'])).flatMap((x) => x.players);
    expect(new Set(all).size).toBe(all.length);
  });
});
