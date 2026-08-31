import { describe, it, expect } from 'vitest';
import { autoPickTarget, bestAvailableFor } from './draft-auto.js';

const clock = (owner) => ({ owner, overall: 4 });

describe('autoPickTarget', () => {
  const base = { status: 'active', clock: clock('t2'), flags: { t2: true }, isCommissioner: true, myTeamId: 't1' };

  it('picks for a flagged team when I am the commissioner', () => {
    expect(autoPickTarget(base)).toBe('t2');
  });

  it('picks for my OWN flagged team even if I am not commissioner', () => {
    expect(autoPickTarget({ ...base, isCommissioner: false, myTeamId: 't2' })).toBe('t2');
  });

  // 🔴 Without this every board in the room races to submit the same pick.
  it('does NOT act for another team when I am not the commissioner', () => {
    expect(autoPickTarget({ ...base, isCommissioner: false, myTeamId: 't1' })).toBeNull();
  });

  it('does nothing for an unflagged team', () => {
    expect(autoPickTarget({ ...base, flags: {} })).toBeNull();
    expect(autoPickTarget({ ...base, flags: { t9: true } })).toBeNull();
  });

  it('does nothing unless the draft is actively running', () => {
    for (const status of ['paused', 'complete', 'pending', null]) {
      expect(autoPickTarget({ ...base, status })).toBeNull();
    }
  });

  it('does nothing with no clock', () => {
    expect(autoPickTarget({ ...base, clock: null })).toBeNull();
  });
});

describe('bestAvailableFor', () => {
  it('prefers the team queue over the league ranking', () => {
    expect(bestAvailableFor({ queue: ['q1'], ranking: ['r1'], taken: new Set() })).toBe('q1');
  });

  it('skips queued players already drafted', () => {
    expect(bestAvailableFor({ queue: ['q1', 'q2'], ranking: ['r1'], taken: new Set(['q1']) })).toBe('q2');
  });

  it('falls through to the ranking when the queue is exhausted', () => {
    expect(bestAvailableFor({ queue: ['q1'], ranking: ['r1', 'r2'], taken: new Set(['q1', 'r1']) })).toBe('r2');
  });

  it('returns null when everything is taken', () => {
    expect(bestAvailableFor({ queue: ['q1'], ranking: ['r1'], taken: new Set(['q1', 'r1']) })).toBeNull();
  });

  it('compares as strings, so numeric ids still match', () => {
    expect(bestAvailableFor({ ranking: [123, 456], taken: new Set(['123']) })).toBe('456');
  });
});
