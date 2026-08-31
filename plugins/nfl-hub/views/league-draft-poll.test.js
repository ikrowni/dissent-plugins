// @vitest-environment jsdom
//
// 🔴 THE DRAFT-FREEZE REGRESSION. `poll()` called `stopPolling()` from its catch
// for EVERY error, not just the intended "no draft exists" case. stopPolling()
// clears BOTH timers, so one transient failure — a network blip, a module
// timeout, a 429, the node restarting, a laptop sleeping — permanently killed
// that client's board: it never fetched again and the clock froze mid-count.
// Nothing restarted it but a remount, which is why ctrl+R and tab-switching
// "fixed" it. Over a multi-hour draft every participant eventually hit one.
// Reported 2026-08-31 after a real league draft.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const getDraft = vi.fn();
vi.mock('../core/league-api.js', async (orig) => ({
  ...(await orig()),
  getDraft: (...a) => getDraft(...a),
}));

const { _state, reset, isPolling, _poll, _startPolling, stopPolling } = await import('./league-draft.js');

const activeDraft = (over = {}) => ({
  status: 'active', picks: {}, msRemaining: 90000,
  onClock: { overall: 1, owner: 't1' }, isCommissioner: true, ...over,
});

beforeEach(() => {
  reset();
  getDraft.mockReset();
  Object.assign(_state, { leagueId: 'lg', ranking: ['p1'] });
});
afterEach(stopPolling);

describe('poll() error handling', () => {
  it('KEEPS POLLING after a transient failure', async () => {
    getDraft.mockResolvedValueOnce(activeDraft());
    await _poll(null);
    _startPolling(null);
    expect(isPolling()).toBe(true);

    getDraft.mockRejectedValueOnce(new Error('network error'));
    await _poll(null);

    // 🔴 The whole bug: this used to be false, and the clock froze with it.
    expect(isPolling()).toBe(true);
    expect(_state.error).toMatch(/network/i);
  });

  it('recovers: a later success clears the error and the board updates', async () => {
    getDraft.mockRejectedValueOnce(new Error('timeout'));
    await _poll(null);
    expect(_state.error).toBeTruthy();

    getDraft.mockResolvedValueOnce(activeDraft({ msRemaining: 42000 }));
    await _poll(null);
    expect(_state.error).toBeNull();
    expect(_state.draft.status).toBe('active');
  });

  // The ONE case where stopping is right: the answer cannot change until
  // somebody creates a draft, so polling it forever burns the invocation
  // allowance for nothing.
  it('still stops permanently when there is no draft', async () => {
    getDraft.mockResolvedValueOnce(activeDraft());
    await _poll(null);
    _startPolling(null);
    expect(isPolling()).toBe(true);   // so the stop below is a real transition

    getDraft.mockRejectedValueOnce(new Error('no draft has been created'));
    await _poll(null);
    expect(_state.noDraft).toBe(true);
    expect(_state.draft).toBeNull();
    expect(isPolling()).toBe(false);
  });

  // ⚠️ Not stopping must not mean hammering. A node that is down for an hour
  // would otherwise take 1200 invocations per client at POLL_MS=3s.
  it('backs off while failing, and resets the backoff on success', async () => {
    getDraft.mockRejectedValue(new Error('boom'));
    await _poll(null);
    const first = _state._skipTicks;
    await _poll(null);
    const second = _state._skipTicks;
    expect(second).toBeGreaterThan(first);

    getDraft.mockReset();
    getDraft.mockResolvedValueOnce(activeDraft());
    await _poll(null);
    expect(_state._skipTicks).toBe(0);
  });
});
