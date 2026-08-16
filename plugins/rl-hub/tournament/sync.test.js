import { describe, it, expect } from 'vitest';
import { stampVersion, shouldAccept, isStaleWrite } from './sync.js';

const T = (over = {}) => ({ id: 't1', name: 'Cup', version: 1, updatedAt: 1000, updatedBy: 'u1', ...over });

describe('stampVersion', () => {
  it('starts an unversioned tournament at 1', () => {
    expect(stampVersion({ id: 't1' }, 'u1').version).toBe(1);
  });

  it('increments an existing version', () => {
    expect(stampVersion(T({ version: 7 }), 'u1').version).toBe(8);
  });

  it('records who wrote it', () => {
    expect(stampVersion(T(), 'u9').updatedBy).toBe('u9');
  });

  it('does not mutate the input', () => {
    const t = T({ version: 3 });
    stampVersion(t, 'u2');
    expect(t.version).toBe(3);
  });

  it('returns null for nothing', () => {
    expect(stampVersion(null, 'u1')).toBeNull();
  });

  it('treats a corrupt version as 0 rather than producing NaN', () => {
    expect(stampVersion(T({ version: 'banana' }), 'u1').version).toBe(1);
  });
});

describe('shouldAccept', () => {
  it('accepts anything when nothing is held locally', () => {
    expect(shouldAccept(null, T())).toBe(true);
  });

  it('accepts a newer version', () => {
    expect(shouldAccept(T({ version: 1 }), T({ version: 2 }))).toBe(true);
  });

  // The bug this module exists for: a client on a stale copy republishing and silently
  // rolling back correct results.
  it('rejects an older version', () => {
    expect(shouldAccept(T({ version: 5 }), T({ version: 2 }))).toBe(false);
  });

  it('always accepts a delete', () => {
    expect(shouldAccept(T({ version: 99 }), null)).toBe(true);
    expect(shouldAccept(T({ version: 99 }), undefined)).toBe(true);
  });

  it('accepts a different tournament regardless of version', () => {
    // A fresh bracket starts at version 1 and must be able to replace a long-running one.
    expect(shouldAccept(T({ id: 'old', version: 40 }), T({ id: 'new', version: 1 }))).toBe(true);
  });

  it('breaks an equal-version conflict by timestamp', () => {
    expect(shouldAccept(T({ version: 3, updatedAt: 100 }), T({ version: 3, updatedAt: 200 }))).toBe(true);
    expect(shouldAccept(T({ version: 3, updatedAt: 200 }), T({ version: 3, updatedAt: 100 }))).toBe(false);
  });

  it('breaks a same-millisecond conflict deterministically', () => {
    const a = T({ version: 3, updatedAt: 500, updatedBy: 'aaa' });
    const b = T({ version: 3, updatedAt: 500, updatedBy: 'bbb' });
    // Every client must land on the same winner, whichever side it is holding.
    expect(shouldAccept(a, b)).toBe(true);
    expect(shouldAccept(b, a)).toBe(false);
  });

  it('never accepts both directions of the same pair', () => {
    const pairs = [
      [T({ version: 1 }), T({ version: 2 })],
      [T({ version: 3, updatedAt: 1 }), T({ version: 3, updatedAt: 2 })],
      [T({ version: 3, updatedAt: 5, updatedBy: 'x' }), T({ version: 3, updatedAt: 5, updatedBy: 'y' })],
    ];
    for (const [a, b] of pairs) {
      expect(shouldAccept(a, b)).not.toBe(shouldAccept(b, a));
    }
  });

  it('treats a missing version as 0', () => {
    expect(shouldAccept({ id: 't1' }, T({ version: 1 }))).toBe(true);
  });
});

describe('isStaleWrite', () => {
  it('flags an incoming update that lost', () => {
    expect(isStaleWrite(T({ version: 5 }), T({ version: 2 }))).toBe(true);
  });

  it('does not flag one that won', () => {
    expect(isStaleWrite(T({ version: 1 }), T({ version: 2 }))).toBe(false);
  });

  it('does not flag a delete', () => {
    expect(isStaleWrite(T(), null)).toBe(false);
  });
});
