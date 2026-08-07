// @vitest-environment jsdom
// ^ these modules touch window/document at import time. Added 2026-08-07 when the
// repo gained a test runner; without it every test here dies on "window is not defined".
import { describe, it, expect } from 'vitest';
import { isFresh } from './rl-hub-main.js';

describe('isFresh', () => {
  it('returns false for null', () => {
    expect(isFresh(null)).toBe(false);
  });
  it('returns true for entry fetched 30 minutes ago', () => {
    const fetchedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isFresh({ fetchedAt })).toBe(true);
  });
  it('returns false for entry fetched 2 hours ago', () => {
    const fetchedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(isFresh({ fetchedAt })).toBe(false);
  });
  it('returns false for entry with no fetchedAt', () => {
    expect(isFresh({})).toBe(false);
  });
});
