import { describe, it, expect } from 'vitest';
import { emptyState, hasEmptyState } from './emptystates.js';
import { STATES } from './screenstate.js';

const NON_LIVE = [STATES.NO_BROADCAST, STATES.GAME_CLOSED, STATES.PRE_MATCH, STATES.STALE];

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

// ── Regression guards ─────────────────────────────────────────────────────────
//
// Both of these encode corrections the owner had to make more than once. They are cheap
// and they fail loudly, which is the point.

describe('copy accuracy', () => {
  it('never implies a companion app exists — there is none', () => {
    for (const s of NON_LIVE) {
      expect(emptyState(s).toLowerCase()).not.toContain('companion');
    }
  });

  it('never tells a viewer the desktop app is required', () => {
    // Web and Android report desktop:false and cannot broadcast, but they CAN watch.
    // Telling a spectator to install the desktop app is telling them to fix something
    // that is not broken for them. Broadcasting instructions belong in the settings card.
    for (const s of NON_LIVE) {
      expect(emptyState(s).toLowerCase()).not.toContain('desktop app required');
    }
  });

  it('points at the real gate when a broadcaster sees nothing', () => {
    // PacketSendRate, not an "enabled" flag — the retired installer patched a bEnabled
    // key that does not exist and reported success.
    expect(emptyState(STATES.GAME_CLOSED)).toContain('PacketSendRate');
  });
});
