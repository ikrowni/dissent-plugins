// @vitest-environment jsdom
//
// The auto-draft flags, now that the signed module owns them.
//
// 🔴 WHAT THESE GUARD. The flags shipped in 2.37.0 in server-scoped plugin
// storage, writable by every member of the server, so a manager could flag a
// team they do not manage. They now live on the league meta behind `draft:auto`
// (`requireTeamControl`) and arrive with the board. These tests hold the client
// to reading and writing them THERE — the module's refusal is what actually
// enforces it, and is proven against the real WASM by plugin-module-check.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/league-api.js', async (actual) => ({
  ...(await actual()),
  getDraft: vi.fn(),
  setAutoDraft: vi.fn(),
  makePick: vi.fn(),
}));

import { reset, _state, _poll, toggleAutoDraft } from './league-draft.js';
import { getDraft, setAutoDraft } from '../core/league-api.js';

const board = (over = {}) => ({
  status: 'active', type: 'snake', rounds: 2, pickTimerSeconds: 90,
  pickEndsAt: Date.now() + 60000, msRemaining: 60000,
  onClock: null, picks: {}, order: [], isCommissioner: true,
  autoDraft: {},
  ...over,
});

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  Object.assign(_state, { leagueId: 'lg', teamId: 't1', league: { id: 'lg', isCommissioner: false } });
});

describe('reading the flags', () => {
  // ⚠️ The board is the ONLY source. A separate storage read is what let another
  // member write them in the first place.
  it('takes the flags from the board the module returns', async () => {
    getDraft.mockResolvedValue(board({ autoDraft: { t2: true } }));
    await _poll();
    expect(_state.autoDraft).toEqual({ t2: true });
  });

  // A flag cleared by another client (or refused, and never really set) must not
  // survive locally — that is exactly how two sources of truth start.
  it('forgets a flag the module no longer reports', async () => {
    getDraft.mockResolvedValue(board({ autoDraft: { t2: true } }));
    await _poll();
    getDraft.mockResolvedValue(board({ autoDraft: {} }));
    await _poll();
    expect(_state.autoDraft).toEqual({});
  });

  // An older module answering without the field must read as "none flagged",
  // never as undefined that then throws in the toggle.
  it('reads a board with no flags at all as none flagged', async () => {
    getDraft.mockResolvedValue(board({ autoDraft: undefined }));
    await _poll();
    expect(_state.autoDraft).toEqual({});
  });
});

describe('setting a flag', () => {
  it('writes through the module op, with the team and the new value', async () => {
    setAutoDraft.mockResolvedValue({ teamId: 't2', auto: true });
    await toggleAutoDraft(null, 't2');
    expect(setAutoDraft).toHaveBeenCalledWith('lg', 't2', true);
    expect(_state.autoDraft).toEqual({ t2: true });
  });

  it('turns a flag back off through the same op', async () => {
    _state.autoDraft = { t2: true };
    setAutoDraft.mockResolvedValue({ teamId: 't2', auto: false });
    await toggleAutoDraft(null, 't2');
    expect(setAutoDraft).toHaveBeenCalledWith('lg', 't2', false);
    expect(_state.autoDraft).toEqual({});
  });

  // 🔴 THE REFUSAL PATH. A member reaching past the UI for a team they do not
  // manage is refused by `requireTeamControl`. Leaving the optimistic paint up
  // would show them auto-drafting a team the module knows they are not.
  it('reverts the optimistic flag when the module refuses, and says so', async () => {
    setAutoDraft.mockRejectedValue(new Error('you do not manage team t2'));
    await toggleAutoDraft(null, 't2');
    expect(_state.autoDraft).toEqual({});
    expect(_state.error).toMatch(/do not manage team t2/);
  });

  it('restores the previous flag rather than clearing everything on a refusal', async () => {
    _state.autoDraft = { t3: true };
    setAutoDraft.mockRejectedValue(new Error('nope'));
    await toggleAutoDraft(null, 't2');
    expect(_state.autoDraft).toEqual({ t3: true });
  });

  it('does nothing at all without a team', async () => {
    await toggleAutoDraft(null, '');
    expect(setAutoDraft).not.toHaveBeenCalled();
  });
});
