// @vitest-environment jsdom
//
// The clock's DOM behaviour, which is the whole of the reported bug and cannot
// be tested without a document.
//
// ⚠️ FOUR SEPARATE COMPLAINTS, ONE CAUSE. The clock jumping in 3-4 second steps,
// the page "refreshing" on every tick, and the search box eating keystrokes were
// all the same 3-second interval calling `router.refresh()`, which replaces the
// section's entire innerHTML. These tests pin the fix from the outside: a tick
// must move the digits and touch nothing else.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, reset, paintClock, fingerprint, _state } from './league-draft.js';
import { setIndex } from '../core/player-index.js';

const order = [
  { overall: 1, round: 1, pickInRound: 1, slot: 't1', owner: 't1' },
  { overall: 2, round: 1, pickInRound: 2, slot: 't2', owner: 't2' },
];

function mount(over = {}, stateOver = {}) {
  setIndex({
    qb1: { n: 'Quinn Back', p: 'QB', t: 'KC' },
    rb1: { n: 'Ray Bee', p: 'RB', t: 'DET' },
  });
  Object.assign(_state, {
    leagueId: 'lg', teamId: 't1', error: null, busy: false, notice: null,
    noDraft: false, query: '', filter: 'ALL', ranking: ['qb1', 'rb1'],
    localDeadline: Date.now() + 62_000, frozenRemaining: null,
    league: {
      id: 'lg', isCommissioner: true, myTeams: ['t1'],
      settings: { rosterPositions: ['QB', 'RB', 'BN'] },
      teams: { t1: { id: 't1', name: 'Alice FC' }, t2: { id: 't2', name: 'Bob United' } },
    },
    draft: {
      status: 'active', type: 'snake', rounds: 1, pickTimerSeconds: 90,
      pickEndsAt: Date.now() + 62_000, msRemaining: 62_000,
      onClock: { overall: 1, round: 1, teamId: 't1' },
      picks: {}, order, isCommissioner: true, ...over,
    },
    ...stateOver,
  });
  document.body.innerHTML = render();
}

beforeEach(() => {
  reset();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('painting the clock', () => {
  it('puts the clock somewhere it can be found without a re-render', () => {
    mount();
    expect(document.querySelector('[data-draft-clock]')).not.toBe(null);
  });

  // ⚠️ THE FIX, STATED AS A TEST. The digits change; the document does not.
  it('updates the digits without replacing anything else on the page', () => {
    mount();
    const el = document.querySelector('[data-draft-clock]');
    const before = el.textContent;
    const pool = document.querySelector('.db-pool');

    // ⚠️ Frozen, or the assertion is off by one whenever a millisecond elapses
    // between setting the deadline and flooring the remainder.
    vi.useFakeTimers();
    _state.localDeadline = Date.now() + 30_000;
    paintClock();

    expect(el.textContent).not.toBe(before);
    expect(el.textContent).toBe('0:30');
    // The very same element objects are still in the document — a re-render
    // would have replaced them with new ones.
    expect(document.querySelector('[data-draft-clock]')).toBe(el);
    expect(document.querySelector('.db-pool')).toBe(pool);
  });

  // ⚠️ THE TYPING BUG. A refresh mid-word destroys the input, so focus and the
  // half-typed value go with it. A tick must leave both alone.
  it('leaves a half-typed search box focused, with its value and caret intact', () => {
    mount();
    const input = document.querySelector('[data-act="draft-search"]');
    input.focus();
    input.value = 'jeffe';
    input.setSelectionRange(3, 3);

    for (let i = 0; i < 8; i += 1) {
      _state.localDeadline = Date.now() + (60_000 - i * 1000);
      paintClock();
    }

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('jeffe');
    expect(input.selectionStart).toBe(3);
  });

  it('marks the last fifteen seconds as urgent', () => {
    mount();
    const el = document.querySelector('[data-draft-clock]');

    _state.localDeadline = Date.now() + 20_000;
    paintClock();
    expect(el.classList.contains('urgent')).toBe(false);

    _state.localDeadline = Date.now() + 9_000;
    paintClock();
    expect(el.classList.contains('urgent')).toBe(true);
  });

  // An expired pick is 0:00 and is not "urgent" — it is over, and flashing at
  // somebody who can no longer act is noise.
  it('drops the urgent mark once the pick has expired', () => {
    mount();
    const el = document.querySelector('[data-draft-clock]');
    _state.localDeadline = Date.now() - 1_000;
    paintClock();
    expect(el.textContent).toBe('0:00');
    expect(el.classList.contains('urgent')).toBe(false);
  });

  it('holds the digits still while the draft is paused', () => {
    mount({ status: 'paused' }, { localDeadline: null, frozenRemaining: 47_000 });
    const el = document.querySelector('[data-draft-clock]');
    paintClock();
    expect(el.textContent).toBe('0:47');
    paintClock();
    expect(el.textContent).toBe('0:47');
  });

  it('does nothing, and throws nothing, when the board is not on screen', () => {
    mount();
    document.body.innerHTML = '';
    expect(() => paintClock()).not.toThrow();
  });
});

// ── What earns a full re-render ──────────────────────────────────────────────
//
// ⚠️ THE CLOCK IS DELIBERATELY NOT IN THE FINGERPRINT. Including the deadline
// would make every poll a full re-render again, which is the bug this exists to
// prevent. Only things that change the SHAPE of the screen belong in it.
describe('deciding when a re-render is earned', () => {
  const d = (over = {}) => ({
    status: 'active', picks: {}, onClock: { overall: 1 }, isCommissioner: false, ...over,
  });

  it('does not change as the clock runs down', () => {
    expect(fingerprint(d({ pickEndsAt: 1000, msRemaining: 1000 })))
      .toBe(fingerprint(d({ pickEndsAt: 9999, msRemaining: 9999 })));
  });

  it('changes when a pick is made', () => {
    expect(fingerprint(d({ picks: { 1: { playerId: 'qb1' } } }))).not.toBe(fingerprint(d()));
  });

  it('changes when somebody new is on the clock', () => {
    expect(fingerprint(d({ onClock: { overall: 2 } }))).not.toBe(fingerprint(d()));
  });

  it('changes when the draft is paused or resumed', () => {
    expect(fingerprint(d({ status: 'paused' }))).not.toBe(fingerprint(d()));
  });

  it('changes when the draft completes', () => {
    expect(fingerprint(d({ status: 'complete' }))).not.toBe(fingerprint(d()));
  });

  it('handles no draft at all', () => {
    expect(fingerprint(null)).toBe('none');
    expect(fingerprint(undefined)).toBe('none');
  });
});
