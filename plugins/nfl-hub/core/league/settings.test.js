import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, FORMAT, WAIVER_TYPE,
  normalizeSettings, validateSettings,
  isMultiSeason, requiresLineupSetting,
} from './settings.js';


describe('defaults', () => {
  it('are a valid league on their own', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual({ valid: true, errors: [] });
  });
});

describe('normalizeSettings', () => {
  it('fills gaps without mutating the input', () => {
    const partial = { name: 'Dynasty Warriors', format: FORMAT.DYNASTY };
    const out = normalizeSettings(partial);
    expect(out.numTeams).toBe(12);
    expect(out.name).toBe('Dynasty Warriors');
    expect(partial.numTeams).toBeUndefined();
  });

  // ⚠️ Sharing a reference with the frozen defaults would let one league's edit
  // reach every other league seeded from them.
  it('copies the scoring map and roster positions rather than sharing them', () => {
    const a = normalizeSettings({});
    const b = normalizeSettings({});
    a.scoring.rec = 99;
    a.rosterPositions.push('BN');
    expect(b.scoring.rec).toBe(1);
    expect(b.rosterPositions).not.toContain(undefined);
    expect(b.rosterPositions.length).toBe(DEFAULT_SETTINGS.rosterPositions.length);
  });
});

describe('validateSettings', () => {
  const bad = (patch) => validateSettings({ ...DEFAULT_SETTINGS, ...patch });

  it('rejects a playoff bigger than the league', () => {
    const r = bad({ numTeams: 4, playoffTeams: 6 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('exceeds numTeams'))).toBe(true);
  });

  it('rejects playoffs starting before the season', () => {
    expect(bad({ startWeek: 15, playoffWeekStart: 15 }).valid).toBe(false);
  });

  it('rejects a trade deadline inside the playoffs', () => {
    const r = bad({ tradeDeadlineWeek: 16, playoffWeekStart: 15 });
    expect(r.errors.some((e) => e.includes('trade deadline'))).toBe(true);
  });

  it('rejects a FAAB league with no budget', () => {
    expect(bad({ waiverType: WAIVER_TYPE.FAAB, waiverBudget: 0 }).valid).toBe(false);
  });

  it('rejects more veto votes than there are teams', () => {
    expect(bad({ numTeams: 4, vetoVotesNeeded: 6 }).valid).toBe(false);
  });

  it('requires a median matchup for an odd number of teams', () => {
    expect(bad({ numTeams: 11 }).valid).toBe(false);
    expect(bad({ numTeams: 11, medianMatchup: true, vetoVotesNeeded: 4 }).valid).toBe(true);
  });

  // ⚠️ Silently meaningless settings are worse than rejected ones — a commissioner
  // sets maxKeepers on a redraft league and wonders all preseason why nobody can
  // keep anyone.
  it('rejects keeper and taxi settings that the format makes meaningless', () => {
    expect(bad({ format: FORMAT.REDRAFT, maxKeepers: 2 }).valid).toBe(false);
    expect(bad({ format: FORMAT.KEEPER, taxiSlots: 3 }).valid).toBe(false);
    expect(bad({ format: FORMAT.DYNASTY, taxiSlots: 3, maxKeepers: 2 }).valid).toBe(true);
  });

  it('rejects a roster with no starting slots', () => {
    expect(bad({ rosterPositions: ['BN', 'BN'] }).valid).toBe(false);
  });

  it('rejects unknown enums rather than silently defaulting', () => {
    expect(bad({ format: 'superflex' }).valid).toBe(false);
    expect(bad({ waiverType: 'blind' }).valid).toBe(false);
  });
});

describe('format predicates', () => {
  it('knows which formats carry rosters across seasons', () => {
    expect(isMultiSeason({ format: FORMAT.DYNASTY })).toBe(true);
    expect(isMultiSeason({ format: FORMAT.KEEPER })).toBe(true);
    expect(isMultiSeason({ format: FORMAT.REDRAFT })).toBe(false);
    expect(isMultiSeason(null)).toBe(false);
  });

  it('knows best ball never asks for a lineup', () => {
    expect(requiresLineupSetting({ bestBall: false })).toBe(true);
    expect(requiresLineupSetting({ bestBall: true })).toBe(false);
  });
});

describe('playoff bracket default', () => {
  // ⚠️ Sleeper's default keeps a team on the side of the bracket it was seeded
  // into; re-seeding each round is the opt-in. We shipped the opposite until
  // 2026-08-11. See docs/research/sleeper-parity-study.md §6.1.
  it('leaves teams on their side of the bracket, as Sleeper does', () => {
    expect(DEFAULT_SETTINGS.playoffReseed).toBe(false);
  });
});

describe('AutoSubs setting', () => {
  // Sleeper offers OFF/1/2/3 and defaults to OFF.
  it('ships with AutoSubs off', () => {
    expect(DEFAULT_SETTINGS.autoSubsPerWeek).toBe(0);
  });
});

describe('wave 4 settings', () => {
  it('defaults to one week per playoff round', () => {
    expect(DEFAULT_SETTINGS.playoffRoundFormat).toBe('one');
  });

  it('defaults to no positional limits', () => {
    expect(DEFAULT_SETTINGS.positionLimits).toEqual({});
  });

  // ⚠️ Same trap as `scoring`: a shared reference means one league's edit
  // silently edits every league seeded from the default.
  it('never shares the positionLimits reference with the defaults', () => {
    const a = normalizeSettings({});
    a.positionLimits.QB = 99;
    expect(DEFAULT_SETTINGS.positionLimits.QB).toBeUndefined();
    expect(normalizeSettings({}).positionLimits).toEqual({});
  });
});
