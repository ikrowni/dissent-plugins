import { describe, it, expect } from 'vitest';
import { emptyState, hasEmptyState } from './emptystates.js';
import { STATES } from './screenstate.js';

const NON_LIVE = [STATES.NO_CLIENT, STATES.GAME_CLOSED, STATES.PRE_MATCH, STATES.STALE];

describe('emptyState', () => {
  it.each(NON_LIVE)('renders explanatory copy for %s', (s) => {
    const html = emptyState(s);
    expect(html).toContain('vsb-empty-title');
    expect(html.length).toBeGreaterThan(80);
  });

  // The whole point of this module. A screen full of 0s reads as broken software; the old
  // idle screen rendered the entire broadcast layout with every stat zeroed.
  it.each(NON_LIVE)('never renders a bare zero for %s', (s) => {
    expect(emptyState(s)).not.toMatch(/>\s*0\s*</);
  });

  it('renders nothing for states that own the full layout', () => {
    expect(emptyState(STATES.LIVE)).toBe('');
    expect(emptyState(STATES.REPLAY)).toBe('');
    expect(emptyState(STATES.ENDED)).toBe('');
  });

  it('tells callers which states it covers', () => {
    for (const s of NON_LIVE) expect(hasEmptyState(s)).toBe(true);
    expect(hasEmptyState(STATES.LIVE)).toBe(false);
  });

  it('returns empty string for an unknown state rather than throwing', () => {
    expect(emptyState('not-a-state')).toBe('');
  });
});
