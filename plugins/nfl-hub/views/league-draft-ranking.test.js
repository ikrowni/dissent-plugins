// @vitest-environment jsdom
//
// 🔴 THE BOARD ASKED FOR THE WRONG RANKING, in every league that is not full PPR.
// `settings.scoring` is a WEIGHT MAP — the whole { rec: 1, rec_yd: 0.1, … }
// object — not a name. Passed straight to rankingFor it stringifies to
// "[object object]", matches no key, and falls back to PPR. The fallback is
// correct for an unknown name, which is exactly why nothing ever said so.
//
// Not cosmetic: ppr/half/std each ship 400 players and genuinely differ — std
// diverges from ppr at index 0, the first pick off the board. And the ranking is
// what BOTH autodrafts choose from: this client's auto-pick for an absent
// manager, and the module's own expiry cascade, which is sent this same list.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const rankingFor = vi.fn(() => ['r1']);
vi.mock('../core/draft-ranking.js', async (orig) => ({
  ...(await orig()),
  loadRanking: () => Promise.resolve(),
  rankingFor: (...a) => rankingFor(...a),
}));
vi.mock('../core/player-index.js', async (orig) => ({
  ...(await orig()),
  loadIndex: () => Promise.resolve(),
}));
vi.mock('../core/league-api.js', async (orig) => ({
  ...(await orig()),
  getDraft: () => Promise.reject(new Error('no draft has been created')),
}));

const { load, reset, stopPolling } = await import('./league-draft.js');

const leagueWith = (scoring) => ({
  id: 'lg', isCommissioner: true, myTeams: ['t1'],
  teams: { t1: { id: 't1', name: 'Team 1' } },
  settings: { scoring },
});

// The real shape: DEFAULT_SETTINGS.scoring is this map, not a name.
const PPR = { rec: 1, rec_yd: 0.1, rush_yd: 0.1, pass_td: 4 };

beforeEach(() => { reset(); rankingFor.mockClear(); });

describe('which ranking the draft board asks for', () => {
  it('resolves a HALF-ppr weight map to the half ranking', async () => {
    await load(null, { leagueId: 'lg', league: leagueWith({ ...PPR, rec: 0.5 }), teamId: 't1' });
    stopPolling();
    expect(rankingFor).toHaveBeenCalledWith('half');
  });

  it('resolves a STANDARD weight map to the std ranking', async () => {
    await load(null, { leagueId: 'lg', league: leagueWith({ ...PPR, rec: 0 }), teamId: 't1' });
    stopPolling();
    expect(rankingFor).toHaveBeenCalledWith('std');
  });

  it('resolves a full-ppr weight map to ppr', async () => {
    await load(null, { leagueId: 'lg', league: leagueWith(PPR), teamId: 't1' });
    stopPolling();
    expect(rankingFor).toHaveBeenCalledWith('ppr');
  });

  // 🔴 The regression itself: never hand rankingFor the raw object.
  it('never passes the weight map through unresolved', async () => {
    await load(null, { leagueId: 'lg', league: leagueWith({ ...PPR, rec: 0 }), teamId: 't1' });
    stopPolling();
    for (const [arg] of rankingFor.mock.calls) {
      expect(typeof arg).toBe('string');
      expect(String(arg)).not.toMatch(/object/i);
    }
  });

  it('still defaults to ppr for a league with no scoring settings at all', async () => {
    await load(null, { leagueId: 'lg', league: { id: 'lg', teams: {}, myTeams: [] }, teamId: 't1' });
    stopPolling();
    expect(rankingFor).toHaveBeenCalledWith('ppr');
  });
});
