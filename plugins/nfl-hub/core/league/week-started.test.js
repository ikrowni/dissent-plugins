import { describe, it, expect } from 'vitest';
import { weekHasStarted } from './week-started.js';
import { resolveBracket } from './bracket-resolve.js';

describe('weekHasStarted', () => {
  it('an all-zero week — what scoring writes before kickoff — has not started', () => {
    expect(weekHasStarted({ teams: { t1: { total: 0 }, t2: { total: 0 } } })).toBe(false);
  });
  it('one team on the board means it has', () => {
    expect(weekHasStarted({ teams: { t1: { total: 0 }, t2: { total: 6.4 } } })).toBe(true);
  });
  it('negative points (a defence, a fumble) count as played', () => {
    expect(weekHasStarted({ teams: { t1: { total: -2 } } })).toBe(true);
  });
  it('no record, or no teams, has not started', () => {
    expect(weekHasStarted(null)).toBe(false);
    expect(weekHasStarted({ teams: {} })).toBe(false);
  });
});

// The bracket breaks a tie by seed, so an unplayed week read as 0–0 would advance every
// higher seed the moment the playoff week began — and the winner is stored for good.
describe('the playoff bracket and an unplayed week', () => {
  const table = (n) => Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, seed: i + 1 }));
  const bracketOf4 = () => ({
    season: 2026, playoffWeekStart: 15, reseed: true, seeds: table(4),
    rounds: [[
      { home: { teamId: 't1', seed: 1 }, away: { teamId: 't4', seed: 4 } },
      { home: { teamId: 't2', seed: 2 }, away: { teamId: 't3', seed: 3 } },
    ]],
    byes: [], champion: null, consolation: null,
  });
  const zeros = { teams: { t1: { total: 0 }, t2: { total: 0 }, t3: { total: 0 }, t4: { total: 0 } } };

  it('decides nothing while the round week is all zeros', () => {
    const out = resolveBracket(bracketOf4(), (w) => (w === 15 ? zeros : null));
    expect(out.rounds[0].every((g) => !g.winner)).toBe(true);
  });

  it('decides once the week has been played', () => {
    const played = { teams: { t1: { total: 90 }, t2: { total: 80 }, t3: { total: 110 }, t4: { total: 70 } } };
    const out = resolveBracket(bracketOf4(), (w) => (w === 15 ? played : null));
    expect(out.rounds[0].map((g) => g.winner?.teamId)).toEqual(['t1', 't3']);
  });
});
