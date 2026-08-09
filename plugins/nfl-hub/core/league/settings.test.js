import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS, FORMAT, WAIVER_TYPE,
  normalizeSettings, validateSettings, fromSleeperSettings,
  isMultiSeason, requiresLineupSetting,
} from './settings.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const league = fx('sleeper-league.json');

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

// ⚠️ Against the REAL recorded league, so the enum mappings are read from data
// rather than assumed. This league is a 12-team dynasty with FAAB and a taxi
// squad — the shape most likely to expose a wrong enum.
describe('fromSleeperSettings', () => {
  const s = fromSleeperSettings(league);

  it('reads the format from Sleeper’s numeric type', () => {
    expect(league.settings.type).toBe(2);
    expect(s.format).toBe(FORMAT.DYNASTY);
  });

  it('reads FAAB from waiver_type 2, with its budget', () => {
    expect(league.settings.waiver_type).toBe(2);
    expect(s.waiverType).toBe(WAIVER_TYPE.FAAB);
    expect(s.waiverBudget).toBe(1000);
  });

  it('carries the dynasty-only settings across', () => {
    expect(s.taxiSlots).toBe(5);
    expect(s.taxiYears).toBe(2);
    expect(s.maxKeepers).toBe(1);
    expect(s.irSlots).toBe(3);
  });

  it('carries the season and transaction shape', () => {
    expect(s.numTeams).toBe(12);
    expect(s.playoffTeams).toBe(6);
    expect(s.playoffWeekStart).toBe(15);
    expect(s.tradeDeadlineWeek).toBe(12);
    expect(s.tradeReviewDays).toBe(2);
    expect(s.vetoVotesNeeded).toBe(6);
  });

  it('inverts Sleeper’s disable_ flags rather than copying them', () => {
    expect(league.settings.disable_trades).toBe(0);
    expect(s.tradesEnabled).toBe(true);
    expect(s.addsEnabled).toBe(true);
    expect(s.pickTradingEnabled).toBe(true);
  });

  it('brings the real scoring settings, not a preset', () => {
    expect(s.scoring.pts_allow_14_20).toBe(1);
    expect(s.scoring.rec).toBe(1);
  });

  it('imports the real roster shape including SUPER_FLEX', () => {
    expect(s.rosterPositions).toContain('SUPER_FLEX');
  });

  it('produces a valid league from the real one', () => {
    expect(validateSettings(s)).toEqual({ valid: true, errors: [] });
  });

  it('falls back to defaults rather than inventing meaning for an unknown enum', () => {
    const weird = fromSleeperSettings({ settings: { type: 99, waiver_type: 99 } });
    expect(weird.format).toBe(FORMAT.REDRAFT);
    expect(weird.waiverType).toBe(DEFAULT_SETTINGS.waiverType);
  });

  it('survives an empty or missing league object', () => {
    expect(fromSleeperSettings(null).numTeams).toBe(12);
    expect(fromSleeperSettings({}).format).toBe(FORMAT.REDRAFT);
  });
});
